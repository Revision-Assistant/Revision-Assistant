/**
 * Stage 3 — Align report spans to paper offsets via fuzzy string matching.
 * Target: ≥90% of flagged spans map correctly. Embeddings deferred until measured.
 */

import Fuse from 'fuse.js';
import type { AlignedSpan, MatchSource, ParsedPaper, SimilarityFlag, AIFlag } from '../../types';
import { normalizeForMatch, offsetToPage } from '../pdf/textUtils';

/** Simple Dice coefficient on character bigrams */
export function diceCoefficient(a: string, b: string): number {
  if (!a.length || !b.length) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;

  const bigrams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bg = a.slice(i, i + 2);
    bigrams.set(bg, (bigrams.get(bg) || 0) + 1);
  }
  let intersection = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bg = b.slice(i, i + 2);
    const count = bigrams.get(bg) || 0;
    if (count > 0) {
      intersection++;
      bigrams.set(bg, count - 1);
    }
  }
  return (2 * intersection) / (a.length - 1 + (b.length - 1));
}

/** Levenshtein ratio (1 - dist/maxLen) for short strings */
export function levenshteinRatio(a: string, b: string): number {
  if (a === b) return 1;
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return 0;
  // Cap expensive computation
  if (m > 400 || n > 400) return diceCoefficient(a, b);

  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  const dist = prev[n];
  return 1 - dist / Math.max(m, n);
}

export function similarity(a: string, b: string): number {
  const na = normalizeForMatch(a);
  const nb = normalizeForMatch(b);
  if (!na || !nb) return 0;
  if (na.includes(nb) || nb.includes(na)) {
    const ratio = Math.min(na.length, nb.length) / Math.max(na.length, nb.length);
    return 0.85 + 0.15 * ratio;
  }
  const dice = diceCoefficient(na, nb);
  if (Math.max(na.length, nb.length) < 120) {
    return Math.max(dice, levenshteinRatio(na, nb));
  }
  return dice;
}

interface WindowCandidate {
  start: number;
  end: number;
  text: string;
}

/** Build sliding windows from paper text approximately matching query length */
function buildWindows(fullText: string, queryLen: number): WindowCandidate[] {
  const target = Math.max(40, Math.min(queryLen + 40, queryLen * 1.3));
  const step = Math.max(20, Math.floor(target / 3));
  const windows: WindowCandidate[] = [];
  for (let i = 0; i < fullText.length; i += step) {
    const end = Math.min(fullText.length, i + Math.ceil(target));
    if (end - i < 20) break;
    windows.push({ start: i, end, text: fullText.slice(i, end) });
    if (end >= fullText.length) break;
  }
  return windows;
}

/**
 * Find best paper offset for a report excerpt.
 * Returns null if best score < threshold.
 */
export function alignSpan(
  reportText: string,
  paper: ParsedPaper,
  threshold = 0.72
): { start: number; end: number; score: number; paperText: string } | null {
  const q = reportText.trim();
  if (q.length < 15) return null;

  const nq = normalizeForMatch(q);

  // Exact / near-exact substring search first
  const lowerPaper = paper.fullText.toLowerCase();
  const lowerQ = q.toLowerCase();
  let idx = lowerPaper.indexOf(lowerQ);
  if (idx === -1 && nq.length > 30) {
    // Try normalized continuous search on collapsed paper
    const nPaper = normalizeForMatch(paper.fullText);
    const nIdx = nPaper.indexOf(nq);
    if (nIdx !== -1) {
      // Map normalized index approximately back (best-effort)
      idx = approximateDenormalize(paper.fullText, nIdx);
    }
  }
  if (idx !== -1) {
    return {
      start: idx,
      end: idx + q.length,
      score: 1,
      paperText: paper.fullText.slice(idx, idx + q.length),
    };
  }

  // Sliding window + Fuse for fuzzy
  const windows = buildWindows(paper.fullText, q.length);
  const fuse = new Fuse(windows, {
    keys: ['text'],
    includeScore: true,
    threshold: 0.45,
    ignoreLocation: true,
    minMatchCharLength: 12,
  });
  const fuseHits = fuse.search(q.slice(0, 200), { limit: 8 });

  let best: { start: number; end: number; score: number; paperText: string } | null = null;

  const candidates = fuseHits.length
    ? fuseHits.map((h) => h.item)
    : windows.filter((_, i) => i % 2 === 0); // subsample if fuse fails

  for (const w of candidates) {
    // Refine: find best sub-window of ~query length inside w
    const refined = refineWindow(w.text, q, w.start);
    const score = similarity(q, refined.text);
    if (!best || score > best.score) {
      best = {
        start: refined.start,
        end: refined.end,
        score,
        paperText: refined.text,
      };
    }
  }

  // Also try sentence-level
  for (const s of paper.sentences) {
    const score = similarity(q, s.text);
    if (score >= threshold && (!best || score > best.score)) {
      best = {
        start: s.startOffset,
        end: s.endOffset,
        score,
        paperText: s.text,
      };
    }
    // Multi-sentence: join with next
    if (s.sentenceIndex + 1 < paper.sentences.length) {
      const next = paper.sentences[s.sentenceIndex + 1];
      const joined = paper.fullText.slice(s.startOffset, next.endOffset);
      const jScore = similarity(q, joined);
      if (jScore >= threshold && (!best || jScore > best.score)) {
        best = {
          start: s.startOffset,
          end: next.endOffset,
          score: jScore,
          paperText: joined,
        };
      }
    }
  }

  if (!best || best.score < threshold) return null;
  return best;
}

function refineWindow(
  windowText: string,
  query: string,
  absoluteStart: number
): { start: number; end: number; text: string } {
  const targetLen = Math.min(windowText.length, Math.max(query.length, 40));
  let bestScore = -1;
  let bestStart = 0;
  const step = Math.max(5, Math.floor(targetLen / 8));
  for (let i = 0; i <= windowText.length - Math.min(20, targetLen); i += step) {
    const slice = windowText.slice(i, i + targetLen);
    const sc = similarity(query, slice);
    if (sc > bestScore) {
      bestScore = sc;
      bestStart = i;
    }
  }
  return {
    start: absoluteStart + bestStart,
    end: absoluteStart + bestStart + targetLen,
    text: windowText.slice(bestStart, bestStart + targetLen),
  };
}

function approximateDenormalize(original: string, normIndex: number): number {
  // Walk original, counting normalized chars
  let ni = 0;
  const norm = (c: string) => /[a-z0-9\s']/i.test(c);
  for (let i = 0; i < original.length; i++) {
    const ch = original[i].toLowerCase();
    if (norm(ch)) {
      if (ni >= normIndex) return i;
      // collapse spaces in norm — approximate
      ni++;
    }
  }
  return Math.min(normIndex, original.length - 1);
}

export function alignSimilarityFlags(
  flags: SimilarityFlag[],
  paper: ParsedPaper,
  threshold = 0.72
): { aligned: AlignedSpan[]; matchRate: number } {
  const aligned: AlignedSpan[] = [];
  let hits = 0;
  for (const f of flags) {
    // Badge-derived flags already carry exact paper offsets — re-running fuzzy matching
    // on them would only introduce drift.
    if (f.preAligned) {
      hits++;
      aligned.push({
        reportText: f.text,
        paperStart: f.startOffset,
        paperEnd: f.endOffset,
        paperPage: f.page,
        paperText: f.text,
        score: 1,
        sources: f.sources,
        matchPct: f.matchPct,
        kind: 'similarity',
        positionOnly: true,
      });
      continue;
    }

    const match = alignSpan(f.text, paper, threshold);
    if (match) {
      hits++;
      aligned.push({
        reportText: f.text,
        paperStart: match.start,
        paperEnd: match.end,
        paperPage: offsetToPage(paper.pages, match.start),
        paperText: match.paperText,
        score: match.score,
        sources: f.sources,
        matchPct: f.matchPct,
        kind: 'similarity',
      });
    } else {
      // Keep unaligned with score 0 at report offsets (won't highlight paper well)
      aligned.push({
        reportText: f.text,
        paperStart: -1,
        paperEnd: -1,
        paperPage: 1,
        paperText: '',
        score: 0,
        sources: f.sources,
        matchPct: f.matchPct,
        kind: 'similarity',
      });
    }
  }
  const matchRate = flags.length ? hits / flags.length : 1;
  return { aligned, matchRate };
}

export function alignAIFlags(
  flags: AIFlag[],
  paper: ParsedPaper,
  threshold = 0.72
): AlignedSpan[] {
  const out: AlignedSpan[] = [];
  for (const f of flags) {
    const match = alignSpan(f.text, paper, threshold);
    if (match) {
      out.push({
        reportText: f.text,
        paperStart: match.start,
        paperEnd: match.end,
        paperPage: offsetToPage(paper.pages, match.start),
        paperText: match.paperText,
        score: match.score,
        sources: [] as MatchSource[],
        matchPct: null,
        kind: 'ai',
      });
    }
  }
  return out;
}

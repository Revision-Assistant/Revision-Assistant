/**
 * Grammar/style checking via LanguageTool (open-source, ML+rule-based grammar engine).
 * Public API by default; point VITE_LANGUAGETOOL_URL at a self-hosted instance for
 * heavier use than the free public tier's ~20 requests/min, ~75k chars/15min limits.
 *
 * Findings are explicit, reviewable edits (per plan.md's grammar scope boundary) —
 * this module never applies anything; it only proposes, with the exact replacement
 * text attached so the UI can offer a one-click "apply this correction".
 */

import type { Finding, ParsedPaper } from '../../types';
import { offsetToPage } from '../pdf/textUtils';
import { isInsideQuotes } from '../categorize/rules';

const DEFAULT_LT_URL = 'https://api.languagetool.org/v2/check';
/** Larger chunks = fewer requests, which matters more than request size against the free tier's per-minute cap. */
const CHUNK_TARGET_CHARS = 6000;
const REQUEST_DELAY_MS = 3100;
const DEFAULT_MAX_CHUNKS = 15;

interface LTReplacement {
  value: string;
}

export interface LTMatch {
  message: string;
  replacements: LTReplacement[];
  offset: number;
  length: number;
  rule: {
    id: string;
    category: { id: string; name: string };
  };
}

interface LTResponse {
  matches: LTMatch[];
}

export interface Chunk {
  text: string;
  start: number;
  end: number;
}

/** Group sentences into request-sized chunks, stopping before the References section. */
export function buildChunks(paper: ParsedPaper, targetChars = CHUNK_TARGET_CHARS): Chunk[] {
  const refSection = paper.sections.find((s) => s.name === 'References');
  const skipFrom = refSection?.startOffset ?? Infinity;

  const chunks: Chunk[] = [];
  let curStart: number | null = null;
  let curEnd = 0;

  for (const s of paper.sentences) {
    if (s.startOffset >= skipFrom) break;
    if (curStart === null) {
      curStart = s.startOffset;
      curEnd = s.endOffset;
      continue;
    }
    if (s.endOffset - curStart > targetChars) {
      chunks.push({ text: paper.fullText.slice(curStart, curEnd), start: curStart, end: curEnd });
      curStart = s.startOffset;
      curEnd = s.endOffset;
    } else {
      curEnd = s.endOffset;
    }
  }
  if (curStart !== null) {
    chunks.push({ text: paper.fullText.slice(curStart, curEnd), start: curStart, end: curEnd });
  }
  return chunks;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkChunk(chunk: Chunk, apiUrl: string, language: string): Promise<LTMatch[]> {
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ text: chunk.text, language }),
  });
  if (!res.ok) {
    console.warn('LanguageTool request failed', res.status);
    return [];
  }
  const data = (await res.json()) as LTResponse;
  return data.matches || [];
}

function uid(): string {
  return crypto.randomUUID();
}

/** Bare acronym/initialism token, e.g. "TCAD", "GFET", "PBS" — technical jargon LanguageTool's dictionary doesn't know, not a real typo. */
const ACRONYM_RE = /^[A-Z][A-Z0-9-]{1,9}$/;
const SPELLING_CATEGORIES = new Set(['TYPOS', 'MISC']);

/**
 * SI / engineering units and short domain tokens LanguageTool routinely flags as typos
 * in STEM papers (nm, µm, meV, AlGaN-style formulas are not grammar errors).
 */
const UNIT_OR_SYMBOL_RE =
  /^(?:nm|µm|um|mm|cm|km|pm|fm|Å|angstrom|kg|g|mg|µg|ug|ng|pg|Hz|kHz|MHz|GHz|THz|eV|meV|keV|MeV|GeV|Pa|kPa|MPa|GPa|mA|µA|uA|nA|pA|V|mV|kV|W|mW|kW|dB|dBm|Ω|ohm|mol|mmol|µM|uM|nM|pM|K|°C|C|F|Torr|mbar|bar|sccm|rpm|arb\.?u\.?|a\.?u\.?|wt%|at%|vol%)$/i;

/** Chemical / material formulas with digits or mixed case (SiO2, AlGaN, MoS2, In0.53Ga0.47As). */
const FORMULA_RE = /^(?=.*\d)[A-Za-z][A-Za-z0-9().-]{0,24}$|^[A-Z][a-z]?(?:[A-Z][a-z]?\d*)+$/;

/** Very short tokens (≤3) that are almost never real English typos in academic prose. */
const SHORT_TOKEN_RE = /^[A-Za-zµμΩÅ]{1,3}$/;

/** A word used 2+ times consistently is a deliberate term (STEM jargon), not a one-off slip. */
function occursMultipleTimes(word: string, fullText: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = fullText.match(new RegExp(`\\b${escaped}\\b`, 'gi'));
  return (matches?.length ?? 0) >= 2;
}

function isTechnicalToken(trimmed: string): boolean {
  if (!trimmed) return false;
  if (ACRONYM_RE.test(trimmed)) return true;
  if (UNIT_OR_SYMBOL_RE.test(trimmed)) return true;
  if (FORMULA_RE.test(trimmed)) return true;
  if (SHORT_TOKEN_RE.test(trimmed) && !/^(a|an|the|is|are|was|were|be|to|of|in|on|or|and|not|for|as|by|at|it|if|so|do|we|us|my)$/i.test(trimmed)) {
    return true;
  }
  return false;
}

export function matchToFinding(m: LTMatch, chunk: Chunk, paper: ParsedPaper): Finding | null {
  if (m.length <= 0) return null; // insertion-only suggestions have nothing to highlight/replace

  const start = chunk.start + m.offset;
  const end = start + m.length;
  if (end > paper.fullText.length || start < 0) return null;
  if (isInsideQuotes(paper, start, end)) return null; // quoted source wording, not the author's prose

  const flaggedText = paper.fullText.slice(start, end);
  const trimmed = flaggedText.trim();
  if (isTechnicalToken(trimmed)) return null;

  const categoryId = m.rule.category?.id || '';
  const isSpellingRule = SPELLING_CATEGORIES.has(categoryId) || /MORFOLOGIK/i.test(m.rule.id);
  // Spelling hits of length ≤3 are almost always units/abbreviations ("nm", "Si")
  if (isSpellingRule && trimmed.length <= 3) return null;
  if (isSpellingRule && trimmed.length > 2 && occursMultipleTimes(trimmed, paper.fullText)) {
    return null; // recurring "unknown word" is almost always domain vocabulary, not a typo
  }
  // Ignore style/typography noise that floods scientific PDFs (ligatures, spaces)
  if (categoryId === 'TYPOGRAPHY') return null;

  const categoryName = m.rule.category?.name || 'Grammar';
  const isStyleOnly = categoryId === 'STYLE' || categoryId === 'TYPOGRAPHY';
  const options = (m.replacements || []).slice(0, 3).map((r) => r.value);

  return {
    id: uid(),
    kind: 'grammar',
    category: 'grammar_error',
    startOffset: start,
    endOffset: end,
    page: offsetToPage(paper.pages, start),
    text: flaggedText,
    sourceUrl: null,
    sourceTitle: null,
    matchPct: null,
    sourceType: null,
    explanation: `${categoryName}: ${m.message}`,
    suggestion: options.length
      ? `Suggested replacement${options.length > 1 ? 's' : ''}: ${options.map((o) => `"${o}"`).join(', ')}`
      : 'Flagged, but no automatic replacement — rephrase manually.',
    replacementText: options[0] ?? null,
    status: 'open',
    isInformational: isStyleOnly,
    confidence: isStyleOnly ? 0.55 : 0.8,
  };
}

export interface GrammarCheckOptions {
  language?: string;
  apiUrl?: string;
  maxChunks?: number;
  onProgress?: (done: number, total: number) => void;
}

export async function checkGrammar(
  paper: ParsedPaper,
  options: GrammarCheckOptions = {}
): Promise<Finding[]> {
  const apiUrl =
    options.apiUrl || (import.meta.env.VITE_LANGUAGETOOL_URL as string | undefined) || DEFAULT_LT_URL;
  const language = options.language || 'en-US';
  const chunks = buildChunks(paper).slice(0, options.maxChunks ?? DEFAULT_MAX_CHUNKS);

  const findings: Finding[] = [];

  for (let i = 0; i < chunks.length; i++) {
    try {
      const matches = await checkChunk(chunks[i], apiUrl, language);
      for (const m of matches) {
        const f = matchToFinding(m, chunks[i], paper);
        if (f) findings.push(f);
      }
    } catch (err) {
      console.warn('LanguageTool chunk failed', err);
    }
    options.onProgress?.(i + 1, chunks.length);
    if (i < chunks.length - 1) await sleep(REQUEST_DELAY_MS);
  }

  return findings;
}

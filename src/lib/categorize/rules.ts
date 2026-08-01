/**
 * Stage 4 — Rules-based categorization (free, no LLM for most labels).
 */

import type {
  AlignedSpan,
  Finding,
  FindingCategory,
  InTextCitation,
  ParsedPaper,
  ReferenceEntry,
  TurnitinSourceType,
} from '../../types';
import { sectionAt } from '../pdf/sections';
import { normalizeForMatch } from '../pdf/textUtils';
import { similarity as textSim } from '../alignment/fuzzyMatch';
import { extractMarkers } from '../citation/guard';
import { formatCitation } from '../citation/format';

const COMMON_PHRASES = [
  'et al',
  'in this paper',
  'in this study',
  'the results show',
  'as shown in figure',
  'as shown in table',
  'this work was supported',
  'all rights reserved',
  'corresponding author',
  'for example',
  'in other words',
  'on the other hand',
  'it is well known',
  'in recent years',
  'the purpose of this',
  'data availability',
  'conflict of interest',
  'informed consent',
  'institutional review board',
];

const METHODS_BOILERPLATE = [
  'was approved by',
  'written informed consent',
  'statistical analysis was performed',
  'p < 0.05',
  'p<0.05',
  'mean ± standard',
  'mean +/- standard',
  'using spss',
  'using graphpad',
  'randomly assigned',
  'double-blind',
  'inclusion criteria',
  'exclusion criteria',
  'samples were collected',
  'according to the manufacturer',
  'previously described',
];

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function isInsideQuotes(paper: ParsedPaper, start: number, end: number): boolean {
  const windowStart = Math.max(0, start - 80);
  const windowEnd = Math.min(paper.fullText.length, end + 80);
  const before = paper.fullText.slice(windowStart, start);
  const after = paper.fullText.slice(end, windowEnd);
  const openQuotes = (before.match(/[“"«]/g) || []).length;
  const closeBefore = (before.match(/[”"»]/g) || []).length;
  // Odd unmatched open quote before span suggests we're inside quotes
  if (openQuotes > closeBefore) return true;
  // Span itself wrapped
  const slice = paper.fullText.slice(Math.max(0, start - 2), Math.min(paper.fullText.length, end + 2));
  if (/[“"].+[”"]/s.test(slice) && slice.length < end - start + 10) return true;
  void after;
  return false;
}

/** Citation marker within ~15 tokens of the span */
function hasNearbyCitation(
  citations: InTextCitation[],
  start: number,
  end: number,
  fullText: string
): boolean {
  const tokenWindow = 15;
  // Approximate tokens as whitespace-separated
  const before = fullText.slice(Math.max(0, start - 200), start);
  const after = fullText.slice(end, Math.min(fullText.length, end + 200));
  const beforeTokens = before.trim().split(/\s+/);
  const afterTokens = after.trim().split(/\s+/);
  const beforeSlice = beforeTokens.slice(-tokenWindow).join(' ');
  const afterSlice = afterTokens.slice(0, tokenWindow).join(' ');
  const regionStart = start - beforeSlice.length - 5;
  const regionEnd = end + afterSlice.length + 5;

  return citations.some(
    (c) => c.startOffset >= regionStart && c.endOffset <= regionEnd + 50
  );
}

/**
 * Match Turnitin source against paper's reference list.
 * Fuzzy on title, tight on year and first author surname.
 * Conservative: uncertain → no match.
 */
export function matchSourceToReferences(
  sourceTitle: string,
  references: ReferenceEntry[]
): ReferenceEntry | null {
  const nTitle = normalizeForMatch(sourceTitle);
  if (nTitle.length < 8) return null;

  let best: { ref: ReferenceEntry; score: number } | null = null;

  for (const ref of references) {
    const candidates = [ref.title, ref.raw, ref.venue].filter(Boolean) as string[];
    for (const c of candidates) {
      const score = textSim(sourceTitle, c);
      // Tight author check bonus
      let authorBonus = 0;
      if (ref.authors[0]) {
        const surname = ref.authors[0].split(/\s+/).pop() || '';
        if (surname.length > 2 && normalizeForMatch(sourceTitle).includes(normalizeForMatch(surname))) {
          authorBonus = 0.1;
        }
      }
      if (ref.year && sourceTitle.includes(ref.year)) authorBonus += 0.08;
      const total = Math.min(1, score + authorBonus);
      if (!best || total > best.score) best = { ref, score: total };
    }
  }

  // Conservative threshold
  if (!best || best.score < 0.82) return null;
  return best.ref;
}

function primarySource(span: AlignedSpan): {
  title: string | null;
  url: string | null;
  type: TurnitinSourceType | null;
  pct: number | null;
} {
  const s = span.sources[0];
  if (!s) {
    return { title: null, url: null, type: null, pct: span.matchPct };
  }
  return {
    title: s.title,
    url: s.url,
    type: s.sourceType,
    pct: s.percentage ?? span.matchPct,
  };
}

function uid(): string {
  return crypto.randomUUID();
}

export function categorizeSimilaritySpan(
  span: AlignedSpan,
  paper: ParsedPaper
): Finding {
  const src = primarySource(span);
  const start = span.paperStart;
  const end = span.paperEnd;
  const aligned = start >= 0 && end > start;
  const text = aligned ? span.paperText || paper.fullText.slice(start, end) : span.reportText;
  const page = aligned ? span.paperPage : 1;
  const section = aligned ? sectionAt(paper.sections, start) : 'Other';
  const words = wordCount(text);

  // A badge locates a match without revealing how much of the sentence it covers; say so
  // rather than implying the whole highlighted span was copied.
  const extentCaveat = span.positionOnly
    ? ' Note: the report marks where this match occurs but not its extent, so the full sentence is highlighted — only part of it may actually overlap.'
    : '';

  const base = {
    id: uid(),
    kind: 'similarity' as const,
    startOffset: aligned ? start : 0,
    endOffset: aligned ? end : 0,
    page,
    text,
    sourceUrl: src.url,
    sourceTitle: src.title,
    matchPct: src.pct,
    sourceType: src.type,
    explanation: null as string | null,
    suggestion: null as string | null,
    status: 'open' as const,
    confidence: span.score,
  };

  if (!aligned || span.score < 0.5) {
    return {
      ...base,
      category: 'review_manually',
      isInformational: false,
      explanation:
        'Could not reliably locate this flagged passage in your paper. Review the Turnitin highlight manually.',
      confidence: span.score,
    };
  }

  // Student paper → never propose citation
  if (src.type === 'student_paper') {
    return {
      ...base,
      category: 'source_unidentifiable',
      isInformational: false,
      explanation:
        'Turnitin matched a student paper or institutional repository. The matched text cannot be shown and no citation can be proposed. Use your judgement: restate in your own words if this is not an independent coincidence, and ensure you are not recycling prior coursework without disclosure.',
      confidence: Math.min(span.score, 0.55),
    };
  }

  if (section === 'References') {
    return {
      ...base,
      category: 'reference_entry',
      isInformational: true,
      explanation:
        'This span falls inside your References / Bibliography section. Matches here are expected (shared citation strings) and are not plagiarism of your prose.',
      confidence: 0.95,
    };
  }

  if (isInsideQuotes(paper, start, end)) {
    return {
      ...base,
      category: 'properly_quoted',
      isInformational: true,
      explanation:
        'This span appears inside quotation marks. If the quotation is accurate and cited, no change is needed.',
      confidence: 0.9,
    };
  }

  if (words < 8 || COMMON_PHRASES.some((p) => normalizeForMatch(text).includes(p))) {
    return {
      ...base,
      category: 'common_phrase',
      isInformational: true,
      explanation:
        'Short or boilerplate academic phrasing. Typically a false positive — still confirm it is not a distinctive phrase from a single source.',
      confidence: 0.85,
    };
  }

  if (
    section === 'Methods' &&
    METHODS_BOILERPLATE.some((p) => normalizeForMatch(text).includes(normalizeForMatch(p)))
  ) {
    return {
      ...base,
      category: 'methods_boilerplate',
      isInformational: true,
      explanation:
        'Standard methods / protocol language. Journals usually accept this; no rewrite required unless your institution demands it.',
      confidence: 0.88,
    };
  }

  if (hasNearbyCitation(paper.citations, start, end, paper.fullText)) {
    const embedded = extractMarkers(text);
    const keepNote =
      embedded.length > 0
        ? ` This passage contains ${embedded.map((m) => m.marker).join(', ')} — keep that marker exactly as-is if you restate.`
        : '';
    return {
      ...base,
      category: 'already_cited',
      isInformational: true,
      explanation:
        'A citation marker appears near this span. If the citation covers this claim, you can dismiss the flag. If the overlap is still too close to the source wording, lightly restate while keeping the citation.' +
        keepNote,
      confidence: 0.8,
    };
  }

  // Reference-list cross-check
  const refMatch = src.title
    ? matchSourceToReferences(src.title, paper.references)
    : null;

  if (refMatch) {
    return {
      ...base,
      category: 'missing_in_text_citation',
      isInformational: false,
      explanation:
        `Source appears in your reference list (${refMatch.raw.slice(0, 80)}…) but no in-text citation marker was found near this passage. Add the appropriate in-text citation — usually a quick fix.` +
        extentCaveat,
      suggestion: `Add an in-text citation for: ${refMatch.title || refMatch.raw.slice(0, 100)}`,
      confidence: 0.9,
    };
  }

  // Turnitin reports sub-1% sources as "<1%" — a fragment, not a passage. Surfacing these
  // as "needs a citation" buries the handful of real problems under dozens of incidental
  // phrase overlaps. Shown, not hidden, per the display decision in plan.md §12.
  if (src.pct != null && src.pct < 1) {
    return {
      ...base,
      category: 'trivial_match',
      isInformational: true,
      explanation:
        `Turnitin attributes under 1% of the document to this source${src.title ? ` (${src.title.slice(0, 70)})` : ''}` +
        `, so the overlap is a short fragment rather than a passage.` +
        (span.positionOnly
          ? ' The report marks its position but not its extent, so the whole sentence is highlighted here — only part of it actually matched.'
          : '') +
        ' Usually shared terminology or a standard phrase. Worth a glance if the wording is distinctive.',
      confidence: 0.6,
    };
  }

  if (src.type === 'unknown' && !src.url && !src.title) {
    return {
      ...base,
      category: 'source_unidentifiable',
      isInformational: false,
      explanation:
        'Turnitin did not provide a clear identifiable source. Restate the idea in your own words and add a citation if you know the origin.',
      confidence: 0.5,
    };
  }

  // Long high-overlap without citation → restatement
  if (words >= 20 && (src.pct ?? 0) >= 2) {
    const embedded = extractMarkers(text);
    return {
      ...base,
      category: 'needs_restatement',
      isInformational: false,
      explanation:
        'Long span with substantial overlap and no nearby citation. Restate the idea fully in your own words; do not synonym-swap. Add a citation if the idea is not common knowledge.',
      suggestion:
        'Rewrite the idea from memory without looking at the source wording, then compare. Keep any necessary technical terms; change structure and phrasing.' +
        (embedded.length > 0
          ? ` This span already contains ${embedded.map((m) => m.marker).join(', ')} — do not drop it while restating.`
          : ''),
      confidence: 0.75,
    };
  }

  // Source not in reference list → needs new citation (LLM can help format)
  if (src.title || src.url) {
    return {
      ...base,
      category: 'needs_new_citation',
      isInformational: false,
      explanation:
        'Matched source does not appear in your reference list, and no in-text citation is nearby. If you used this source, add both a bibliography entry and an in-text citation. If you did not, restate to remove close overlap.' +
        extentCaveat,
      suggestion: src.title
        ? `Consider citing: ${formatCitation({ title: src.title, URL: src.url }, paper.detectedCitationStyle)}`
        : null,
      confidence: 0.7,
    };
  }

  return {
    ...base,
    category: 'review_manually',
    isInformational: false,
    explanation: 'Could not auto-categorize with high confidence. Review manually.',
    confidence: 0.4,
  };
}

export function categorizeAISpan(
  span: AlignedSpan,
  paper: ParsedPaper,
  features: import('../../types').AIFeatures
): Finding {
  const start = span.paperStart;
  const end = span.paperEnd;
  return {
    id: uid(),
    kind: 'ai',
    category: 'ai_flagged',
    startOffset: start,
    endOffset: end,
    page: span.paperPage,
    text: span.paperText || paper.fullText.slice(start, end),
    sourceUrl: null,
    sourceTitle: null,
    matchPct: null,
    sourceType: null,
    explanation: null, // filled by LLM or local template
    suggestion:
      'Increase specificity: add concrete numbers, named entities, your own citations, and vary sentence length. Reduce hedging clusters ("may", "might", "could potentially").',
    status: 'open',
    isInformational: false,
    confidence: span.score,
    aiFeatures: features,
  };
}

/** Orphan refs + broken citations from Stage 1 parse */
export function detectCitationIntegrity(paper: ParsedPaper): Finding[] {
  const findings: Finding[] = [];

  // Keys cited in text (IEEE numbers)
  const citedNumbers = new Set<string>();
  const citedAuthorYears = new Set<string>();
  for (const c of paper.citations) {
    for (const k of c.keys) {
      if (/^\d+$/.test(k)) citedNumbers.add(k);
      else citedAuthorYears.add(normalizeForMatch(k));
    }
  }

  // Broken: in-text number with no matching ref index
  if (paper.references.length > 0 && citedNumbers.size > 0) {
    const refNums = new Set(paper.references.map((r) => String(r.index)));
    for (const c of paper.citations) {
      for (const k of c.keys) {
        if (/^\d+$/.test(k) && !refNums.has(k)) {
          findings.push({
            id: uid(),
            kind: 'broken_citation',
            category: 'broken_citation',
            startOffset: c.startOffset,
            endOffset: c.endOffset,
            page: 1,
            text: c.marker,
            sourceUrl: null,
            sourceTitle: null,
            matchPct: null,
            sourceType: null,
            explanation: `In-text citation ${c.marker} has no matching entry in the reference list.`,
            suggestion: 'Add the missing reference or fix the citation number.',
            status: 'open',
            isInformational: false,
            confidence: 0.85,
          });
        }
      }
    }
  }

  // Orphan: reference never cited
  for (const ref of paper.references) {
    const num = String(ref.index);
    const citedByNum = citedNumbers.has(num);
    const surname = ref.authors[0]
      ? normalizeForMatch(ref.authors[0].split(/\s+/).pop() || '')
      : '';
    const citedByAuthor =
      surname.length > 2 &&
      [...citedAuthorYears].some((k) => k.includes(surname));

    if (!citedByNum && !citedByAuthor && paper.citations.length > 0) {
      findings.push({
        id: uid(),
        kind: 'orphan_ref',
        category: 'orphan_reference',
        startOffset: ref.startOffset,
        endOffset: ref.endOffset,
        page: 1,
        text: ref.raw.slice(0, 160),
        sourceUrl: null,
        sourceTitle: ref.title,
        matchPct: null,
        sourceType: null,
        explanation:
          'This reference appears in the bibliography but was never cited in the text. Journals often require removing orphans or adding the missing in-text citation.',
        suggestion: 'Cite it in the body where used, or remove it from the reference list.',
        status: 'open',
        isInformational: false,
        confidence: 0.7,
      });
    }
  }

  return findings;
}

export function categorizeAll(
  similaritySpans: AlignedSpan[],
  aiSpans: AlignedSpan[],
  paper: ParsedPaper,
  aiFeatureFn: (text: string, paper: ParsedPaper, start: number, end: number) => import('../../types').AIFeatures
): Finding[] {
  const findings: Finding[] = [];

  for (const s of similaritySpans) {
    findings.push(categorizeSimilaritySpan(s, paper));
  }
  for (const s of aiSpans) {
    const feats = aiFeatureFn(s.paperText, paper, s.paperStart, s.paperEnd);
    findings.push(categorizeAISpan(s, paper, feats));
  }
  findings.push(...detectCitationIntegrity(paper));

  // Sort: actionable first, then by page/offset
  const priority = (c: FindingCategory) => {
    const order: FindingCategory[] = [
      'needs_restatement',
      'needs_new_citation',
      'missing_in_text_citation',
      'needs_citation_claim',
      'source_unidentifiable',
      'ai_flagged',
      'broken_citation',
      'orphan_reference',
      'grammar_error',
      'review_manually',
      'already_cited',
      'methods_boilerplate',
      'common_phrase',
      'trivial_match',
      'properly_quoted',
      'reference_entry',
    ];
    return order.indexOf(c);
  };

  findings.sort((a, b) => {
    if (a.isInformational !== b.isInformational) return a.isInformational ? 1 : -1;
    const p = priority(a.category) - priority(b.category);
    if (p !== 0) return p;
    return a.startOffset - b.startOffset;
  });

  return findings;
}

/** Categories that should be escalated to Groq for richer explanation */
export function needsLlmExplanation(f: Finding): boolean {
  return (
    !f.isInformational &&
    (f.category === 'needs_new_citation' ||
      f.category === 'needs_restatement' ||
      f.category === 'ai_flagged')
  );
}

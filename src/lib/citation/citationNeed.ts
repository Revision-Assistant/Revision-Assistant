/**
 * Citation-need detection (plan.md §9 item 2).
 *
 * Turnitin only flags text that overlaps a source it has indexed. It says nothing about a
 * claim you wrote in your own words that still needs to be attributed — which is the more
 * common reviewer complaint. This module finds sentences that *assert* something about
 * prior work, established fact, or external evidence while carrying no nearby citation.
 *
 * v1 is deliberately rules-based and precision-weighted: a wrong "you must cite this" is
 * more annoying than a miss, so ambiguous sentences are left alone. Every signal here is
 * also emitted as a feature vector, so the same sentences can train the learned model in
 * `training/citation_need_kaggle.ipynb` and later replace these thresholds.
 */

import type { CitationNeedFeatures, Finding, ParsedPaper, SectionName } from '../../types';
import { offsetToPage } from '../pdf/textUtils';
import { extractMarkers } from './guard';

export type { CitationNeedFeatures };

/** Attribution to unnamed prior work — the strongest signal that a source is missing. */
const ATTRIBUTION_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\b(?:studies|research|works?|papers?|authors?|investigations?)\s+(?:have\s+)?(?:shown|demonstrated|reported|found|indicated|suggested|revealed|established|confirmed)\b/i, label: 'attributes a finding to unnamed studies' },
  { re: /\bit\s+(?:has\s+been|was|is)\s+(?:shown|demonstrated|reported|found|observed|established|suggested|proposed)\b/i, label: 'uses an impersonal "it has been shown" construction' },
  { re: /\b(?:previous|prior|earlier|recent|several|many|numerous)\s+(?:studies|works?|reports?|investigations?|authors?|researchers?)\b/i, label: 'refers to previous work without naming it' },
  { re: /\b(?:according\s+to|as\s+reported\s+by|as\s+shown\s+by|as\s+described\s+(?:by|in))\b/i, label: 'explicitly attributes to a source' },
  { re: /\bhas\s+been\s+(?:widely|extensively|commonly|successfully)\s+(?:used|studied|investigated|applied|reported)\b/i, label: 'claims established prior usage' },
  { re: /\b(?:is|are)\s+(?:widely|well|commonly|generally)\s+(?:known|established|accepted|recognized|reported|documented)\b/i, label: 'asserts common knowledge' },
];

/** Quantitative or comparative claims about the world, which normally need a source. */
const CLAIM_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\b(?:outperform|surpass|exceed|superior\s+to|better\s+than|higher\s+than|lower\s+than|compared\s+(?:to|with))\b/i, label: 'makes a comparative claim' },
  { re: /\b(?:the\s+)?(?:most|least|best|worst|highest|lowest|largest|smallest)\s+\w+/i, label: 'makes a superlative claim' },
  { re: /\b(?:leading|major|primary|principal)\s+(?:cause|causes|factor|factors|reason|source)\b/i, label: 'asserts causation or ranking' },
  { re: /\b(?:approximately|about|nearly|over|more\s+than|up\s+to)\s+\d/i, label: 'cites an external statistic' },
  { re: /\b\d+(?:\.\d+)?\s*%\s+of\b/i, label: 'cites a percentage of a population' },
];

/**
 * First-person reporting of the authors' own work needs no citation. This is the main
 * guard against false positives, and it is checked before anything else.
 */
const OWN_WORK_PATTERNS = [
  /\b(?:we|our|us|I|my)\b/i,
  /\b(?:this|the\s+present|the\s+proposed|the\s+current)\s+(?:work|study|paper|article|section|analysis|simulation|design|device|model)\b/i,
  /\b(?:here|herein)\s*,?\s+(?:we|the)\b/i,
  /\b(?:fig(?:ure)?|table|eq(?:uation)?|section|appendix)\.?\s*\d/i,
  /\bas\s+(?:shown|seen|illustrated|summarized)\s+in\s+(?:fig|table|section|eq)/i,
];

/** Sections where an uncited assertion about prior work actually matters. */
const CLAIM_SECTIONS: SectionName[] = ['Abstract', 'Introduction', 'Discussion', 'Conclusion', 'Other'];

const CITATION_WINDOW = 220;

function hasCitationNear(paper: ParsedPaper, start: number, end: number): boolean {
  const from = Math.max(0, start - CITATION_WINDOW);
  const to = Math.min(paper.fullText.length, end + CITATION_WINDOW);
  if (paper.citations.some((c) => c.startOffset >= from && c.endOffset <= to)) return true;
  // Catch markers the Stage-1 parser may have missed
  return extractMarkers(paper.fullText.slice(from, to)).length > 0;
}

export function computeCitationNeedFeatures(
  sentence: { text: string; startOffset: number; endOffset: number; section: SectionName },
  paper: ParsedPaper
): CitationNeedFeatures {
  const text = sentence.text;
  const words = text.trim().split(/\s+/).filter(Boolean);
  const isOwnWork = OWN_WORK_PATTERNS.some((re) => re.test(text));
  const attribution = ATTRIBUTION_PATTERNS.find((p) => p.re.test(text));
  const claim = CLAIM_PATTERNS.find((p) => p.re.test(text));
  const nearby = hasCitationNear(paper, sentence.startOffset, sentence.endOffset);

  // Attribution cues are far more reliable than bare comparatives, so they dominate.
  let score = 0;
  if (attribution) score += 0.65;
  if (claim) score += 0.25;
  if (!nearby) score += 0.2;
  if (isOwnWork) score -= 0.5;
  if (!CLAIM_SECTIONS.includes(sentence.section)) score -= 0.25;
  if (words.length < 8) score -= 0.3;

  return {
    hasAttributionCue: Boolean(attribution),
    hasClaimCue: Boolean(claim),
    hasNearbyCitation: nearby,
    isOwnWork,
    wordCount: words.length,
    numericCount: (text.match(/\b\d+(?:\.\d+)?\b/g) || []).length,
    section: sentence.section,
    score: Math.max(0, Math.min(1, score)),
  };
}

function uid(): string {
  return crypto.randomUUID();
}

type Sentence = { text: string; startOffset: number; endOffset: number; section: SectionName };

/**
 * Filters both detection paths share: a citation is clearly not in question here regardless
 * of whether the "does this need one" judgment comes from regexes or a trained model. Not
 * gated on attribution phrasing — that part is the rules-vs-model disagreement.
 */
export function isEligibleForCitationCheck(s: Sentence, paper: ParsedPaper): boolean {
  if (s.section === 'References') return false;
  if (s.text.trim().length < 40) return false;
  if (hasCitationNear(paper, s.startOffset, s.endOffset)) return false;
  if (OWN_WORK_PATTERNS.some((re) => re.test(s.text))) return false;
  return true;
}

function buildFinding(s: Sentence, paper: ParsedPaper, confidence: number, why: string): Finding {
  return {
    id: uid(),
    kind: 'citation_need',
    category: 'needs_citation_claim',
    startOffset: s.startOffset,
    endOffset: s.endOffset,
    page: offsetToPage(paper.pages, s.startOffset),
    text: s.text,
    sourceUrl: null,
    sourceTitle: null,
    matchPct: null,
    sourceType: null,
    explanation:
      `This sentence ${why}, but no citation appears nearby. ` +
      'A similarity checker will not flag this — it only reports text overlapping an indexed source — yet reviewers commonly ask for attribution here.',
    suggestion:
      'Cite the specific work this claim rests on. If it is your own finding, make that explicit ("our results show…"); if it is genuinely common knowledge in your field, it can stand as-is.',
    status: 'open',
    isInformational: false,
    confidence,
  };
}

export interface CitationNeedOptions {
  /** Minimum score to surface. Raise for fewer, higher-confidence prompts. */
  threshold?: number;
  maxFindings?: number;
}

export function detectCitationNeed(
  paper: ParsedPaper,
  options: CitationNeedOptions = {}
): Finding[] {
  const threshold = options.threshold ?? 0.78;
  const maxFindings = options.maxFindings ?? 20;
  const out: Finding[] = [];

  for (const s of paper.sentences) {
    if (!isEligibleForCitationCheck(s, paper)) continue;

    const f = computeCitationNeedFeatures(s, paper);

    // Require an explicit attribution cue: comparatives alone are too noisy to assert on.
    if (!f.hasAttributionCue) continue;
    if (f.score < threshold) continue;

    const reasons = [
      ...ATTRIBUTION_PATTERNS.filter((p) => p.re.test(s.text)).map((p) => p.label),
      ...CLAIM_PATTERNS.filter((p) => p.re.test(s.text)).map((p) => p.label),
    ];

    const finding = buildFinding(s, paper, f.score, reasons.slice(0, 2).join(' and '));
    out.push({ ...finding, citationNeedFeatures: f });

    if (out.length >= maxFindings) break;
  }

  return out;
}

export { buildFinding as buildCitationNeedFinding };

/**
 * Manuscript-quality advisory flags (rules fallback + feature vectors).
 *
 * Categories:
 * - numerical_ambiguity — vague / underspecified numerical phrasing (not a stats review)
 * - publication_issue — common craft problems (vague methods, empty figure callouts, weak results)
 * - novelty_issue — generic/unsubstantiated novelty *claim* phrasing (not a literature search)
 */

import type {
  Finding,
  FindingCategory,
  ManuscriptQualityFeatures,
  ParsedPaper,
  SectionName,
} from '../../types';
import { offsetToPage } from '../pdf/textUtils';

export type { ManuscriptQualityFeatures };

export type QualityLabel = 'numerical_ambiguity' | 'publication_issue' | 'novelty_issue';

const NOVELTY_RE =
  /\bto\s+the\s+best\s+of\s+our\s+knowledge\b|\bfor\s+the\s+first\s+time\b|\b(?:a\s+)?novel\s+(?:approach|method|framework|algorithm|technique|model|architecture)\b|\bwe\s+(?:are\s+the\s+first|propose\s+a\s+novel|introduce\s+a\s+novel)\b|\bno\s+previous\s+(?:work|study|research)\s+has\b|\bfills?\s+an?\s+important\s+gap\b/i;

const NOVELTY_SUBSTANTIATED_RE =
  /\bcompared\s+(?:to|with|against)\b|\bunlike\s+(?:prior|previous|earlier)\b|\b(?:outperforms?|improves?\s+upon)\b.{0,40}\b(?:by|with)\s+\d/i;

const NUM_AMBIG_RE =
  /\b(?:approximately|roughly|around|about|nearly|almost)\s+(?:\d|half|a\s+third|a\s+quarter)\b|\b(?:several|numerous|various|a\s+number\s+of|a\s+few)\s+(?:%|percent|patients?|samples?|subjects?|cases?)\b|\b(?:significant(?:ly)?|substantial(?:ly)?)\s+(?:increase|decrease|improvement|reduction|difference|effect)\b|\b(?:about|around|roughly)\s+\d+(?:\.\d+)?\s*%\b/i;

const NUM_PRECISE_RE =
  /\b(?:p\s*[<≈=]\s*0?\.\d+|95\s*%\s*CI|confidence\s+interval|n\s*=\s*\d+|N\s*=\s*\d+|±\s*\d)/i;

const PUB_ISSUE_RE =
  /\bas\s+(?:shown|seen|illustrated|depicted)\s+in\s+(?:Fig(?:ure)?|Table)\.?\s*\d|\b(?:standard|conventional|usual)\s+(?:methods?|procedures?|protocols?)\s+(?:were|was)\s+(?:used|followed|applied)\b|\b(?:was|were)\s+(?:carefully|properly|thoroughly)\s+(?:performed|conducted|carried\s+out)\b|\bresults?\s+(?:were|was)\s+(?:significant|promising|encouraging|satisfactory)\b/i;

const SKIP_SECTIONS: SectionName[] = ['References'];

function uid(): string {
  return crypto.randomUUID();
}

export function computeQualityFeatures(text: string, section: SectionName): ManuscriptQualityFeatures {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const hasNovelty = NOVELTY_RE.test(text) && !NOVELTY_SUBSTANTIATED_RE.test(text);
  const hasNum = NUM_AMBIG_RE.test(text) && !NUM_PRECISE_RE.test(text);
  const hasPub = PUB_ISSUE_RE.test(text);
  let score = 0;
  let label: QualityLabel | null = null;
  if (hasNovelty) {
    score = 0.82;
    label = 'novelty_issue';
  } else if (hasPub) {
    score = 0.78;
    label = 'publication_issue';
  } else if (hasNum) {
    score = 0.76;
    label = 'numerical_ambiguity';
  }
  if (words.length < 8) score -= 0.25;
  if (section === 'Methods' && hasPub) score += 0.05;
  return {
    hasNumericalAmbiguity: hasNum,
    hasPublicationIssue: hasPub,
    hasNoveltyIssue: hasNovelty,
    wordCount: words.length,
    section,
    predictedLabel: label,
    score: Math.max(0, Math.min(1, score)),
  };
}

export function isEligibleForQualityCheck(s: {
  text: string;
  section: SectionName;
}): boolean {
  if (SKIP_SECTIONS.includes(s.section)) return false;
  if (s.text.trim().length < 40) return false;
  return true;
}

const COPY: Record<
  QualityLabel,
  { category: FindingCategory; explanation: string; suggestion: string }
> = {
  numerical_ambiguity: {
    category: 'numerical_ambiguity',
    explanation:
      'This sentence uses numerical or statistical phrasing that looks vague or underspecified ' +
      '(hedged quantities, “significant” without numbers, or percentages without a clear base). ' +
      'This is not a formal statistical review — only an ambiguity check on wording.',
    suggestion:
      'Add the unit, sample size (n), comparison baseline, uncertainty (CI / ±), or exact value so a reader can interpret the claim.',
  },
  publication_issue: {
    category: 'publication_issue',
    explanation:
      'This sentence matches common manuscript-craft issues: vague methods claims, weak result statements, ' +
      'or figure/table callouts with little substance. This is advisory editorial guidance, not peer-review judgment.',
    suggestion:
      'Replace boilerplate with concrete steps, report the actual quantitative result, or summarize what the figure/table shows in the sentence itself.',
  },
  novelty_issue: {
    category: 'novelty_issue',
    explanation:
      'This sentence asserts novelty or contribution in generic/boilerplate language without naming a concrete comparison. ' +
      'This is a novelty-*claim* quality check — not a search of prior literature.',
    suggestion:
      'Scope the claim (first in which setting?), name the comparison baseline, or cite the prior work you improve on. Drop “novel/first” if it cannot be substantiated.',
  },
};

type Sentence = {
  text: string;
  startOffset: number;
  endOffset: number;
  section: SectionName;
};

export function buildQualityFinding(
  s: Sentence,
  paper: ParsedPaper,
  label: QualityLabel,
  confidence: number,
  features?: ManuscriptQualityFeatures
): Finding {
  const copy = COPY[label];
  return {
    id: uid(),
    kind: 'manuscript_quality',
    category: copy.category,
    startOffset: s.startOffset,
    endOffset: s.endOffset,
    page: offsetToPage(paper.pages, s.startOffset),
    text: s.text,
    sourceUrl: null,
    sourceTitle: null,
    matchPct: null,
    sourceType: null,
    explanation: copy.explanation,
    suggestion: copy.suggestion,
    status: 'open',
    isInformational: false,
    confidence,
    manuscriptQualityFeatures: features,
  };
}

export interface ManuscriptQualityOptions {
  threshold?: number;
  maxFindings?: number;
}

export function detectManuscriptQuality(
  paper: ParsedPaper,
  options: ManuscriptQualityOptions = {}
): Finding[] {
  const threshold = options.threshold ?? 0.72;
  const maxFindings = options.maxFindings ?? 24;
  const out: Finding[] = [];

  for (const s of paper.sentences) {
    if (!isEligibleForQualityCheck(s)) continue;
    const f = computeQualityFeatures(s.text, s.section);
    if (!f.predictedLabel || f.score < threshold) continue;
    out.push(buildQualityFinding(s, paper, f.predictedLabel, f.score, f));
    if (out.length >= maxFindings) break;
  }
  return out;
}

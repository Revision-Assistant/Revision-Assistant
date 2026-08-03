/**
 * Heuristic journal-readiness scoring from manuscript structure + open findings.
 *
 * Labels use “Q1-like / Q2-like bar” — internal checklist bars, NOT Scimago/Clarivate
 * quartiles, NOT peer review, and NOT affiliated with IEEE/Elsevier/etc.
 */

import type { Finding, ParsedPaper, SectionName } from '../../types';
import {
  CURATED_VENUES,
  FIELD_LEXICON,
  type CuratedVenue,
  type VenueField,
  type VenueFormat,
} from './venues';

/** Target size for heuristic venue lists (always non-empty when paper exists). */
export const VENUE_LIST_MIN = 8;
export const VENUE_LIST_MAX = 15;

export type GapSeverity = 'high' | 'medium' | 'low';
export type GapArea =
  | 'structure'
  | 'quality'
  | 'citation'
  | 'grammar'
  | 'ai'
  | 'similarity'
  | 'ieee'
  | 'checklist';

export interface ReadinessGap {
  id: string;
  severity: GapSeverity;
  area: GapArea;
  title: string;
  detail: string;
  relatedFindingIds: string[];
}

export interface JournalSuggestion {
  name: string;
  publisherHint: string;
  reason: string;
  confidence: 'low' | 'medium';
  caution?: string;
  matchKeywords: string[];
  /** Where this suggestion came from */
  source?: 'heuristic' | 'local_model' | 'llm';
}

export interface ReadinessChecklistItem {
  id: string;
  label: string;
  passed: boolean;
  note: string;
}

/** Explainable contribution to Q1-like / Q2-like / IEEE-oriented bars. */
export interface ScoreBreakdownItem {
  id: string;
  label: string;
  effect: 'raised' | 'lowered';
  q1Delta: number;
  q2Delta: number;
  ieeeDelta: number;
}

export interface ReadinessResult {
  /** 0–100 internal “Q1-like bar” (stricter). Not a real quartile. */
  q1LikeScore: number;
  /** 0–100 internal “Q2-like bar” (more lenient). Not a real quartile. */
  q2LikeScore: number;
  /** 0–100 IEEE-oriented craft heuristic (citation style, methods, clarity). */
  ieeeScore: number;
  summary: string;
  gaps: ReadinessGap[];
  journalSuggestions: JournalSuggestion[];
  checklist: ReadinessChecklistItem[];
  /** What raised/lowered each bar (largest |delta| first). */
  scoreBreakdown: ScoreBreakdownItem[];
  fieldGuess: VenueField[];
  mappingNote: string;
  /** Optional ONNX model contribution (heuristic boosts only). */
  modelUsed?: boolean;
  modelSource?: 'hub' | 'local' | 'none';
}

const CORE_SECTIONS: SectionName[] = [
  'Abstract',
  'Introduction',
  'Methods',
  'Results',
  'Discussion',
  'Conclusion',
  'References',
];

const MAPPING_NOTE =
  'Q1-like / Q2-like bars are internal readiness checklists derived from manuscript signals ' +
  '(structure, quality/grammar/citation/AI findings, numerical consistency). They are not Scimago, Clarivate, or ' +
  'publisher quartiles, not peer review, and do not guarantee acceptance or indexing.';

function openActionable(findings: Finding[]): Finding[] {
  return findings.filter((f) => f.status === 'open' && !f.isInformational);
}

function presentSections(paper: ParsedPaper): Set<SectionName> {
  const names = new Set(paper.sections.map((s) => s.name));
  // Fallback: infer from sentences when parser missed section headers
  if (names.size === 0) {
    for (const s of paper.sentences) names.add(s.section);
  }
  return names;
}

function extractLeadText(paper: ParsedPaper, title: string): string {
  const abs = paper.sections.find((s) => s.name === 'Abstract');
  const absText = abs
    ? paper.fullText.slice(abs.startOffset, Math.min(abs.endOffset, abs.startOffset + 1200))
    : paper.fullText.slice(0, 1500);
  return `${title}\n${absText}`.toLowerCase();
}

export function inferFields(leadText: string): VenueField[] {
  const hits: { field: VenueField; n: number }[] = [];
  for (const row of FIELD_LEXICON) {
    let n = 0;
    for (const t of row.terms) {
      if (leadText.includes(t)) n += 1;
    }
    if (n > 0) hits.push({ field: row.field, n });
  }
  hits.sort((a, b) => b.n - a.n);
  const fields = hits.slice(0, 3).map((h) => h.field);
  return fields.length ? fields : ['general'];
}

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function countBy(
  findings: Finding[],
  pred: (f: Finding) => boolean
): { count: number; ids: string[] } {
  const ids: string[] = [];
  for (const f of findings) {
    if (pred(f)) ids.push(f.id);
  }
  return { count: ids.length, ids };
}

type MutableScores = { q1: number; q2: number; ieee: number };

function applyFactor(
  scores: MutableScores,
  breakdown: ScoreBreakdownItem[],
  item: Omit<ScoreBreakdownItem, 'effect'> & { effect?: ScoreBreakdownItem['effect'] }
): void {
  const q1Delta = item.q1Delta;
  const q2Delta = item.q2Delta;
  const ieeeDelta = item.ieeeDelta;
  if (q1Delta === 0 && q2Delta === 0 && ieeeDelta === 0) return;
  scores.q1 += q1Delta;
  scores.q2 += q2Delta;
  scores.ieee += ieeeDelta;
  const effect =
    item.effect ??
    (q1Delta + q2Delta + ieeeDelta >= 0 ? 'raised' : 'lowered');
  breakdown.push({
    id: item.id,
    label: item.label,
    effect,
    q1Delta,
    q2Delta,
    ieeeDelta,
  });
}

/**
 * Score manuscript readiness toward internal Q1-like / Q2-like / IEEE-oriented bars.
 */
export function scoreReadiness(
  paper: ParsedPaper,
  findings: Finding[],
  opts?: {
    title?: string;
    similarityPct?: number | null;
    aiPct?: number | null;
    /** Optional ONNX multi-label boosts (never replace honesty labeling). */
    model?: {
      available: boolean;
      source?: 'hub' | 'local' | 'none';
      q1Boost?: number;
      q2Boost?: number;
      ieeeBoost?: number;
    } | null;
  }
): ReadinessResult {
  const title = opts?.title?.trim() || 'Untitled manuscript';
  const open = openActionable(findings);
  const sections = presentSections(paper);
  const lead = extractLeadText(paper, title);
  const fieldGuess = inferFields(lead);

  const qualityOpen = countBy(open, (f) => f.kind === 'manuscript_quality');
  const noveltyOpen = countBy(open, (f) => f.category === 'novelty_issue');
  const numOpen = countBy(open, (f) => f.category === 'numerical_ambiguity');
  const numInconsistOpen = countBy(open, (f) => f.category === 'numerical_inconsistency');
  const pubOpen = countBy(open, (f) => f.category === 'publication_issue');
  const citationOpen = countBy(
    open,
    (f) =>
      f.kind === 'citation_need' ||
      f.kind === 'orphan_ref' ||
      f.kind === 'broken_citation' ||
      f.category === 'needs_new_citation' ||
      f.category === 'missing_in_text_citation' ||
      f.category === 'needs_citation_claim'
  );
  const grammarOpen = countBy(open, (f) => f.kind === 'grammar');
  const aiOpen = countBy(open, (f) => f.kind === 'ai' || f.category === 'ai_flagged');
  const simOpen = countBy(
    open,
    (f) =>
      f.kind === 'similarity' &&
      (f.category === 'needs_restatement' ||
        f.category === 'needs_new_citation' ||
        f.category === 'missing_in_text_citation' ||
        f.category === 'review_manually')
  );

  const hasMethods = sections.has('Methods');
  const hasResults = sections.has('Results') || sections.has('Discussion');
  const hasAbstract = sections.has('Abstract');
  const hasIntro = sections.has('Introduction');
  const hasRefs = sections.has('References') || paper.references.length > 0;
  const hasConclusion = sections.has('Conclusion');
  const citationStyleIsIeee = paper.detectedCitationStyle === 'IEEE';
  const refCount = paper.references.length;
  const citeCount = paper.citations.length;
  const wordCount = paper.fullText.trim().split(/\s+/).filter(Boolean).length;

  const checklist: ReadinessChecklistItem[] = [
    {
      id: 'imrad_core',
      label: 'Core IMRaD-like sections present',
      passed: hasAbstract && hasIntro && hasMethods && hasResults && hasRefs,
      note: missingSectionNote(sections),
    },
    {
      id: 'novelty_claims',
      label: 'Novelty claims look substantiated (no open novelty flags)',
      passed: noveltyOpen.count === 0,
      note:
        noveltyOpen.count === 0
          ? 'No open novelty-claim flags.'
          : `${noveltyOpen.count} open novelty-claim finding(s) to tighten.`,
    },
    {
      id: 'numerical_clarity',
      label: 'Numerical phrasing looks clear (no open ambiguity flags)',
      passed: numOpen.count === 0,
      note:
        numOpen.count === 0
          ? 'No open numerical-ambiguity flags.'
          : `${numOpen.count} sentence(s) need clearer numbers / uncertainty.`,
    },
    {
      id: 'numerical_consistency',
      label: 'Numerical claims look consistent across the manuscript',
      passed: numInconsistOpen.count === 0,
      note:
        numInconsistOpen.count === 0
          ? 'No open numerical-inconsistency flags.'
          : `${numInconsistOpen.count} conflicting quantity pair(s) to reconcile.`,
    },
    {
      id: 'publication_craft',
      label: 'Publication-craft flags cleared',
      passed: pubOpen.count === 0,
      note:
        pubOpen.count === 0
          ? 'No open publication-craft flags.'
          : `${pubOpen.count} craft issue(s) still open.`,
    },
    {
      id: 'citation_hygiene',
      label: 'Citation hygiene (gaps / orphans / broken markers)',
      passed: citationOpen.count === 0,
      note:
        citationOpen.count === 0
          ? 'No open citation gaps.'
          : `${citationOpen.count} citation item(s) still open.`,
    },
    {
      id: 'grammar_load',
      label: 'Grammar / style load manageable',
      passed: grammarOpen.count <= 8,
      note:
        grammarOpen.count === 0
          ? 'No open grammar findings.'
          : `${grammarOpen.count} open grammar finding(s) (≤8 is the soft bar).`,
    },
    {
      id: 'ai_similarity',
      label: 'AI / similarity open items addressed',
      passed: aiOpen.count === 0 && simOpen.count === 0,
      note: `Open AI: ${aiOpen.count}; open similarity actions: ${simOpen.count}.`,
    },
    {
      id: 'ieee_markers',
      label: 'IEEE-oriented markers (style + methods + refs)',
      passed: citationStyleIsIeee && hasMethods && refCount >= 15,
      note: citationStyleIsIeee
        ? `IEEE style detected; ${refCount} reference entries.`
        : `Citation style is ${paper.detectedCitationStyle} (IEEE preferred for IEEE-oriented score).`,
    },
  ];

  const gaps: ReadinessGap[] = [];

  for (const need of CORE_SECTIONS) {
    if (need === 'Discussion' && sections.has('Results')) continue;
    if (need === 'Results' && sections.has('Discussion') && !sections.has('Results')) {
      // Results/Discussion combined is OK — don't double-gap
      continue;
    }
    if (!sections.has(need)) {
      if (need === 'Discussion' && sections.has('Results')) continue;
      if (need === 'Results' && sections.has('Discussion')) continue;
      const high = need === 'Methods' || need === 'References' || need === 'Abstract';
      gaps.push({
        id: `section-${need}`,
        severity: high ? 'high' : 'medium',
        area: 'structure',
        title: `Add or clarify the ${need} section`,
        detail: `The parser did not find a clear ${need} section. Q1/Q2-like venues usually expect complete IMRaD-style structure.`,
        relatedFindingIds: [],
      });
    }
  }

  if (noveltyOpen.count > 0) {
    gaps.push({
      id: 'novelty',
      severity: 'high',
      area: 'quality',
      title: 'Substantiate or soften novelty claims',
      detail: `${noveltyOpen.count} open novelty-claim flag(s). Name baselines, scope “first in …”, or drop unsubstantiated “novel/first” wording.`,
      relatedFindingIds: noveltyOpen.ids.slice(0, 12),
    });
  }
  if (numInconsistOpen.count > 0) {
    gaps.push({
      id: 'numerical-inconsistency',
      severity: 'high',
      area: 'quality',
      title: 'Reconcile conflicting numerical claims',
      detail: `${numInconsistOpen.count} open numerical-inconsistency flag(s). The same quantity appears with different values in different places — align the figures or clarify distinct conditions.`,
      relatedFindingIds: numInconsistOpen.ids.slice(0, 12),
    });
  }
  if (numOpen.count > 0) {
    gaps.push({
      id: 'numerical',
      severity: 'high',
      area: 'quality',
      title: 'Clarify ambiguous numerical phrasing',
      detail: `${numOpen.count} open numerical-ambiguity flag(s). Add n, units, baselines, CI / ±, or exact values.`,
      relatedFindingIds: numOpen.ids.slice(0, 12),
    });
  }
  if (pubOpen.count > 0) {
    gaps.push({
      id: 'pub-craft',
      severity: 'medium',
      area: 'quality',
      title: 'Tighten publication-craft wording',
      detail: `${pubOpen.count} open craft flag(s) (vague methods, empty figure callouts, weak results).`,
      relatedFindingIds: pubOpen.ids.slice(0, 12),
    });
  }
  if (citationOpen.count > 0) {
    gaps.push({
      id: 'citations',
      severity: citationOpen.count >= 5 ? 'high' : 'medium',
      area: 'citation',
      title: 'Repair citation hygiene',
      detail: `${citationOpen.count} open citation-related finding(s) (claims needing cites, orphans, broken markers, or missing in-text markers).`,
      relatedFindingIds: citationOpen.ids.slice(0, 12),
    });
  }
  if (grammarOpen.count > 8) {
    gaps.push({
      id: 'grammar',
      severity: grammarOpen.count > 25 ? 'high' : 'medium',
      area: 'grammar',
      title: 'Reduce grammar / style load',
      detail: `${grammarOpen.count} open grammar findings. Clear the bulk before aiming at a selective venue bar.`,
      relatedFindingIds: grammarOpen.ids.slice(0, 8),
    });
  } else if (grammarOpen.count > 0) {
    gaps.push({
      id: 'grammar-light',
      severity: 'low',
      area: 'grammar',
      title: 'Review remaining grammar suggestions',
      detail: `${grammarOpen.count} open grammar finding(s) left.`,
      relatedFindingIds: grammarOpen.ids.slice(0, 8),
    });
  }
  if (aiOpen.count > 0) {
    gaps.push({
      id: 'ai',
      severity: 'high',
      area: 'ai',
      title: 'Humanize or specify AI-flagged passages',
      detail: `${aiOpen.count} open AI-related finding(s). Add concrete detail and your analytic voice; do not treat drafts as automatic acceptance.`,
      relatedFindingIds: aiOpen.ids.slice(0, 12),
    });
  }
  if (simOpen.count > 0) {
    gaps.push({
      id: 'similarity',
      severity: simOpen.count >= 5 ? 'high' : 'medium',
      area: 'similarity',
      title: 'Resolve open similarity actions',
      detail: `${simOpen.count} open similarity finding(s) still need restatement or citation.`,
      relatedFindingIds: simOpen.ids.slice(0, 12),
    });
  }
  if (!citationStyleIsIeee) {
    gaps.push({
      id: 'ieee-style',
      severity: 'low',
      area: 'ieee',
      title: 'IEEE-oriented score prefers IEEE citation style',
      detail: `Detected style is “${paper.detectedCitationStyle}”. Switching to IEEE numbering helps the IEEE-oriented craft score only — it does not imply IEEE acceptance.`,
      relatedFindingIds: [],
    });
  }
  if (hasMethods && refCount < 10) {
    gaps.push({
      id: 'refs-thin',
      severity: 'medium',
      area: 'checklist',
      title: 'Reference list looks thin for selective venues',
      detail: `Only ${refCount} parsed reference entries. Selective venues often expect denser related-work coverage (heuristic, not a rule).`,
      relatedFindingIds: [],
    });
  }
  if (wordCount > 0 && wordCount < 2500) {
    gaps.push({
      id: 'length-short',
      severity: 'low',
      area: 'checklist',
      title: 'Manuscript may be short for full articles',
      detail: `Rough word count ≈ ${wordCount}. Short notes can still fit letters / Access-style venues; full Q1-like articles are often longer.`,
      relatedFindingIds: [],
    });
  }

  // --- Scores: mid-decent baseline + structure credits − capped issue penalties ---
  // Calibrated so a clean IMRaD IEEE draft lands ~75–90 (not crushed, not fake-perfect).
  const scores: MutableScores = { q1: 58, q2: 66, ieee: 55 };
  const breakdown: ScoreBreakdownItem[] = [];

  const corePresent = [
    hasAbstract && 'Abstract',
    hasIntro && 'Introduction',
    hasMethods && 'Methods',
    hasResults && 'Results/Discussion',
    hasRefs && 'References',
  ].filter(Boolean) as string[];
  if (corePresent.length) {
    applyFactor(scores, breakdown, {
      id: 'structure-core',
      label: `Core sections present (${corePresent.length}/5: ${corePresent.join(', ')})`,
      q1Delta: corePresent.length * 4,
      q2Delta: corePresent.length * 3.2,
      ieeeDelta: (hasMethods ? 4 : 0) + (hasResults ? 2 : 0) + (hasAbstract ? 1 : 0),
    });
  }
  if (hasConclusion) {
    applyFactor(scores, breakdown, {
      id: 'structure-conclusion',
      label: 'Conclusion section present',
      q1Delta: 2,
      q2Delta: 2,
      ieeeDelta: 1,
    });
  }

  const missingCore = ['Abstract', 'Introduction', 'Methods', 'References'].filter(
    (s) => !sections.has(s as SectionName)
  );
  if (missingCore.length) {
    applyFactor(scores, breakdown, {
      id: 'structure-missing',
      label: `Missing or unclear core sections: ${missingCore.join(', ')}`,
      q1Delta: -(missingCore.length * 8),
      q2Delta: -(missingCore.length * 5),
      ieeeDelta: missingCore.includes('Methods') ? -10 : -2,
    });
  }
  if (!hasResults) {
    applyFactor(scores, breakdown, {
      id: 'structure-results',
      label: 'No clear Results/Discussion section',
      q1Delta: -6,
      q2Delta: -4,
      ieeeDelta: -3,
    });
  }

  if (noveltyOpen.count > 0) {
    const n = Math.min(noveltyOpen.count, 4);
    applyFactor(scores, breakdown, {
      id: 'novelty',
      label: `${noveltyOpen.count} open novelty-claim flag(s)`,
      q1Delta: -(n * 4),
      q2Delta: -(n * 2),
      ieeeDelta: -(n * 3),
    });
  }
  if (numInconsistOpen.count > 0) {
    const n = Math.min(numInconsistOpen.count, 4);
    applyFactor(scores, breakdown, {
      id: 'numerical-inconsistency',
      label: `${numInconsistOpen.count} numerical inconsistency pair(s)`,
      q1Delta: -(n * 6),
      q2Delta: -(n * 3.5),
      ieeeDelta: -(n * 5),
    });
  }
  if (numOpen.count > 0) {
    const n = Math.min(numOpen.count, 5);
    applyFactor(scores, breakdown, {
      id: 'numerical-ambiguity',
      label: `${numOpen.count} numerical-ambiguity flag(s)`,
      q1Delta: -(n * 3),
      q2Delta: -(n * 1.5),
      ieeeDelta: -(n * 3.5),
    });
  }
  if (pubOpen.count > 0) {
    const n = Math.min(pubOpen.count, 5);
    applyFactor(scores, breakdown, {
      id: 'pub-craft',
      label: `${pubOpen.count} publication-craft flag(s)`,
      q1Delta: -(n * 2.5),
      q2Delta: -(n * 1.5),
      ieeeDelta: -(n * 3),
    });
  }
  if (citationOpen.count > 0) {
    const q1Pen = Math.min(22, citationOpen.count * 3);
    const q2Pen = Math.min(14, citationOpen.count * 2);
    const ieeePen = Math.min(14, citationOpen.count * 2.5);
    applyFactor(scores, breakdown, {
      id: 'citations',
      label: `${citationOpen.count} open citation-related finding(s)`,
      q1Delta: -q1Pen,
      q2Delta: -q2Pen,
      ieeeDelta: -ieeePen,
    });
  }
  if (grammarOpen.count > 8) {
    const over = grammarOpen.count - 8;
    applyFactor(scores, breakdown, {
      id: 'grammar',
      label: `${grammarOpen.count} open grammar findings (above soft bar of 8)`,
      q1Delta: -Math.min(14, over * 1.2),
      q2Delta: -Math.min(8, over * 0.8),
      ieeeDelta: -Math.min(10, over * 1),
    });
  }
  if (aiOpen.count > 0) {
    const n = Math.min(aiOpen.count, 5);
    applyFactor(scores, breakdown, {
      id: 'ai',
      label: `${aiOpen.count} open AI-related finding(s)`,
      q1Delta: -(n * 5),
      q2Delta: -(n * 3),
      ieeeDelta: -(n * 4),
    });
  }
  if (simOpen.count > 0) {
    const n = Math.min(simOpen.count, 6);
    applyFactor(scores, breakdown, {
      id: 'similarity',
      label: `${simOpen.count} open similarity action(s)`,
      q1Delta: -(n * 4),
      q2Delta: -(n * 2.5),
      ieeeDelta: -(n * 2),
    });
  }

  if (opts?.similarityPct != null && opts.similarityPct > 25) {
    applyFactor(scores, breakdown, {
      id: 'sim-pct',
      label: `Overall similarity report ≈ ${Math.round(opts.similarityPct)}% (>25%)`,
      q1Delta: -6,
      q2Delta: -3,
      ieeeDelta: -2,
    });
  }
  if (opts?.aiPct != null && opts.aiPct > 30) {
    applyFactor(scores, breakdown, {
      id: 'ai-pct',
      label: `Overall AI-report ≈ ${Math.round(opts.aiPct)}% (>30%)`,
      q1Delta: -6,
      q2Delta: -3,
      ieeeDelta: -5,
    });
  }

  if (citationStyleIsIeee) {
    applyFactor(scores, breakdown, {
      id: 'ieee-style',
      label: 'IEEE citation style detected',
      q1Delta: 1,
      q2Delta: 1,
      ieeeDelta: 8,
    });
  } else {
    applyFactor(scores, breakdown, {
      id: 'ieee-style-miss',
      label: `Citation style is ${paper.detectedCitationStyle} (not IEEE)`,
      q1Delta: 0,
      q2Delta: 0,
      ieeeDelta: -5,
    });
  }
  if (refCount >= 25) {
    applyFactor(scores, breakdown, {
      id: 'refs-dense',
      label: `Dense reference list (${refCount} entries)`,
      q1Delta: 3,
      q2Delta: 2,
      ieeeDelta: 5,
    });
  } else if (refCount >= 15) {
    applyFactor(scores, breakdown, {
      id: 'refs-ok',
      label: `Solid reference list (${refCount} entries)`,
      q1Delta: 2,
      q2Delta: 1,
      ieeeDelta: 3,
    });
  } else if (refCount > 0 && refCount < 10 && hasMethods) {
    applyFactor(scores, breakdown, {
      id: 'refs-thin',
      label: `Thin reference list (${refCount} entries)`,
      q1Delta: -3,
      q2Delta: -2,
      ieeeDelta: -4,
    });
  }
  if (citeCount >= 20) {
    applyFactor(scores, breakdown, {
      id: 'in-text-cites',
      label: `Frequent in-text citations (${citeCount})`,
      q1Delta: 2,
      q2Delta: 1,
      ieeeDelta: 3,
    });
  }
  if (wordCount >= 3500 && wordCount <= 12000) {
    applyFactor(scores, breakdown, {
      id: 'length-ok',
      label: `Full-article length band (≈${wordCount} words)`,
      q1Delta: 2,
      q2Delta: 2,
      ieeeDelta: 1,
    });
  }
  if (qualityOpen.count === 0 && numInconsistOpen.count === 0) {
    applyFactor(scores, breakdown, {
      id: 'quality-clean',
      label: 'No open manuscript-quality or numerical-inconsistency flags',
      q1Delta: 5,
      q2Delta: 4,
      ieeeDelta: 4,
    });
  }

  if (opts?.model?.available) {
    applyFactor(scores, breakdown, {
      id: 'local-model',
      label: 'Optional local readiness model adjustment',
      q1Delta: opts.model.q1Boost ?? 0,
      q2Delta: opts.model.q2Boost ?? 0,
      ieeeDelta: opts.model.ieeeBoost ?? 0,
    });
  }

  // Q2-like bar sits above Q1-like by construction
  if (scores.q2 < scores.q1 + 4) {
    const lift = scores.q1 + 4 - scores.q2;
    applyFactor(scores, breakdown, {
      id: 'q2-floor',
      label: 'Q2-like bar kept above Q1-like (more lenient checklist)',
      q1Delta: 0,
      q2Delta: lift,
      ieeeDelta: 0,
    });
  }

  const q1LikeScore = clampScore(scores.q1);
  const q2LikeScore = clampScore(scores.q2);
  const ieeeScore = clampScore(scores.ieee);

  // Sort breakdown by absolute impact (largest first), keep top ~12 for UI
  breakdown.sort(
    (a, b) =>
      Math.abs(b.q1Delta) + Math.abs(b.q2Delta) + Math.abs(b.ieeeDelta) -
      (Math.abs(a.q1Delta) + Math.abs(a.q2Delta) + Math.abs(a.ieeeDelta))
  );
  const scoreBreakdown = breakdown.slice(0, 12);

  const journalSuggestions = suggestJournals(lead, fieldGuess, {
    ieeeOriented: citationStyleIsIeee || ieeeScore >= 70,
    openAccessLean: wordCount < 4000 || !hasConclusion,
    methodsWeak: !hasMethods || pubOpen.count > 0,
    manuscriptShort: wordCount > 0 && wordCount < 3500,
    structureGaps: missingCore.length + (hasResults ? 0 : 1),
    preferLetters: (!hasMethods && hasResults) || (wordCount > 0 && wordCount < 2500),
  });

  const summary = buildSummary({
    q1LikeScore,
    q2LikeScore,
    ieeeScore,
    gapCount: gaps.filter((g) => g.severity !== 'low').length,
    fieldGuess,
  });

  // Sort gaps: high → medium → low
  const sevRank = { high: 0, medium: 1, low: 2 };
  gaps.sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);

  return {
    q1LikeScore,
    q2LikeScore,
    ieeeScore,
    summary,
    gaps,
    journalSuggestions,
    checklist,
    scoreBreakdown,
    fieldGuess,
    mappingNote: MAPPING_NOTE,
    modelUsed: Boolean(opts?.model?.available),
    modelSource: opts?.model?.available ? opts.model.source || 'hub' : 'none',
  };
}

function missingSectionNote(sections: Set<SectionName>): string {
  const missing = CORE_SECTIONS.filter((s) => {
    if (s === 'Results' && sections.has('Discussion')) return false;
    if (s === 'Discussion' && sections.has('Results')) return false;
    return !sections.has(s);
  });
  return missing.length === 0
    ? 'Abstract, Introduction, Methods, Results/Discussion, Conclusion, References look present.'
    : `Missing or unclear: ${missing.join(', ')}.`;
}

function buildSummary(args: {
  q1LikeScore: number;
  q2LikeScore: number;
  ieeeScore: number;
  gapCount: number;
  fieldGuess: VenueField[];
}): string {
  const { q1LikeScore, q2LikeScore, ieeeScore, gapCount, fieldGuess } = args;
  const fields = fieldGuess.join(', ');
  if (q1LikeScore >= 72 && gapCount <= 2) {
    return (
      `Heuristic signals look relatively strong for a selective (Q1-like) bar ` +
      `(${q1LikeScore}/100) and a Q2-like bar (${q2LikeScore}/100). IEEE-oriented craft score ` +
      `${ieeeScore}/100. Inferred topical fields: ${fields}. These are estimates only — not peer review.`
    );
  }
  if (q2LikeScore >= 60) {
    return (
      `Closer to a Q2-like readiness bar (${q2LikeScore}/100) than a selective Q1-like bar ` +
      `(${q1LikeScore}/100). IEEE-oriented craft ${ieeeScore}/100. About ${gapCount} priority gap(s) ` +
      `remain. Fields: ${fields}. Fix gaps before treating any venue list as actionable.`
    );
  }
  return (
    `Readiness bars are still developing (Q1-like ${q1LikeScore}/100, Q2-like ${q2LikeScore}/100; ` +
    `IEEE-oriented ${ieeeScore}/100). ${gapCount} priority correction(s) stand out. ` +
    `Fields: ${fields}. Use the gap list and score breakdown — scores are heuristics, not acceptance odds.`
  );
}

function formatBoost(
  format: VenueFormat | undefined,
  opts: {
    methodsWeak: boolean;
    manuscriptShort: boolean;
    preferLetters: boolean;
    openAccessLean: boolean;
    structureGaps: number;
  }
): { delta: number; note?: string } {
  const fmt = format || 'full_article';
  if (opts.preferLetters || opts.manuscriptShort || opts.methodsWeak) {
    if (fmt === 'letter' || fmt === 'communication') {
      return {
        delta: 4,
        note: 'Short / lighter-methods signal → letter or communication formats may fit better than full articles',
      };
    }
    if (fmt === 'access_oa') {
      return {
        delta: 2,
        note: 'Open-access multidisciplinary formats can fit shorter or uneven manuscripts (still not acceptance)',
      };
    }
    if (fmt === 'preprint') {
      return { delta: 2, note: 'Preprint classes are useful staging grounds while methods/structure mature' };
    }
    if (fmt === 'full_article' && opts.structureGaps >= 2) {
      return { delta: -2 };
    }
  }
  if (opts.openAccessLean && (fmt === 'access_oa' || fmt === 'preprint')) {
    return { delta: 1 };
  }
  return { delta: 0 };
}

function scoreVenueAgainstPaper(
  v: CuratedVenue,
  leadText: string,
  fields: VenueField[],
  opts: {
    ieeeOriented: boolean;
    openAccessLean: boolean;
    methodsWeak: boolean;
    manuscriptShort: boolean;
    structureGaps: number;
    preferLetters: boolean;
  }
): { score: number; matched: string[]; gapNote?: string } {
  let score = 0;
  const matched: string[] = [];
  for (const kw of v.keywords) {
    if (leadText.includes(kw)) {
      score += 2;
      matched.push(kw);
    }
  }
  for (const f of fields) {
    if (v.fields.includes(f)) score += 3;
  }
  if (opts.ieeeOriented && v.ieeeOriented) score += 2;
  if (opts.openAccessLean && v.openAccess) score += 1;
  if (fields.includes('general') && v.fields.includes('general')) score += 1;

  // Soft prior so catalog fallbacks still rank (never all zeros)
  score += 1;

  const boost = formatBoost(v.format, opts);
  score += boost.delta;
  return { score, matched, gapNote: boost.note };
}

/**
 * Rank curated venues from topic tokens + readiness/format signals.
 * Always returns VENUE_LIST_MIN…VENUE_LIST_MAX rows when the catalog is non-empty.
 */
export function suggestJournals(
  leadText: string,
  fields: VenueField[],
  opts: {
    ieeeOriented: boolean;
    openAccessLean: boolean;
    methodsWeak?: boolean;
    manuscriptShort?: boolean;
    structureGaps?: number;
    preferLetters?: boolean;
  }
): JournalSuggestion[] {
  const fullOpts = {
    ieeeOriented: opts.ieeeOriented,
    openAccessLean: opts.openAccessLean,
    methodsWeak: Boolean(opts.methodsWeak),
    manuscriptShort: Boolean(opts.manuscriptShort),
    structureGaps: opts.structureGaps ?? 0,
    preferLetters: Boolean(opts.preferLetters),
  };

  const scored = CURATED_VENUES.map((v) => {
    const { score, matched, gapNote } = scoreVenueAgainstPaper(v, leadText, fields, fullOpts);
    return { v, score, matched, gapNote };
  }).sort((a, b) => b.score - a.score || a.v.name.localeCompare(b.v.name));

  // Prefer positive topical hits, then fill from the rest so the list is never empty/tiny
  const withTopic = scored.filter((x) => x.matched.length > 0 || x.score >= 5);
  const pool = withTopic.length >= VENUE_LIST_MIN ? withTopic : scored;
  const target = Math.min(
    VENUE_LIST_MAX,
    Math.max(VENUE_LIST_MIN, Math.min(pool.length, VENUE_LIST_MAX))
  );
  const picked = pool.slice(0, target);

  // Absolute fallback if catalog somehow empty
  if (!picked.length) {
    return CURATED_VENUES.slice(0, VENUE_LIST_MIN).map((v) => ({
      name: v.name,
      publisherHint: v.publisherHint,
      reason: 'Catalog fallback — topical signals were weak. Heuristic fit only — not acceptance.',
      confidence: 'low' as const,
      caution: v.caution,
      matchKeywords: [],
      source: 'heuristic' as const,
    }));
  }

  return picked.map(({ v, score, matched, gapNote }) => {
    const confidence: 'low' | 'medium' =
      score >= 10 && matched.length >= 2 && (v.fields.some((f) => fields.includes(f)) || matched.length >= 3)
        ? 'medium'
        : 'low';
    const reasonParts: string[] = [];
    if (matched.length) {
      reasonParts.push(`Keyword overlap: ${matched.slice(0, 5).join(', ')}`);
    }
    const fieldOverlap = v.fields.filter((f) => fields.includes(f));
    if (fieldOverlap.length) {
      reasonParts.push(`Field guess overlap: ${fieldOverlap.join(', ')}`);
    }
    if (gapNote) reasonParts.push(gapNote);
    if (!reasonParts.length) {
      reasonParts.push('Broad topical / format fallback from curated open / example venues');
    }
    return {
      name: v.name,
      publisherHint: v.publisherHint,
      reason: reasonParts.join('. ') + '. Heuristic fit only — not a prediction of acceptance.',
      confidence,
      caution: v.caution,
      matchKeywords: matched.slice(0, 8),
      source: 'heuristic' as const,
    };
  });
}

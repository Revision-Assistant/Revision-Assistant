/**
 * Submission readiness checklist — venue-style-profile checks that mirror what desk
 * editors screen first: abstract length, keywords, section completeness, reference
 * count sanity, figure/table callout integrity, title length.
 *
 * Profiles are style archetypes ("IEEE-style", "Elsevier-style", generic) — NOT the
 * official author guidelines of any publisher. Authors must always verify against the
 * target journal's own Instructions for Authors.
 */

import type { ParsedPaper, SectionName } from '../../types';

export type VenueStyleId = 'ieee' | 'elsevier' | 'generic';

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface SubmissionCheckItem {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface SubmissionChecklistResult {
  style: VenueStyleId;
  styleLabel: string;
  items: SubmissionCheckItem[];
  passCount: number;
  warnCount: number;
  failCount: number;
  summary: string;
}

interface StyleProfile {
  label: string;
  abstractMin: number;
  abstractMax: number;
  keywordMin: number;
  keywordMax: number;
  keywordHeading: string;
  refMin: number;
  refMax: number;
  titleMaxWords: number;
  expectsNumericCitations: boolean;
}

export const VENUE_STYLES: Record<VenueStyleId, StyleProfile> = {
  ieee: {
    label: 'IEEE-style',
    abstractMin: 100,
    abstractMax: 250,
    keywordMin: 3,
    keywordMax: 8,
    keywordHeading: 'Index Terms',
    refMin: 15,
    refMax: 120,
    titleMaxWords: 20,
    expectsNumericCitations: true,
  },
  elsevier: {
    label: 'Elsevier-style',
    abstractMin: 100,
    abstractMax: 300,
    keywordMin: 3,
    keywordMax: 7,
    keywordHeading: 'Keywords',
    refMin: 20,
    refMax: 150,
    titleMaxWords: 25,
    expectsNumericCitations: false,
  },
  generic: {
    label: 'Generic journal',
    abstractMin: 100,
    abstractMax: 350,
    keywordMin: 3,
    keywordMax: 8,
    keywordHeading: 'Keywords',
    refMin: 10,
    refMax: 200,
    titleMaxWords: 30,
    expectsNumericCitations: false,
  },
};

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function abstractText(paper: ParsedPaper): string | null {
  const abs = paper.sections.find((s) => s.name === 'Abstract');
  if (!abs) return null;
  return paper.fullText.slice(abs.startOffset, abs.endOffset);
}

/** Parse a "Keywords: a, b, c" / "Index Terms—a, b, c" line near the top of the paper. */
export function extractKeywords(fullText: string): string[] {
  const head = fullText.slice(0, 6000);
  const m = head.match(
    /(?:keywords|key words|index terms)\s*[:\u2014\u2013-]\s*([^\n]{3,400})/i
  );
  if (!m) return [];
  return m[1]
    .split(/[;,·]/)
    .map((k) => k.trim().replace(/\.$/, ''))
    .filter((k) => k.length > 1 && k.length < 80)
    .slice(0, 20);
}

const ROMAN: Record<string, number> = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
  xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15,
};

function collectCallouts(text: string, kind: 'figure' | 'table'): Set<number> {
  const nums = new Set<number>();
  const re =
    kind === 'figure'
      ? /\b(?:fig\.?|figure)\s*(\d{1,3})\b/gi
      : /\b(?:table|tab\.)\s*(\d{1,3}|[ivx]{1,5})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const token = m[1].toLowerCase();
    const n = /^\d+$/.test(token) ? parseInt(token, 10) : ROMAN[token] || 0;
    if (n >= 1 && n <= 200) nums.add(n);
  }
  return nums;
}

/** Body text without the reference list, so bibliography titles don't count as callouts. */
function bodyText(paper: ParsedPaper): string {
  const refs = paper.sections.find((s) => s.name === 'References');
  if (!refs) return paper.fullText;
  return paper.fullText.slice(0, refs.startOffset);
}

export interface CalloutReport {
  count: number;
  maxNumber: number;
  missing: number[];
}

export function analyzeCallouts(paper: ParsedPaper, kind: 'figure' | 'table'): CalloutReport {
  const nums = collectCallouts(bodyText(paper), kind);
  if (nums.size === 0) return { count: 0, maxNumber: 0, missing: [] };
  const max = Math.max(...nums);
  const missing: number[] = [];
  for (let i = 1; i <= max; i++) {
    if (!nums.has(i)) missing.push(i);
  }
  return { count: nums.size, maxNumber: max, missing };
}

const REQUIRED_SECTIONS: SectionName[] = ['Abstract', 'Introduction', 'Methods', 'References'];

export function buildSubmissionChecklist(
  paper: ParsedPaper,
  style: VenueStyleId,
  title = ''
): SubmissionChecklistResult {
  const profile = VENUE_STYLES[style];
  const items: SubmissionCheckItem[] = [];

  // 1. Abstract presence + length
  const abs = abstractText(paper);
  if (!abs) {
    items.push({
      id: 'abstract',
      label: 'Abstract present and within length range',
      status: 'fail',
      detail: 'No Abstract section was detected. Missing key elements is a common desk-rejection trigger.',
    });
  } else {
    const w = wordCount(abs);
    const ok = w >= profile.abstractMin && w <= profile.abstractMax;
    items.push({
      id: 'abstract',
      label: 'Abstract present and within length range',
      status: ok ? 'pass' : 'warn',
      detail: ok
        ? `Abstract ≈ ${w} words — inside the ${profile.abstractMin}–${profile.abstractMax} word range typical of ${profile.label} venues.`
        : `Abstract ≈ ${w} words; ${profile.label} venues typically expect ${profile.abstractMin}–${profile.abstractMax}. Verify the target journal's own limit.`,
    });
  }

  // 2. Keywords
  const keywords = extractKeywords(paper.fullText);
  if (keywords.length === 0) {
    items.push({
      id: 'keywords',
      label: `${profile.keywordHeading} line present`,
      status: 'warn',
      detail: `No "${profile.keywordHeading}" (or Keywords) line was detected near the abstract. Most journals require ${profile.keywordMin}–${profile.keywordMax} keywords for indexing.`,
    });
  } else {
    const ok = keywords.length >= profile.keywordMin && keywords.length <= profile.keywordMax;
    items.push({
      id: 'keywords',
      label: `${profile.keywordHeading} line present`,
      status: ok ? 'pass' : 'warn',
      detail: ok
        ? `${keywords.length} keyword(s) detected: ${keywords.slice(0, 6).join(', ')}${keywords.length > 6 ? '…' : ''}.`
        : `${keywords.length} keyword(s) detected — ${profile.label} venues usually ask for ${profile.keywordMin}–${profile.keywordMax}.`,
    });
  }

  // 3. Core sections
  const present = new Set(paper.sections.map((s) => s.name));
  const hasResultsLike = present.has('Results') || present.has('Discussion');
  const missingCore = REQUIRED_SECTIONS.filter((s) => !present.has(s));
  if (!hasResultsLike) missingCore.push('Results');
  items.push({
    id: 'sections',
    label: 'Core sections present (Abstract, Introduction, Methods, Results/Discussion, References)',
    status: missingCore.length === 0 ? 'pass' : missingCore.length === 1 ? 'warn' : 'fail',
    detail:
      missingCore.length === 0
        ? 'All core IMRaD-style sections were detected.'
        : `Missing or unclear: ${missingCore.join(', ')}. If your field uses different headings, editors may still expect these elements to be identifiable.`,
  });
  items.push({
    id: 'conclusion',
    label: 'Conclusion section present',
    status: present.has('Conclusion') ? 'pass' : 'warn',
    detail: present.has('Conclusion')
      ? 'Conclusion section detected.'
      : 'No explicit Conclusion detected. Many venues expect one; some allow it merged into Discussion.',
  });

  // 4. Reference count sanity
  const refCount = paper.references.length;
  if (refCount === 0) {
    items.push({
      id: 'refcount',
      label: 'Reference count sanity',
      status: 'fail',
      detail: 'No parsed reference entries. Either the reference list is missing or the parser could not read it — check the References section.',
    });
  } else {
    const ok = refCount >= profile.refMin && refCount <= profile.refMax;
    items.push({
      id: 'refcount',
      label: 'Reference count sanity',
      status: ok ? 'pass' : 'warn',
      detail: ok
        ? `${refCount} reference entries — plausible for a ${profile.label} full article.`
        : refCount < profile.refMin
          ? `Only ${refCount} reference entries. ${profile.label} full articles commonly cite ${profile.refMin}+ works; thin related-work coverage is a frequent reviewer complaint.`
          : `${refCount} reference entries is unusually many — verify all are actually cited and needed.`,
    });
  }

  // 5. Figure / table callout integrity
  const figs = analyzeCallouts(paper, 'figure');
  const tables = analyzeCallouts(paper, 'table');
  const calloutProblems: string[] = [];
  if (figs.missing.length > 0) {
    calloutProblems.push(
      `Figure numbering skips: ${figs.missing.map((n) => `Fig. ${n}`).join(', ')} never called out while Fig. ${figs.maxNumber} is.`
    );
  }
  if (tables.missing.length > 0) {
    calloutProblems.push(
      `Table numbering skips: ${tables.missing.map((n) => `Table ${n}`).join(', ')} never called out while Table ${tables.maxNumber} is.`
    );
  }
  items.push({
    id: 'callouts',
    label: 'Figure / table callouts are sequential',
    status: calloutProblems.length === 0 ? 'pass' : 'warn',
    detail:
      calloutProblems.length === 0
        ? figs.count + tables.count === 0
          ? 'No figure or table callouts detected — fine for text-only papers, otherwise add "Fig. 1 shows…"-style callouts.'
          : `${figs.count} figure and ${tables.count} table callout number(s) detected, no gaps in numbering.`
        : calloutProblems.join(' ') + ' A skipped number often means a deleted figure whose callouts were not renumbered.',
  });

  // 6. Citation style expectation
  if (profile.expectsNumericCitations) {
    const isNumeric = paper.detectedCitationStyle === 'IEEE';
    items.push({
      id: 'citestyle',
      label: 'Citation style matches venue archetype',
      status: isNumeric ? 'pass' : 'warn',
      detail: isNumeric
        ? 'Numeric bracket citations detected — matches IEEE-style venues.'
        : `Detected style is ${paper.detectedCitationStyle}; IEEE-style venues expect numeric [1] citations.`,
    });
  }

  // 7. Title length
  if (title.trim()) {
    const tw = wordCount(title);
    items.push({
      id: 'title',
      label: 'Title length reasonable',
      status: tw <= profile.titleMaxWords ? 'pass' : 'warn',
      detail:
        tw <= profile.titleMaxWords
          ? `Title is ${tw} words.`
          : `Title is ${tw} words — long titles get truncated in indexes; many venues suggest ≤ ${profile.titleMaxWords} words.`,
    });
  }

  const passCount = items.filter((i) => i.status === 'pass').length;
  const warnCount = items.filter((i) => i.status === 'warn').length;
  const failCount = items.filter((i) => i.status === 'fail').length;

  const summary =
    failCount > 0
      ? `${failCount} blocking item(s) and ${warnCount} warning(s) against the ${profile.label} archetype — fix the failures before submission.`
      : warnCount > 0
        ? `No blocking items; ${warnCount} warning(s) worth a look against the ${profile.label} archetype.`
        : `All ${passCount} checks pass against the ${profile.label} archetype. Still verify the target journal's own author guidelines.`;

  return {
    style,
    styleLabel: profile.label,
    items,
    passCount,
    warnCount,
    failCount,
    summary,
  };
}

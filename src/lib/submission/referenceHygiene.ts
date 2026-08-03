/**
 * Reference hygiene checks: literature age profile, missing DOIs, duplicate entries,
 * heuristic venue cautions, and an optional retraction check via the public Crossref API.
 *
 * Legal care:
 * - Only the free public Crossref REST API is used (DOIs only are sent; never manuscript text).
 * - Venue cautions are HEURISTIC pattern flags, phrased as "verify indexing yourself" —
 *   never an accusation that a specific journal is predatory.
 */

import type { ReferenceEntry } from '../../types';

export type HygieneSeverity = 'warn' | 'info';

export interface HygieneIssue {
  id: string;
  severity: HygieneSeverity;
  title: string;
  detail: string;
  refIndexes: number[];
}

export interface ReferenceHygieneResult {
  total: number;
  withYear: number;
  withDoi: number;
  olderThan10: number;
  recent5: number;
  issues: HygieneIssue[];
  summary: string;
}

const DOI_RE = /\b10\.\d{4,9}\/[^\s"'<>,;)\]]+/i;

export function extractDoi(raw: string): string | null {
  const m = raw.match(DOI_RE);
  if (!m) return null;
  return m[0].replace(/[.,;]+$/, '');
}

function refYear(ref: ReferenceEntry): number | null {
  if (ref.year) {
    const y = parseInt(ref.year, 10);
    if (y >= 1900 && y <= 2100) return y;
  }
  const m = ref.raw.match(/\b(19[5-9]\d|20[0-4]\d)\b/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Pattern heuristics for venue names that commonly warrant an indexing double-check
 * (very broad multi-superlative titles). This is a caution to verify, NOT an accusation.
 */
const VENUE_CAUTION_PATTERNS: RegExp[] = [
  /\b(?:world|global|universal)\s+journal\s+of\s+advanced?\b/i,
  /\binternational\s+journal\s+of\s+(?:advanced?|innovative|emerging)\s+(?:research|trends|science and)/i,
  /\bjournal\s+of\s+(?:advanced?|innovative)\s+research\s+in\b/i,
  /\b(?:american|british|european)\s+(?:open|online)\s+journal\b/i,
  /\bresearch\s+journal\s+international\b/i,
];

function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function analyzeReferenceHygiene(
  references: ReferenceEntry[],
  opts?: { currentYear?: number }
): ReferenceHygieneResult {
  const now = opts?.currentYear ?? new Date().getFullYear();
  const total = references.length;
  const issues: HygieneIssue[] = [];

  const years = references
    .map((r) => ({ ref: r, year: refYear(r) }))
    .filter((x): x is { ref: ReferenceEntry; year: number } => x.year != null);
  const withYear = years.length;
  const olderThan10 = years.filter((x) => now - x.year > 10).length;
  const recent5 = years.filter((x) => now - x.year <= 5).length;
  const withDoi = references.filter((r) => extractDoi(r.raw) != null).length;

  if (total === 0) {
    return {
      total: 0,
      withYear: 0,
      withDoi: 0,
      olderThan10: 0,
      recent5: 0,
      issues: [],
      summary: 'No parsed reference entries — hygiene checks need a readable reference list.',
    };
  }

  // Aged-literature dominance
  if (withYear >= 5 && olderThan10 / withYear > 0.6) {
    issues.push({
      id: 'aged',
      severity: 'warn',
      title: 'Reference list skews old',
      detail: `${olderThan10} of ${withYear} dated references are older than 10 years (${Math.round((olderThan10 / withYear) * 100)}%). Editors read a stale bibliography as weak engagement with current literature.`,
      refIndexes: years.filter((x) => now - x.year > 10).map((x) => x.ref.index),
    });
  }
  if (withYear >= 5 && recent5 === 0) {
    issues.push({
      id: 'no-recent',
      severity: 'warn',
      title: 'No references from the last 5 years',
      detail: 'None of the dated references are from the last 5 years. Reviewers often flag this as a sign the related-work survey is outdated.',
      refIndexes: [],
    });
  }

  // Missing DOIs
  if (total >= 5 && withDoi / total < 0.3) {
    issues.push({
      id: 'missing-doi',
      severity: 'info',
      title: 'Most references lack DOIs',
      detail: `Only ${withDoi} of ${total} entries include a DOI. Many journals now require DOIs where they exist; they also enable retraction checks. Crossref's free metadata search can recover them.`,
      refIndexes: [],
    });
  }

  // Duplicate entries (same normalized title)
  const seen = new Map<string, number[]>();
  for (const r of references) {
    if (!r.title || r.title.length < 15) continue;
    const key = normalizeTitle(r.title);
    const list = seen.get(key) || [];
    list.push(r.index);
    seen.set(key, list);
  }
  const dupes = [...seen.values()].filter((v) => v.length > 1);
  if (dupes.length > 0) {
    issues.push({
      id: 'duplicates',
      severity: 'warn',
      title: 'Possible duplicate reference entries',
      detail: `${dupes.length} title(s) appear more than once in the reference list (entries ${dupes.map((d) => d.join(' & ')).join('; ')}). Duplicates read as careless formatting.`,
      refIndexes: dupes.flat(),
    });
  }

  // Heuristic venue cautions
  const cautionRefs: number[] = [];
  for (const r of references) {
    const target = `${r.venue || ''} ${r.raw}`;
    if (VENUE_CAUTION_PATTERNS.some((p) => p.test(target))) {
      cautionRefs.push(r.index);
    }
  }
  if (cautionRefs.length > 0) {
    issues.push({
      id: 'venue-caution',
      severity: 'info',
      title: 'Venue caution: verify indexing',
      detail: `${cautionRefs.length} referenced venue name(s) match very broad title patterns (entries ${cautionRefs.slice(0, 8).join(', ')}). This is a heuristic caution only — check the venue's indexing (e.g. DOAJ, Scopus) yourself before relying on it. It is not an accusation against any journal.`,
      refIndexes: cautionRefs,
    });
  }

  const summary =
    issues.length === 0
      ? `${total} references: age profile and formatting look reasonable (${withDoi} with DOIs, ${recent5} from the last 5 years).`
      : `${total} references, ${issues.filter((i) => i.severity === 'warn').length} warning(s) and ${issues.filter((i) => i.severity === 'info').length} note(s). ${withDoi} entries have DOIs.`;

  return { total, withYear, withDoi, olderThan10, recent5, issues, summary };
}

// ---------------------------------------------------------------------------
// Retraction check via public Crossref API (DOIs only; opt-in button in the UI)
// ---------------------------------------------------------------------------

export interface RetractionHit {
  refIndex: number;
  doi: string;
  noticeType: string;
  noticeDoi: string | null;
}

export interface RetractionCheckResult {
  checked: number;
  skippedNoDoi: number;
  hits: RetractionHit[];
  errors: number;
}

interface CrossrefUpdate {
  DOI?: string;
  type?: string;
  label?: string;
}

const RETRACTION_TYPE_RE = /retract|withdraw|removal|concern/i;

function findUpdate(message: Record<string, unknown>): CrossrefUpdate | null {
  for (const field of ['update-to', 'updated-by']) {
    const arr = message[field];
    if (!Array.isArray(arr)) continue;
    for (const u of arr as CrossrefUpdate[]) {
      if (u && typeof u.type === 'string' && RETRACTION_TYPE_RE.test(u.type)) return u;
    }
  }
  return null;
}

/**
 * Check parsed references with DOIs against Crossref's public works endpoint, which
 * carries retraction/withdrawal/concern updates from publishers and Retraction Watch.
 * Sends only the DOI string — never any manuscript text.
 */
export async function checkRetractions(
  references: ReferenceEntry[],
  opts?: { maxLookups?: number; fetchImpl?: typeof fetch }
): Promise<RetractionCheckResult> {
  const doFetch = opts?.fetchImpl ?? fetch;
  const maxLookups = opts?.maxLookups ?? 40;

  const targets: { refIndex: number; doi: string }[] = [];
  let skippedNoDoi = 0;
  for (const r of references) {
    const doi = extractDoi(r.raw);
    if (doi) targets.push({ refIndex: r.index, doi });
    else skippedNoDoi += 1;
  }

  const hits: RetractionHit[] = [];
  let errors = 0;
  let checked = 0;

  const queue = targets.slice(0, maxLookups);
  const CONCURRENCY = 4;

  const worker = async () => {
    while (queue.length > 0) {
      const t = queue.shift();
      if (!t) return;
      try {
        const res = await doFetch(
          `https://api.crossref.org/works/${encodeURIComponent(t.doi)}`
        );
        checked += 1;
        if (!res.ok) {
          // 404 = DOI not in Crossref; not an error worth surfacing
          if (res.status !== 404) errors += 1;
          continue;
        }
        const data = (await res.json()) as { message?: Record<string, unknown> };
        const update = data.message ? findUpdate(data.message) : null;
        if (update) {
          hits.push({
            refIndex: t.refIndex,
            doi: t.doi,
            noticeType: update.label || update.type || 'update',
            noticeDoi: update.DOI || null,
          });
        }
      } catch {
        checked += 1;
        errors += 1;
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  return { checked, skippedNoDoi, hits, errors };
}

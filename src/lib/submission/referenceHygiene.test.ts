/**
 * Unit tests for reference hygiene + the Crossref retraction check (mocked fetch).
 * Run: npx tsx src/lib/submission/referenceHygiene.test.ts
 */
import {
  analyzeReferenceHygiene,
  checkRetractions,
  extractDoi,
} from './referenceHygiene';
import type { ReferenceEntry } from '../../types';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

function ref(index: number, over: Partial<ReferenceEntry> = {}): ReferenceEntry {
  return {
    index,
    raw: `Author ${index}, "Paper ${index}", Journal, 2022.`,
    authors: [],
    year: '2022',
    title: `Paper ${index}`,
    venue: 'IEEE Transactions on Signal Processing',
    startOffset: 0,
    endOffset: 0,
    ...over,
  };
}

// DOI extraction
assert(extractDoi('… doi:10.1109/TSP.2020.1234567.') === '10.1109/TSP.2020.1234567', 'trailing dot stripped');
assert(extractDoi('https://doi.org/10.1000/xyz123,') === '10.1000/xyz123', 'trailing comma stripped');
assert(extractDoi('no doi here') === null, 'no doi → null');

// Aged-literature dominance
const oldRefs = Array.from({ length: 10 }, (_, i) =>
  ref(i + 1, { year: i < 8 ? '2005' : '2024', raw: `Author, "Paper", Journal, ${i < 8 ? 2005 : 2024}.` })
);
const aged = analyzeReferenceHygiene(oldRefs, { currentYear: 2026 });
assert(aged.issues.some((x) => x.id === 'aged'), 'should flag 80% old refs');
assert(!aged.issues.some((x) => x.id === 'no-recent'), '2 recent refs → no no-recent flag');

// No recent refs
const stale = analyzeReferenceHygiene(
  Array.from({ length: 6 }, (_, i) => ref(i + 1, { year: '2015', raw: 'Author, Paper, 2015.' })),
  { currentYear: 2026 }
);
assert(stale.issues.some((x) => x.id === 'no-recent'), 'should flag zero recent refs');

// Missing DOIs
const noDois = analyzeReferenceHygiene(
  Array.from({ length: 8 }, (_, i) => ref(i + 1)),
  { currentYear: 2026 }
);
assert(noDois.issues.some((x) => x.id === 'missing-doi'), 'should note missing DOIs');
const withDois = analyzeReferenceHygiene(
  Array.from({ length: 8 }, (_, i) =>
    ref(i + 1, { raw: `Author, Paper, 2022. doi:10.1109/x.${i}` })
  ),
  { currentYear: 2026 }
);
assert(!withDois.issues.some((x) => x.id === 'missing-doi'), 'all DOIs present → no flag');
assert(withDois.withDoi === 8, `withDoi should be 8, got ${withDois.withDoi}`);

// Duplicates
const dup = analyzeReferenceHygiene(
  [
    ref(1, { title: 'A study of deep learning for MIMO systems' }),
    ref(2, { title: 'A Study of Deep Learning for MIMO Systems!' }),
    ref(3, { title: 'Something completely different about sensors' }),
  ],
  { currentYear: 2026 }
);
assert(dup.issues.some((x) => x.id === 'duplicates'), 'normalized duplicate titles should be flagged');

// Venue caution — heuristic phrasing must stay a caution, not an accusation
const caution = analyzeReferenceHygiene(
  [
    ref(1, {
      venue: 'World Journal of Advanced Research and Reviews',
      raw: 'Author, Paper, World Journal of Advanced Research and Reviews, 2022.',
    }),
    ref(2),
  ],
  { currentYear: 2026 }
);
const cautionIssue = caution.issues.find((x) => x.id === 'venue-caution');
assert(cautionIssue, 'broad-superlative venue name should get a caution');
assert(/verify/i.test(cautionIssue!.title + cautionIssue!.detail), 'caution must ask to verify');
assert(/not an accusation/i.test(cautionIssue!.detail), 'caution must disclaim accusation');
assert(
  !/predatory/i.test(cautionIssue!.title),
  'caution title must not label the venue predatory'
);
const cleanVenues = analyzeReferenceHygiene([ref(1), ref(2)], { currentYear: 2026 });
assert(!cleanVenues.issues.some((x) => x.id === 'venue-caution'), 'normal venues → no caution');

// Retraction check with mocked fetch
const RETRACTED_DOI = '10.1177/1758835920922055';
const mockFetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  const doi = decodeURIComponent(url.split('/works/')[1] || '');
  if (doi === RETRACTED_DOI) {
    return new Response(
      JSON.stringify({
        message: {
          DOI: doi,
          'update-to': [
            { DOI: '10.1177/17588359231172420', type: 'retraction', label: 'Retraction', source: 'retraction-watch' },
          ],
        },
      }),
      { status: 200 }
    );
  }
  if (doi === '10.1000/missing') return new Response('not found', { status: 404 });
  return new Response(JSON.stringify({ message: { DOI: doi } }), { status: 200 });
}) as typeof fetch;

const retractRefs: ReferenceEntry[] = [
  ref(1, { raw: `A retracted work. doi:${RETRACTED_DOI}` }),
  ref(2, { raw: 'A fine work. https://doi.org/10.1109/ok.2020.1' }),
  ref(3, { raw: 'Not in crossref. doi:10.1000/missing' }),
  ref(4, { raw: 'No doi at all, 2020.' }),
];

const res = await checkRetractions(retractRefs, { fetchImpl: mockFetch });
assert(res.checked === 3, `3 DOIs should be checked, got ${res.checked}`);
assert(res.skippedNoDoi === 1, `1 ref without DOI, got ${res.skippedNoDoi}`);
assert(res.hits.length === 1, `exactly 1 retraction hit, got ${res.hits.length}`);
assert(res.hits[0].refIndex === 1 && res.hits[0].doi === RETRACTED_DOI, 'hit maps to ref [1]');
assert(/retraction/i.test(res.hits[0].noticeType), 'notice type surfaced');
assert(res.errors === 0, `404 should not count as an error, got ${res.errors}`);

console.log('referenceHygiene.test.ts: all passed');

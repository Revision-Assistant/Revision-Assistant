/**
 * Unit tests for journal readiness heuristics.
 * Run: npx tsx src/lib/journal/scoreReadiness.test.ts
 */
import { inferFields, scoreReadiness, suggestJournals, VENUE_LIST_MAX, VENUE_LIST_MIN } from './scoreReadiness';
import { CURATED_VENUES } from './venues';
import type { Finding, ParsedPaper } from '../../types';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

function basePaper(over: Partial<ParsedPaper> = {}): ParsedPaper {
  return {
    fullText:
      'Deep learning for wireless beamforming. Abstract. We propose a CNN for MIMO channel estimation. ' +
      'Introduction. Prior work on OFDM. Methods. We train a neural network with n = 500 samples. ' +
      'Results. Accuracy improved from 71% to 76% (p < 0.01). Conclusion. Future work. References.',
    pages: [{ pageNumber: 1, text: '', startOffset: 0, endOffset: 400 }],
    sentences: [],
    sections: [
      { name: 'Abstract', startOffset: 0, endOffset: 40, pageStart: 1 },
      { name: 'Introduction', startOffset: 40, endOffset: 80, pageStart: 1 },
      { name: 'Methods', startOffset: 80, endOffset: 150, pageStart: 1 },
      { name: 'Results', startOffset: 150, endOffset: 220, pageStart: 1 },
      { name: 'Conclusion', startOffset: 220, endOffset: 260, pageStart: 1 },
      { name: 'References', startOffset: 260, endOffset: 400, pageStart: 1 },
    ],
    references: Array.from({ length: 20 }, (_, i) => ({
      index: i + 1,
      raw: `Ref ${i + 1}`,
      authors: [],
      year: '2020',
      title: `Paper ${i + 1}`,
      venue: null,
      startOffset: 0,
      endOffset: 0,
    })),
    citations: Array.from({ length: 25 }, (_, i) => ({
      marker: `[${i + 1}]`,
      style: 'IEEE' as const,
      startOffset: 0,
      endOffset: 0,
      keys: [String(i + 1)],
    })),
    detectedCitationStyle: 'IEEE',
    pageCount: 1,
    ...over,
  };
}

function finding(partial: Partial<Finding> & Pick<Finding, 'id' | 'kind' | 'category'>): Finding {
  return {
    startOffset: 0,
    endOffset: 10,
    page: 1,
    text: 'sample',
    sourceUrl: null,
    sourceTitle: null,
    matchPct: null,
    sourceType: null,
    explanation: null,
    suggestion: null,
    status: 'open',
    isInformational: false,
    confidence: 0.8,
    ...partial,
  };
}

assert(CURATED_VENUES.length >= 40, `catalog should be dozens+, got ${CURATED_VENUES.length}`);

const fields = inferFields(
  'deep learning neural network wireless mimo beamforming channel estimation'
);
assert(fields.includes('ml') || fields.includes('communications'), 'should infer ml or communications');

const semiFields = inferFields(
  'gan mosfet semiconductor wafer lithography finfet mobility transistor fabrication'
);
assert(
  semiFields.includes('semiconductors') || semiFields.includes('devices') || semiFields.includes('ee'),
  'should infer semiconductors/devices/ee'
);

const clean = scoreReadiness(basePaper(), [], {
  title: 'Deep learning for wireless MIMO beamforming',
});
assert(clean.q1LikeScore >= 70, `clean paper should score decently Q1-like, got ${clean.q1LikeScore}`);
assert(clean.q2LikeScore >= clean.q1LikeScore, 'Q2-like bar should be >= Q1-like');
assert(clean.ieeeScore >= 70, `IEEE-oriented score should be solid, got ${clean.ieeeScore}`);
assert(clean.scoreBreakdown.length > 0, 'score breakdown should be present');
assert(
  clean.scoreBreakdown.some((b) => b.effect === 'raised'),
  'clean paper should have raising factors'
);
assert(
  clean.checklist.some((c) => c.id === 'numerical_consistency' && c.passed),
  'clean paper passes numerical consistency checklist'
);
assert(
  clean.journalSuggestions.length >= VENUE_LIST_MIN,
  `at least ${VENUE_LIST_MIN} venue suggestions, got ${clean.journalSuggestions.length}`
);
assert(
  clean.journalSuggestions.length <= VENUE_LIST_MAX,
  `at most ${VENUE_LIST_MAX} venue suggestions, got ${clean.journalSuggestions.length}`
);
assert(clean.mappingNote.toLowerCase().includes('not'), 'mapping note must disclaim real quartiles');
assert(
  clean.journalSuggestions.every((j) => j.confidence === 'low' || j.confidence === 'medium'),
  'confidence only low/medium'
);
assert(
  clean.journalSuggestions.every((j) => j.source === 'heuristic'),
  'local list should be heuristic-sourced'
);
assert(
  !clean.journalSuggestions.some((j) => /q1\b|q2\b|impact factor/i.test(j.reason + (j.caution || ''))),
  'suggestions must not claim Q1/Q2 or IF'
);

const vague = suggestJournals('untitled manuscript abstract', ['general'], {
  ieeeOriented: false,
  openAccessLean: true,
  methodsWeak: true,
  manuscriptShort: true,
  preferLetters: true,
  structureGaps: 3,
});
assert(vague.length >= VENUE_LIST_MIN, 'weak topical signals still yield a full venue list');
assert(
  vague.some((j) => /letter|communication|access|preprint|short/i.test(j.reason + j.name)),
  'weak methods / short manuscript should surface letter/OA/preprint framing'
);

const messyFindings: Finding[] = [
  finding({
    id: 'n1',
    kind: 'manuscript_quality',
    category: 'novelty_issue',
  }),
  finding({
    id: 'n2',
    kind: 'manuscript_quality',
    category: 'numerical_ambiguity',
  }),
  finding({
    id: 'c1',
    kind: 'citation_need',
    category: 'needs_citation_claim',
  }),
  finding({
    id: 'a1',
    kind: 'ai',
    category: 'ai_flagged',
  }),
];

const messy = scoreReadiness(basePaper(), messyFindings, {
  title: 'A novel approach',
  aiPct: 45,
});
assert(messy.q1LikeScore < clean.q1LikeScore, 'open issues should lower Q1-like score');
assert(
  messy.gaps.some((g) => g.area === 'quality' || g.area === 'ai'),
  'gaps should mention quality/ai'
);
assert(
  messy.checklist.some((c) => c.id === 'novelty_claims' && !c.passed),
  'novelty checklist should fail'
);
assert(messy.journalSuggestions.length >= VENUE_LIST_MIN, 'messy papers still get venue rows');
assert(
  messy.scoreBreakdown.some((b) => b.effect === 'lowered'),
  'messy paper should show lowering breakdown items'
);

const inconsistFindings: Finding[] = [
  finding({
    id: 'ni1',
    kind: 'manuscript_quality',
    category: 'numerical_inconsistency',
  }),
];
const inconsist = scoreReadiness(basePaper(), inconsistFindings, {
  title: 'Deep learning for wireless MIMO beamforming',
});
assert(
  inconsist.q1LikeScore < clean.q1LikeScore,
  'numerical inconsistency should lower Q1-like score'
);
assert(
  inconsist.gaps.some((g) => g.id === 'numerical-inconsistency'),
  'should surface numerical-inconsistency gap'
);
assert(
  inconsist.checklist.some((c) => c.id === 'numerical_consistency' && !c.passed),
  'numerical consistency checklist should fail'
);

const thin = scoreReadiness(
  basePaper({
    sections: [{ name: 'Other', startOffset: 0, endOffset: 100, pageStart: 1 }],
    references: [],
    citations: [],
    detectedCitationStyle: 'APA',
    fullText: 'Short note on sensor calibration for mems accelerometer.',
  }),
  [],
  { title: 'Short MEMS sensor note' }
);
assert(thin.q1LikeScore < 60, 'missing structure should tank Q1-like score');
assert(
  thin.gaps.some((g) => g.area === 'structure'),
  'structure gaps expected'
);
assert(thin.journalSuggestions.length >= VENUE_LIST_MIN, 'short notes still get venue rows');

const boosted = scoreReadiness(basePaper(), [], {
  title: 'Deep learning for wireless MIMO beamforming',
  model: { available: true, source: 'hub', q1Boost: 8, q2Boost: 5, ieeeBoost: 6 },
});
assert(boosted.modelUsed === true, 'modelUsed flag');
assert(boosted.q1LikeScore >= clean.q1LikeScore, 'model boost should not lower clean score');

console.log(
  `scoreReadiness.test.ts: all passed (catalog=${CURATED_VENUES.length}, sampleVenues=${clean.journalSuggestions.length})`
);

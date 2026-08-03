/**
 * Unit tests for the submission readiness checklist.
 * Run: npx tsx src/lib/submission/checklist.test.ts
 */
import {
  analyzeCallouts,
  buildSubmissionChecklist,
  extractKeywords,
} from './checklist';
import type { ParsedPaper } from '../../types';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const ABSTRACT_TEXT =
  'We propose a convolutional method for MIMO channel estimation that improves accuracy from ' +
  '71% to 76% on open benchmarks. ' +
  'The approach uses lightweight training and runs in the browser. '.repeat(12);

function basePaper(over: Partial<ParsedPaper> = {}): ParsedPaper {
  const fullText =
    `Deep learning for wireless beamforming\nAbstract\n${ABSTRACT_TEXT}\n` +
    'Index Terms—deep learning, MIMO, beamforming, channel estimation\n' +
    'Introduction\nPrior work on OFDM as shown in Fig. 1 and Fig. 2. ' +
    'Methods\nWe train a neural network (Table 1). Results\nSee Fig. 3 and Table 2. ' +
    'Conclusion\nFuture work.\nReferences\n[1] A paper.';
  const absStart = fullText.indexOf('Abstract');
  const absEnd = fullText.indexOf('Index Terms');
  const refStart = fullText.indexOf('References');
  return {
    fullText,
    pages: [{ pageNumber: 1, text: '', startOffset: 0, endOffset: fullText.length }],
    sentences: [],
    sections: [
      { name: 'Abstract', startOffset: absStart, endOffset: absEnd, pageStart: 1 },
      { name: 'Introduction', startOffset: absEnd, endOffset: absEnd + 100, pageStart: 1 },
      { name: 'Methods', startOffset: absEnd + 100, endOffset: absEnd + 160, pageStart: 1 },
      { name: 'Results', startOffset: absEnd + 160, endOffset: absEnd + 220, pageStart: 1 },
      { name: 'Conclusion', startOffset: absEnd + 220, endOffset: refStart, pageStart: 1 },
      { name: 'References', startOffset: refStart, endOffset: fullText.length, pageStart: 1 },
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
    citations: [],
    detectedCitationStyle: 'IEEE',
    pageCount: 1,
    ...over,
  };
}

// Keyword extraction
const kws = extractKeywords('Title\nAbstract text here.\nIndex Terms—deep learning, MIMO, beamforming, channel estimation\nIntroduction');
assert(kws.length === 4, `expected 4 keywords, got ${kws.length}: ${kws.join('|')}`);
assert(kws.includes('deep learning'), 'should parse first keyword');
assert(extractKeywords('no keyword line at all').length === 0, 'no keywords → empty');

// Callout integrity
const paper = basePaper();
const figs = analyzeCallouts(paper, 'figure');
assert(figs.count === 3 && figs.missing.length === 0, `figs 1-3 sequential, got ${JSON.stringify(figs)}`);
const gappy = basePaper({
  fullText: paper.fullText.replace(/Fig\. 2/g, 'the second panel'),
});
const gapFigs = analyzeCallouts(gappy, 'figure');
assert(gapFigs.missing.includes(2), `Fig. 2 removed should be flagged missing, got ${JSON.stringify(gapFigs)}`);

// Roman-numeral tables
const roman = analyzeCallouts(
  basePaper({ fullText: 'Table I shows setup. Table III shows results. References' }),
  'table'
);
assert(roman.missing.includes(2), `Table II gap should be caught, got ${JSON.stringify(roman)}`);

// Full checklist on a clean IEEE-ish paper
const clean = buildSubmissionChecklist(paper, 'ieee', 'Deep learning for wireless MIMO beamforming');
assert(clean.failCount === 0, `clean paper should have no failures: ${JSON.stringify(clean.items.filter((i) => i.status === 'fail'))}`);
assert(
  clean.items.find((i) => i.id === 'abstract')?.status === 'pass',
  'abstract in range should pass'
);
assert(
  clean.items.find((i) => i.id === 'keywords')?.status === 'pass',
  'index terms should pass'
);
assert(
  clean.items.find((i) => i.id === 'citestyle')?.status === 'pass',
  'IEEE style should pass for ieee profile'
);

// Missing abstract → fail
const noAbs = buildSubmissionChecklist(
  basePaper({ sections: paper.sections.filter((s) => s.name !== 'Abstract') }),
  'generic'
);
assert(
  noAbs.items.find((i) => i.id === 'abstract')?.status === 'fail',
  'missing abstract should fail'
);
assert(noAbs.failCount >= 1, 'failCount should count the missing abstract');

// Thin references warn against elsevier profile
const thinRefs = buildSubmissionChecklist(
  basePaper({ references: paper.references.slice(0, 5) }),
  'elsevier'
);
assert(
  thinRefs.items.find((i) => i.id === 'refcount')?.status === 'warn',
  '5 refs should warn for elsevier profile'
);

// APA style under IEEE profile warns
const apa = buildSubmissionChecklist(basePaper({ detectedCitationStyle: 'APA' }), 'ieee');
assert(
  apa.items.find((i) => i.id === 'citestyle')?.status === 'warn',
  'APA under ieee profile should warn'
);

// Long title warns
const longTitle = buildSubmissionChecklist(
  paper,
  'ieee',
  'A very long exhaustive comprehensive novel framework methodology approach for the detailed study analysis and evaluation of deep learning based wireless communication beamforming systems'
);
assert(
  longTitle.items.find((i) => i.id === 'title')?.status === 'warn',
  'over-long title should warn'
);

console.log('checklist.test.ts: all passed');

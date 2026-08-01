import { diceCoefficient, similarity, alignSpan } from './fuzzyMatch';
import type { ParsedPaper } from '../../types';

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(diceCoefficient('hello world', 'hello world') === 1, 'identical dice');
assert(similarity('The quick brown fox', 'the quick brown fox') > 0.9, 'case-insensitive');

const paper: ParsedPaper = {
  fullText:
    'Neural networks have revolutionized computer vision tasks across many domains including medical imaging applications today.',
  pages: [
    {
      pageNumber: 1,
      text: 'Neural networks have revolutionized computer vision tasks across many domains including medical imaging applications today.',
      startOffset: 0,
      endOffset: 120,
    },
  ],
  sentences: [
    {
      text: 'Neural networks have revolutionized computer vision tasks across many domains including medical imaging applications today.',
      startOffset: 0,
      endOffset: 120,
      page: 1,
      sentenceIndex: 0,
      section: 'Introduction',
    },
  ],
  sections: [
    { name: 'Introduction', startOffset: 0, endOffset: 120, pageStart: 1 },
  ],
  references: [],
  citations: [],
  detectedCitationStyle: 'APA',
  pageCount: 1,
};

const hit = alignSpan(
  'Neural networks have revolutionized computer vision tasks',
  paper
);
assert(hit && hit.score >= 0.9, 'exact-ish span should align');
assert(hit && hit.start === 0, 'aligned at start');

const miss = alignSpan('Completely unrelated text about oceanography and whales', paper, 0.85);
assert(miss === null, 'unrelated text should not align at high threshold');

console.log('fuzzyMatch.test.ts: all passed');

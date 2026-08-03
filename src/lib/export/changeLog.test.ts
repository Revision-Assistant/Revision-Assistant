/**
 * Regression tests for applyAcceptedEditsDetailed offset mapping.
 * Run via `npm run test:unit`.
 */
import { applyAcceptedEditsDetailed, applyAllSafeReplacements } from './changeLog';
import type { Finding, ParsedPaper } from '../../types';

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function makePaper(fullText: string): ParsedPaper {
  return {
    fullText,
    pages: [{ pageNumber: 1, text: fullText, startOffset: 0, endOffset: fullText.length }],
    sentences: [],
    sections: [],
    references: [],
    citations: [],
    detectedCitationStyle: 'unknown',
    pageCount: 1,
  };
}

function makeFinding(partial: Partial<Finding> & { id: string }): Finding {
  return {
    kind: 'grammar',
    category: 'grammar_error',
    startOffset: 0,
    endOffset: 0,
    page: 1,
    text: '',
    sourceUrl: null,
    sourceTitle: null,
    matchPct: null,
    sourceType: null,
    explanation: null,
    suggestion: null,
    status: 'accepted',
    isInformational: false,
    confidence: 1,
    ...partial,
  };
}

// Two edits where the FIRST replacement is longer than the original span.
// Before the fix, the second applied span kept its original-text offsets and
// drifted out of place in the revised string.
const paper = makePaper('aaa BBB ccc DDD eee');
const f1 = makeFinding({
  id: 'e1',
  startOffset: 4,
  endOffset: 7,
  text: 'BBB',
  editedText: 'LONGER-ONE',
});
const f2 = makeFinding({
  id: 'e2',
  startOffset: 12,
  endOffset: 15,
  text: 'DDD',
  editedText: 'XY',
});

const { text, applied } = applyAcceptedEditsDetailed(paper, [f1, f2]);
assert(text === 'aaa LONGER-ONE ccc XY eee', `revised text wrong: "${text}"`);
for (const span of applied) {
  const f = span.findingId === 'e1' ? f1 : f2;
  const slice = text.slice(span.start, span.end);
  assert(
    slice === f.editedText,
    `applied span for ${span.findingId} points at "${slice}", expected "${f.editedText}"`
  );
}

// Overlapping edits: second overlapping edit must be skipped, not corrupt text.
const overlapPaper = makePaper('one two three four');
const o1 = makeFinding({ id: 'o1', startOffset: 0, endOffset: 7, text: 'one two', editedText: 'ONE' });
const o2 = makeFinding({ id: 'o2', startOffset: 4, endOffset: 13, text: 'two three', editedText: 'BAD' });
const overlap = applyAcceptedEditsDetailed(overlapPaper, [o1, o2]);
assert(overlap.text === 'ONE three four', `overlap handling wrong: "${overlap.text}"`);
assert(overlap.applied.length === 1 && overlap.applied[0].findingId === 'o1', 'overlapping edit should be skipped');

// Edit with endOffset past the text must be ignored, not throw or corrupt.
const oob = applyAcceptedEditsDetailed(
  makePaper('short'),
  [makeFinding({ id: 'x', startOffset: 2, endOffset: 999, text: 'ort', editedText: 'ZZ' })]
);
assert(oob.text === 'short' && oob.applied.length === 0, 'out-of-bounds edit should be ignored');

// applyAllSafeReplacements: applies citation-safe fixes, skips citation-dropping ones.
const safe = makeFinding({
  id: 's1',
  status: 'open',
  text: 'teh result',
  replacementText: 'the result',
});
const unsafe = makeFinding({
  id: 's2',
  status: 'open',
  text: 'shown before [12].',
  replacementText: 'shown before.',
});
const bulk = applyAllSafeReplacements([safe, unsafe]);
assert(bulk.applied === 1 && bulk.skipped === 1, 'apply-all should apply 1 and skip 1');
assert(bulk.next.find((f) => f.id === 's1')?.status === 'accepted', 'safe fix should be accepted');
assert(bulk.next.find((f) => f.id === 's2')?.status === 'open', 'unsafe fix should stay open');

console.log('changeLog.test.ts: all passed');

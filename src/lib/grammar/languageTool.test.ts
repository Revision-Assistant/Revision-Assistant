/**
 * Lightweight node-free assertions run via `npm run test:unit`
 */
import { buildChunks, matchToFinding, type LTMatch } from './languageTool';
import { segmentSections } from '../pdf/paperParser';
import type { ParsedPaper } from '../../types';

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const body = 'Sentence one is here. '.repeat(400); // ~9200 chars of prose
const refs = 'References [1] Smith, J., 2020. Some paper. Nature.';
const fullText = `Introduction ${body}${refs}`;

const sections = segmentSections(fullText, [
  { pageNumber: 1, text: fullText, startOffset: 0, endOffset: fullText.length },
]);

const sentences = fullText
  .split(/(?<=\.)\s+/)
  .reduce<{ text: string; startOffset: number; endOffset: number; page: number; sentenceIndex: number; section: 'Other' }[]>(
    (acc, part, idx) => {
      const searchFrom = acc.length ? acc[acc.length - 1].endOffset : 0;
      const start = fullText.indexOf(part, searchFrom);
      if (start === -1) return acc;
      acc.push({ text: part, startOffset: start, endOffset: start + part.length, page: 1, sentenceIndex: idx, section: 'Other' });
      return acc;
    },
    []
  );

const paper: ParsedPaper = {
  fullText,
  pages: [{ pageNumber: 1, text: fullText, startOffset: 0, endOffset: fullText.length }],
  sentences,
  sections,
  references: [],
  citations: [],
  detectedCitationStyle: 'IEEE',
  pageCount: 1,
};

const chunks = buildChunks(paper, 2000);

assert(chunks.length > 1, 'a long body should split into multiple chunks');
assert(
  chunks.every((c) => c.end <= refs.length + body.length + 'Introduction '.length + 1),
  'chunks should never cross into the References section'
);
for (const c of chunks) {
  assert(!c.text.includes('References ['), `chunk should not include reference-list text: "${c.text.slice(-30)}"`);
}

// Acronym noise filter: technical jargon like "TCAD" shouldn't surface as a grammar finding
const acronymText = 'The TCAD simulation confirmed the result.';
const acronymMatch: LTMatch = {
  message: 'Possible spelling mistake found.',
  replacements: [],
  offset: acronymText.indexOf('TCAD'),
  length: 4,
  rule: { id: 'MORFOLOGIK_RULE_EN_US', category: { id: 'TYPOS', name: 'Possible Typo' } },
};
const acronymPaper: ParsedPaper = { ...paper, fullText: acronymText, sentences: [], references: [] };
const acronymChunk = { text: acronymText, start: 0, end: acronymText.length };
assert(
  matchToFinding(acronymMatch, acronymChunk, acronymPaper) === null,
  'bare all-caps acronym should be filtered, not surfaced as a grammar error'
);

// Real typo in the same shape should still come through
const typoText = 'The eror was clear.';
const typoMatch: LTMatch = {
  message: 'Possible spelling mistake found.',
  replacements: [{ value: 'error' }],
  offset: typoText.indexOf('eror'),
  length: 4,
  rule: { id: 'MORFOLOGIK_RULE_EN_US', category: { id: 'TYPOS', name: 'Possible Typo' } },
};
const typoPaper: ParsedPaper = { ...paper, fullText: typoText, sentences: [], references: [] };
const typoChunk = { text: typoText, start: 0, end: typoText.length };
const typoFinding = matchToFinding(typoMatch, typoChunk, typoPaper);
assert(typoFinding !== null, 'a genuine lowercase typo should still be surfaced');
assert(typoFinding?.replacementText === 'error', 'replacementText should carry the top suggestion');

// Recurring mixed-case jargon (e.g. "nanoribbon" used throughout a materials-science paper)
// shouldn't be flagged as an unknown word every time it appears
const jargonText = 'The nanoribbon was fabricated. Later, the nanoribbon was characterized under bias.';
const jargonMatch: LTMatch = {
  message: 'Possible spelling mistake found.',
  replacements: [],
  offset: jargonText.indexOf('nanoribbon'),
  length: 'nanoribbon'.length,
  rule: { id: 'MORFOLOGIK_RULE_EN_US', category: { id: 'TYPOS', name: 'Possible Typo' } },
};
const jargonPaper: ParsedPaper = { ...paper, fullText: jargonText, sentences: [], references: [] };
const jargonChunk = { text: jargonText, start: 0, end: jargonText.length };
assert(
  matchToFinding(jargonMatch, jargonChunk, jargonPaper) === null,
  'a word repeated across the paper should read as deliberate terminology, not a typo'
);

// SI units like "nm" must never surface as spelling mistakes
const unitText = 'The channel length is 20 nm under bias.';
const unitMatch: LTMatch = {
  message: 'Possible spelling mistake found.',
  replacements: [{ value: 'am' }, { value: 'no' }],
  offset: unitText.indexOf('nm'),
  length: 2,
  rule: { id: 'MORFOLOGIK_RULE_EN_US', category: { id: 'TYPOS', name: 'Possible Typo' } },
};
const unitPaper: ParsedPaper = { ...paper, fullText: unitText, sentences: [], references: [] };
const unitChunk = { text: unitText, start: 0, end: unitText.length };
assert(
  matchToFinding(unitMatch, unitChunk, unitPaper) === null,
  'SI unit "nm" must not be flagged as a grammar/spelling error'
);

const formulaText = 'We grew AlGaN/GaN HEMT structures on SiC.';
const formulaMatch: LTMatch = {
  message: 'Possible spelling mistake found.',
  replacements: [],
  offset: formulaText.indexOf('AlGaN'),
  length: 5,
  rule: { id: 'MORFOLOGIK_RULE_EN_US', category: { id: 'TYPOS', name: 'Possible Typo' } },
};
const formulaPaper: ParsedPaper = { ...paper, fullText: formulaText, sentences: [], references: [] };
assert(
  matchToFinding(formulaMatch, { text: formulaText, start: 0, end: formulaText.length }, formulaPaper) ===
    null,
  'material formula AlGaN must not be flagged'
);

console.log('languageTool.test.ts: all passed');

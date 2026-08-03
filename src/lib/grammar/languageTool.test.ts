/**
 * Lightweight node-free assertions run via `npm run test:unit`
 */
import { buildChunks, matchToFinding, mergeOverlappingGrammarFindings, isNameOrAuthorNoise, type LTMatch } from './languageTool';
import {
  applyGrammarFilterDecisions,
  findingToFilterItem,
  filterGrammarFindingsWithLlm,
} from './grammarFilterClient';
import { segmentSections } from '../pdf/paperParser';
import type { Finding, ParsedPaper, PaperSentence } from '../../types';

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

// Whole-sentence context: a GRAMMAR-category hit inside a longer sentence should be
// expanded to the enclosing sentence, not left as a two-word fragment, and the
// one-click auto-replacement should be dropped since it no longer maps to the full span.
const grammarSentenceText =
  'The results, which was collected over several months, show a clear trend in the data.';
const grammarSentence: PaperSentence = {
  text: grammarSentenceText,
  startOffset: 0,
  endOffset: grammarSentenceText.length,
  page: 1,
  sentenceIndex: 0,
  section: 'Other',
};
const grammarPaper: ParsedPaper = {
  ...paper,
  fullText: grammarSentenceText,
  sentences: [grammarSentence],
  references: [],
};
const grammarMatch: LTMatch = {
  message: 'The verb form is incorrect (subject-verb agreement).',
  replacements: [{ value: 'were' }],
  offset: grammarSentenceText.indexOf('was'),
  length: 3,
  rule: { id: 'AGREEMENT_RULE', category: { id: 'GRAMMAR', name: 'Grammar' } },
};
const grammarChunk = { text: grammarSentenceText, start: 0, end: grammarSentenceText.length };
const grammarFinding = matchToFinding(grammarMatch, grammarChunk, grammarPaper);
assert(grammarFinding !== null, 'a real grammar error should still be surfaced');
assert(
  grammarFinding!.text === grammarSentenceText,
  `grammar finding should expand to the full sentence, got "${grammarFinding!.text}"`
);
assert(
  grammarFinding!.replacementText === null,
  'sentence-expanded findings must not carry a word-level auto-replacement'
);
assert(!grammarFinding!.isInformational, 'genuine grammar/agreement errors stay actionable');

// Register/dialect nits (STYLE, COLLOQUIALISMS, etc.) are dropped entirely — they
// flooded the findings queue with polish advice that read as "wrong" errors.
const nitText = 'The team utilized a fairly common approach to solve the problem quickly.';
const nitMatch: LTMatch = {
  message: 'This phrase is informal.',
  replacements: [{ value: 'used' }],
  offset: nitText.indexOf('utilized'),
  length: 'utilized'.length,
  rule: { id: 'COLLOQUIAL_STYLE', category: { id: 'COLLOQUIALISMS', name: 'Colloquialism' } },
};
const nitPaper: ParsedPaper = { ...paper, fullText: nitText, sentences: [], references: [] };
const nitChunk = { text: nitText, start: 0, end: nitText.length };
assert(
  matchToFinding(nitMatch, nitChunk, nitPaper) === null,
  'style/register nits should be dropped, not surfaced'
);

const styleMatch: LTMatch = {
  message: 'Consider a simpler word.',
  replacements: [{ value: 'used' }],
  offset: nitText.indexOf('utilized'),
  length: 'utilized'.length,
  rule: { id: 'SIMPLE_WORD', category: { id: 'STYLE', name: 'Style' } },
};
assert(
  matchToFinding(styleMatch, nitChunk, nitPaper) === null,
  'STYLE-category hits should be dropped entirely'
);

// Multiple LT matches that expand to the same sentence should collapse into one finding.
const dupBase: Finding = grammarFinding!;
const dupOther = {
  ...grammarFinding!,
  id: 'other-id',
  explanation: 'Punctuation: a comma may be needed here.',
  confidence: 0.6,
};
const mergedList = mergeOverlappingGrammarFindings([dupBase, dupOther]);
assert(mergedList.length === 1, 'findings sharing the same expanded sentence span should merge into one');
assert(
  mergedList[0].explanation!.includes('Also flagged in this sentence'),
  'merged finding should fold the secondary explanation into the primary one'
);

// --- Local name / author noise pre-filter ---
assert(isNameOrAuthorNoise('John Smith') === true, 'multi-word proper name should drop');
assert(isNameOrAuthorNoise('Maria Garcia Lopez') === true, 'three-part name should drop');
assert(isNameOrAuthorNoise('J. Smith') === true, 'initial + surname should drop');
assert(isNameOrAuthorNoise('A. B. Chen') === true, 'double initial + surname should drop');
assert(isNameOrAuthorNoise('Smith et al.') === true, 'et al. author form should drop');
assert(isNameOrAuthorNoise('et al.') === true, 'bare et al. should drop');
assert(isNameOrAuthorNoise('Smith, Jones, and Brown') === true, 'author list should drop');
assert(isNameOrAuthorNoise('[12]') === true, 'citation marker should drop');
assert(isNameOrAuthorNoise('[12-14]') === true, 'citation range should drop');
assert(isNameOrAuthorNoise('(Smith, 2020)') === true, 'author-year citation should drop');
assert(isNameOrAuthorNoise('was') === false, 'ordinary grammar token must not be treated as a name');
assert(isNameOrAuthorNoise('results') === false, 'lowercase prose must not look like a name');
assert(isNameOrAuthorNoise('nanoribbon') === false, 'lowercase jargon is handled by STEM filter, not name filter');

const nameText = 'Work by John Smith showed clear results.';
const nameMatch: LTMatch = {
  message: 'Possible spelling mistake found.',
  replacements: [],
  offset: nameText.indexOf('John Smith'),
  length: 'John Smith'.length,
  rule: { id: 'MORFOLOGIK_RULE_EN_US', category: { id: 'TYPOS', name: 'Possible Typo' } },
};
const namePaper: ParsedPaper = { ...paper, fullText: nameText, sentences: [], references: [] };
assert(
  matchToFinding(nameMatch, { text: nameText, start: 0, end: nameText.length }, namePaper) === null,
  'capitalized multi-word person name must not surface as a grammar finding'
);

const authorListText = 'See Smith, Jones, and Brown for details.';
const authorListMatch: LTMatch = {
  message: 'Possible spelling mistake found.',
  replacements: [],
  offset: authorListText.indexOf('Smith, Jones, and Brown'),
  length: 'Smith, Jones, and Brown'.length,
  rule: { id: 'MORFOLOGIK_RULE_EN_US', category: { id: 'TYPOS', name: 'Possible Typo' } },
};
assert(
  matchToFinding(
    authorListMatch,
    { text: authorListText, start: 0, end: authorListText.length },
    { ...paper, fullText: authorListText, sentences: [], references: [] }
  ) === null,
  'author list span must be dropped by local pre-filter'
);

// --- Mock-friendly LLM filter client ---
const mockGrammar: Finding = {
  id: 'g1',
  kind: 'grammar',
  category: 'grammar_error',
  startOffset: 0,
  endOffset: 10,
  page: 1,
  text: 'The results was clear.',
  sourceUrl: null,
  sourceTitle: null,
  matchPct: null,
  sourceType: null,
  explanation: 'Grammar: subject-verb agreement',
  suggestion: 'Use were',
  replacementText: null,
  grammarRuleId: 'AGREEMENT_RULE',
  grammarLtCategory: 'GRAMMAR',
  grammarLtMessage: 'The verb form is incorrect.',
  status: 'open',
  isInformational: false,
  confidence: 0.9,
};
const mockNameFinding: Finding = {
  ...mockGrammar,
  id: 'g2',
  text: 'Zhang',
  explanation: 'Typo: Possible spelling mistake found.',
  grammarLtMessage: 'Possible spelling mistake found.',
  grammarRuleId: 'MORFOLOGIK_RULE_EN_US',
  grammarLtCategory: 'TYPOS',
};

const item = findingToFilterItem(mockNameFinding);
assert(item.id === 'g2', 'filter item should preserve id');
assert(item.text === 'Zhang', 'filter item should carry short span text');
assert(item.ruleId.includes('MORFOLOGIK'), 'filter item should carry rule id');

const afterDecisions = applyGrammarFilterDecisions(
  [mockGrammar, mockNameFinding],
  [
    { id: 'g1', keep: true, reason: 'agreement' },
    { id: 'g2', keep: false, reason: 'proper name' },
  ]
);
assert(afterDecisions.length === 1 && afterDecisions[0].id === 'g1', 'apply decisions should drop keep:false');

const missingKeeps = applyGrammarFilterDecisions([mockGrammar], []);
assert(missingKeeps.length === 1, 'empty decisions should fail-open and keep all');

const filteredViaMock = await filterGrammarFindingsWithLlm([mockGrammar, mockNameFinding], {
  fetchImpl: async () =>
    new Response(
      JSON.stringify({
        decisions: [
          { id: 'g1', keep: true },
          { id: 'g2', keep: false, reason: 'surname' },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    ),
});
assert(
  filteredViaMock.length === 1 && filteredViaMock[0].id === 'g1',
  'mock LLM filter should drop name finding and keep real grammar'
);

const fallbackOnError = await filterGrammarFindingsWithLlm([mockGrammar, mockNameFinding], {
  fetchImpl: async () => {
    throw new Error('network down');
  },
});
assert(
  fallbackOnError.length === 2,
  'LLM failure must fall back to unfiltered (local-already-filtered) findings'
);

const fallbackOnUnavailable = await filterGrammarFindingsWithLlm([mockGrammar], {
  fetchImpl: async () =>
    new Response(JSON.stringify({ decisions: [], fallback: true, error: 'No LLM' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
});
assert(fallbackOnUnavailable.length === 1, 'provider fallback should keep original findings');

console.log('languageTool.test.ts: all passed');

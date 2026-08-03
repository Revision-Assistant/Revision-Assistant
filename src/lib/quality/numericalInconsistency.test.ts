/**
 * Unit tests for numerical inconsistency detection.
 * Run: npx tsx src/lib/quality/numericalInconsistency.test.ts
 */
import {
  detectNumericalInconsistencies,
  extractNumericClaims,
} from './numericalInconsistency';
import type { ParsedPaper, PaperSentence, SectionName } from '../../types';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

function sent(
  text: string,
  start: number,
  section: SectionName,
  page = 1
): PaperSentence {
  return {
    text,
    startOffset: start,
    endOffset: start + text.length,
    page,
    sentenceIndex: 0,
    section,
  };
}

function paperFrom(sentences: PaperSentence[]): ParsedPaper {
  const fullText = sentences.map((s) => s.text).join(' ');
  // Re-offset sequentially with spaces
  let offset = 0;
  const aligned = sentences.map((s, i) => {
    const start = offset;
    const end = start + s.text.length;
    offset = end + (i < sentences.length - 1 ? 1 : 0);
    return { ...s, startOffset: start, endOffset: end, sentenceIndex: i };
  });
  return {
    fullText: aligned.map((s) => s.text).join(' '),
    pages: [{ pageNumber: 1, text: fullText, startOffset: 0, endOffset: fullText.length }],
    sentences: aligned,
    sections: [],
    references: [],
    citations: [],
    detectedCitationStyle: 'IEEE',
    pageCount: 1,
  };
}

// --- Conflicting sample sizes ---
const nConflict = paperFrom([
  sent('We enrolled n = 50 patients in the prospective cohort study described below.', 0, 'Methods'),
  sent('Results are reported for the full cohort of n = 45 patients who completed follow-up.', 100, 'Results'),
]);
const nClaims = extractNumericClaims(nConflict);
assert(nClaims.length >= 2, `expected >=2 n claims, got ${nClaims.length}`);
const nFindings = detectNumericalInconsistencies(nConflict);
assert(nFindings.length >= 1, 'should flag n=50 vs n=45');
assert(nFindings[0].category === 'numerical_inconsistency', 'category numerical_inconsistency');
assert(nFindings[0].relatedSpan != null, 'should attach relatedSpan');
assert(
  /50/.test(nFindings[0].explanation || '') && /45/.test(nFindings[0].explanation || ''),
  'explanation should mention both values'
);

// --- Conflicting accuracy percentages ---
const accConflict = paperFrom([
  sent('The proposed model achieved an accuracy of 92% on the held-out benchmark.', 0, 'Abstract'),
  sent('Overall we observe 90% accuracy under the same evaluation protocol.', 80, 'Results', 2),
]);
const accFindings = detectNumericalInconsistencies(accConflict);
assert(accFindings.length >= 1, 'should flag 92% vs 90% accuracy');
assert(
  accFindings[0].numericalConflict?.metricLabel.toLowerCase().includes('accuracy'),
  'metric should be accuracy'
);

// --- Train vs test should NOT flag ---
const trainTest = paperFrom([
  sent('Training accuracy reached 98% after convergence on the source split.', 0, 'Results'),
  sent('Test accuracy was 91% on the unseen target domain.', 70, 'Results'),
]);
const ttFindings = detectNumericalInconsistencies(trainTest);
assert(ttFindings.length === 0, 'train vs test accuracy must not flag');

// --- Baseline vs proposed should NOT flag ---
const baseProp = paperFrom([
  sent('The baseline CNN obtained an F1 of 0.81 on Cityscapes val.', 0, 'Results'),
  sent('Our proposed model reached an F1 of 0.88 on Cityscapes val.', 70, 'Results'),
]);
const bpFindings = detectNumericalInconsistencies(baseProp);
assert(bpFindings.length === 0, 'baseline vs proposed F1 must not flag');

// --- Same value should NOT flag ---
const consistent = paperFrom([
  sent('We used a sample size of 120 subjects for the primary analysis.', 0, 'Methods'),
  sent('Among n = 120 subjects, mean age was 54.2 years.', 70, 'Results'),
]);
const consFindings = detectNumericalInconsistencies(consistent);
assert(consFindings.length === 0, 'matching n should not flag');

// --- Different metrics should NOT flag ---
const differentMetrics = paperFrom([
  sent('Precision was 88% on the binary detection task.', 0, 'Results'),
  sent('Recall was 76% on the binary detection task.', 60, 'Results'),
]);
const dmFindings = detectNumericalInconsistencies(differentMetrics);
assert(dmFindings.length === 0, 'precision vs recall must not flag');

// --- Temperature conflict ---
const tempConflict = paperFrom([
  sent('Samples were annealed at a temperature of 25 °C for 2 hours.', 0, 'Methods'),
  sent('Annealing used a temperature of 37 °C as stated in the protocol.', 70, 'Methods'),
]);
const tempFindings = detectNumericalInconsistencies(tempConflict);
assert(tempFindings.length >= 1, 'should flag 25C vs 37C');

console.log(
  `numericalInconsistency.test.ts: ok (n=${nFindings.length}, acc=${accFindings.length}, temp=${tempFindings.length})`
);

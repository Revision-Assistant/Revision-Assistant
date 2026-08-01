/**
 * Lightweight node-free assertions run via `npm run test:unit`
 */
import { parseReferenceList, segmentSections } from './paperParser';

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

// Regression: extractTextFromPdf collapses all newlines before parsing (normalizePdfText),
// so a numbered reference list must still split correctly with zero line breaks present.
const refsBody =
  'References ' +
  '[1] Smith, J. and Lee, K., 2020. Deep learning for medical imaging. Nature Medicine, 12(3), p.100. ' +
  '[2] Deng, Z., Zeng, C., Wu, Q., Zhang, F. and Zhuang, P., 2026. A suspended graphene field-effect transistor for ultra-sensitive detection. Advanced Functional Materials, 32(38), p.2204781. ' +
  '[3] Kakar, V.K., Munindra and Pal, P.K., 2025. Gate-induced static and dynamic nonlinearity characteristics of bilayer graphene transistors. Nature Communications, 8(1), p.14902.';

const fullText = `Introduction We study CNNs. ${refsBody}`;
const sections = segmentSections(fullText, [
  { pageNumber: 1, text: fullText, startOffset: 0, endOffset: fullText.length },
]);

const refs = parseReferenceList(fullText, sections);

assert(refs.length === 3, `expected 3 reference entries, got ${refs.length}`);
assert(refs[0].index === 1 && refs[1].index === 2 && refs[2].index === 3, 'indices should follow parsed [N] markers');
assert(
  refs[1].raw.includes('Deng, Z.') && refs[1].raw.includes('Advanced Functional Materials'),
  'entry 2 should stay whole across internal periods, not fragment at "p.2204781."'
);
assert(refs[1].year === '2026', 'entry 2 year should be parsed');

// Styles that bracket the year must not leak the closing paren into the title
const parenStyle =
  'References [1] Regan B, O’Kennedy R, Collins D (2018) Point-of-Care Compatibility of Ultra-Sensitive Detection for Troponin I. Sensors, 18(11), p.3739. ' +
  '[2] Other A, Writer B (2019) A completely different paper title here. Journal of Things, 4(2), p.12.';
const parenSections = segmentSections(parenStyle, [
  { pageNumber: 1, text: parenStyle, startOffset: 0, endOffset: parenStyle.length },
]);
const parenRefs = parseReferenceList(parenStyle, parenSections);
assert(parenRefs.length === 2, `expected 2 paren-style refs, got ${parenRefs.length}`);
assert(
  parenRefs[0].title?.startsWith('Point-of-Care'),
  `title should not start with a stray paren: ${JSON.stringify(parenRefs[0].title)}`
);

console.log('paperParser.test.ts: all passed');

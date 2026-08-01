/**
 * Lightweight node-free assertions run via `npm run test:unit`
 *
 * This detector is precision-weighted: a wrong "you must cite this" is worse than a miss,
 * so the false-positive cases below matter more than the recall ones.
 */
import { detectCitationNeed, computeCitationNeedFeatures } from './citationNeed';
import type { ParsedPaper, PaperSentence, SectionName } from '../../types';

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

/** Build a paper whose sentences are laid out contiguously in fullText. */
function makePaper(parts: { text: string; section: SectionName }[]): ParsedPaper {
  let fullText = '';
  const sentences: PaperSentence[] = [];
  parts.forEach((p, i) => {
    const start = fullText.length;
    fullText += p.text + ' ';
    sentences.push({
      text: p.text,
      startOffset: start,
      endOffset: start + p.text.length,
      page: 1,
      sentenceIndex: i,
      section: p.section,
    });
  });

  return {
    fullText,
    pages: [{ pageNumber: 1, text: fullText, startOffset: 0, endOffset: fullText.length }],
    sentences,
    sections: [{ name: 'Introduction', startOffset: 0, endOffset: fullText.length, pageStart: 1 }],
    references: [],
    citations: [],
    detectedCitationStyle: 'IEEE',
    pageCount: 1,
  };
}

// --- should flag: uncited attribution to prior work ---
const flagged = makePaper([
  {
    text: 'Several previous studies have shown that graphene biosensors achieve femtomolar sensitivity under optimized buffer conditions.',
    section: 'Introduction',
  },
]);
const f1 = detectCitationNeed(flagged);
assert(f1.length === 1, `expected 1 finding for uncited attribution, got ${f1.length}`);
assert(f1[0].kind === 'citation_need', 'kind should be citation_need');
assert(f1[0].category === 'needs_citation_claim', 'category should be needs_citation_claim');
assert(!f1[0].isInformational, 'citation-need findings are actionable');

// --- must NOT flag: the same claim with a citation nearby ---
const cited = makePaper([
  {
    text: 'Several previous studies have shown that graphene biosensors achieve femtomolar sensitivity [12].',
    section: 'Introduction',
  },
]);
assert(
  detectCitationNeed(cited).length === 0,
  'a claim with a citation marker present must not be flagged'
);

// --- must NOT flag: authors describing their own work ---
const ownWork = makePaper([
  {
    text: 'In this work we have shown that the proposed device achieves a subthreshold swing of 122 mV per decade.',
    section: 'Results',
  },
  {
    text: 'Our simulations demonstrated that the sensitivity increases substantially with a reduced binding distance.',
    section: 'Results',
  },
]);
assert(
  detectCitationNeed(ownWork).length === 0,
  'first-person reporting of the authors own results must not be flagged'
);

// --- must NOT flag: figure/table references ---
const figures = makePaper([
  {
    text: 'As shown in Figure 4, the transfer characteristics indicate a clear shift in the threshold voltage.',
    section: 'Results',
  },
]);
assert(detectCitationNeed(figures).length === 0, 'figure references must not be flagged');

// --- must NOT flag: reference-list content ---
const refs = makePaper([
  {
    text: 'Smith J, Lee K. Studies have shown deep learning improves imaging. Nature Medicine. 2020.',
    section: 'References',
  },
]);
assert(detectCitationNeed(refs).length === 0, 'sentences inside References must be skipped');

// --- must NOT flag: bare comparative with no attribution cue ---
const bareComparative = makePaper([
  {
    text: 'The measured response time was lower than the recovery time across every bias condition tested.',
    section: 'Discussion',
  },
]);
assert(
  detectCitationNeed(bareComparative).length === 0,
  'a comparative alone is too weak a signal to assert a missing citation'
);

// --- features are exposed for training ---
const feat = computeCitationNeedFeatures(flagged.sentences[0], flagged);
assert(feat.hasAttributionCue, 'attribution cue should be detected');
assert(!feat.hasNearbyCitation, 'no nearby citation expected');
assert(!feat.isOwnWork, 'should not read as own work');
assert(feat.score > 0.7, `score should clear the default threshold, got ${feat.score}`);
assert(feat.wordCount > 10, 'word count should be populated');

const citedFeat = computeCitationNeedFeatures(cited.sentences[0], cited);
assert(citedFeat.hasNearbyCitation, 'citation marker in the sentence should be detected');

console.log('citationNeed.test.ts: all passed');

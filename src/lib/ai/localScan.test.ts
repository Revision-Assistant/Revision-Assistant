/**
 * Lightweight node-free assertions run via `npm run test:unit`
 *
 * The local AI-writing scan is a heuristic, not a trained classifier — precision matters
 * more than recall here, since a wrong "this reads like AI" flag on normal academic prose
 * is exactly the complaint this module exists to avoid.
 */
import { scanLocalAiSpans } from './localScan';
import type { ParsedPaper, PaperSentence } from '../../types';

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function makePaper(sentences: string[]): ParsedPaper {
  let fullText = '';
  const built: PaperSentence[] = [];
  sentences.forEach((text, i) => {
    const start = fullText.length;
    fullText += text + ' ';
    built.push({
      text,
      startOffset: start,
      endOffset: start + text.length,
      page: 1,
      sentenceIndex: i,
      section: 'Other',
    });
  });
  return {
    fullText,
    pages: [{ pageNumber: 1, text: fullText, startOffset: 0, endOffset: fullText.length }],
    sentences: built,
    sections: [{ name: 'Other', startOffset: 0, endOffset: fullText.length, pageStart: 1 }],
    references: [],
    citations: [],
    detectedCitationStyle: 'IEEE',
    pageCount: 1,
  };
}

// A long, entity-light, citation-free sentence is common in normal academic prose
// (e.g. a topic sentence framing a section) — structural traits alone must not flag it.
const normalLongSentence =
  'The behavior observed under these conditions can be explained by considering the interplay between the several mechanisms described earlier in this section of the manuscript.';
const normalPaper = makePaper([normalLongSentence]);
const normalSpans = scanLocalAiSpans(normalPaper);
assert(
  normalSpans.length === 0,
  `a plain long sentence without any AI-sounding tell should not be flagged, got ${normalSpans.length}`
);

// A genuinely formulaic, AI-sounding passage should still be caught.
const formulaicSentence =
  'It is important to note that this robust framework plays a crucial role in the multifaceted landscape of modern research, delving into numerous interconnected factors without citing any specific measurements.';
const formulaicPaper = makePaper([formulaicSentence]);
const formulaicSpans = scanLocalAiSpans(formulaicPaper);
assert(
  formulaicSpans.length === 1,
  `formulaic AI-sounding phrasing should still be flagged, got ${formulaicSpans.length}`
);

// First-person results reporting without formulaic tells must stay quiet.
const ownVoice =
  'We measured the drain current across twelve bias points and observed a clear shift in the threshold voltage under illumination.';
assert(
  scanLocalAiSpans(makePaper([ownVoice])).length === 0,
  'first-person experimental reporting should not be flagged as AI voice'
);

console.log('localScan.test.ts: all passed');

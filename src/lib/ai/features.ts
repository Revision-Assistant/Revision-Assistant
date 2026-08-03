/**
 * Local AI-writing feature diagnostics (Stage 5 prep).
 * Computed in-browser; LLM only turns them into readable feedback.
 */

import type { AIFeatures, ParsedPaper } from '../../types';

/**
 * Genuine hedging: the writer is softening a claim's certainty. Deliberately excludes words
 * like "significant", "various", "numerous", "generally" — these are ordinary academic
 * vocabulary (e.g. "statistically significant") and treating them as hedges flagged too much
 * normal STEM prose as AI-sounding.
 */
const HEDGE_WORDS = [
  'might',
  'possibly',
  'perhaps',
  'seemingly',
  'apparently',
  'potentially',
  'arguably',
  'it is possible',
  'in some cases',
  'could potentially',
  'may or may not',
];

export function computeAIFeatures(
  text: string,
  paper: ParsedPaper,
  start: number,
  end: number
): AIFeatures {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 5);

  const lengths = sentences.map((s) => s.split(/\s+/).length);
  const avg =
    lengths.length > 0 ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
  const variance =
    lengths.length > 1
      ? lengths.reduce((a, l) => a + (l - avg) ** 2, 0) / lengths.length
      : 0;

  const lower = text.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);
  let hedgeCount = 0;
  for (const h of HEDGE_WORDS) {
    const re = new RegExp(`\\b${h.replace(/\s+/g, '\\s+')}\\b`, 'gi');
    const matches = lower.match(re);
    if (matches) hedgeCount += matches.length;
  }
  const hedgingDensity = words.length ? hedgeCount / words.length : 0;

  // Concrete numbers, percentages, named entities (capitalized multi-word / acronyms)
  const numbers = text.match(/\b\d+(?:\.\d+)?%?\b/g) || [];
  const acronyms = text.match(/\b[A-Z]{2,6}\b/g) || [];
  const properish = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) || [];
  const concreteEntityCount = numbers.length + acronyms.length + properish.length;

  const windowStart = Math.max(0, start - 30);
  const windowEnd = Math.min(paper.fullText.length, end + 30);
  const region = paper.fullText.slice(windowStart, windowEnd);
  const citationCount = paper.citations.filter(
    (c) => c.startOffset >= windowStart && c.endOffset <= windowEnd
  ).length;
  // Also count bracket cites in region text if parser missed
  const extraCites = (region.match(/\[\d+\]|\([A-Z][a-z]+.*?\d{4}\)/g) || []).length;

  return {
    sentenceLengthVariance: Math.round(variance * 100) / 100,
    hedgingDensity: Math.round(hedgingDensity * 1000) / 1000,
    concreteEntityCount,
    citationCount: Math.max(citationCount, extraCites),
    avgSentenceLength: Math.round(avg * 10) / 10,
  };
}

/** Template explanation when LLM is unavailable */
export function localAIExplanation(
  features: AIFeatures,
  text: string,
  origin?: 'ai_report' | 'local_heuristic' | null
): string {
  const tips: string[] = [];
  if (features.sentenceLengthVariance < 15) {
    tips.push(
      'Sentence lengths are unusually uniform — mix short and long sentences the way you would speak about your own results.'
    );
  }
  if (features.hedgingDensity > 0.04) {
    tips.push(
      'High density of hedging words (may/might/could/potentially). Prefer direct claims you can support with data.'
    );
  }
  if (features.concreteEntityCount < 2) {
    tips.push(
      'Few concrete numbers, acronyms, or named entities. Ground the paragraph in your measurements, datasets, or cited works.'
    );
  }
  if (features.citationCount === 0 && text.length > 120) {
    tips.push(
      'No nearby citations. AI-flagged prose often lacks specific scholarly anchors — cite the sources that informed this claim.'
    );
  }
  if (features.avgSentenceLength > 28) {
    tips.push('Average sentence length is high; split complex sentences to add natural rhythm.');
  }
  if (tips.length === 0) {
    tips.push(
      'Detector flagged this passage. Add personal analytic voice: what *you* did, observed, or decided, with specifics only you would know.'
    );
  }
  const lead =
    origin === 'ai_report'
      ? 'Your AI writing report flagged this passage. Why it may read as machine-generated:\n• '
      : origin === 'local_heuristic'
        ? 'Local voice heuristics flagged this passage (not a vendor AI score). Why it may read as machine-generated:\n• '
        : 'Why this may read as machine-generated:\n• ';
  return (
    lead +
    tips.join('\n• ') +
    '\n\nDo not try to "beat" a detector score. Revise for clarity and ownership of the ideas.'
  );
}

/**
 * Local AI-voice scan when no Turnitin AI report is uploaded.
 * Surfaces high-risk machine-like passages so AI rewrite support is always available.
 */

import type { AlignedSpan, ParsedPaper } from '../../types';
import { computeAIFeatures } from './features';

const FORMULAIC =
  /\b(Furthermore|Moreover|Additionally|In conclusion|It is (?:important|worth) (?:to note|noting) that|In today's world|delve into|landscape of|multifaceted|robust framework|plays a crucial role|It is widely (?:known|recognized)|In summary|To summarize|a comprehensive (?:overview|analysis)|underscores the importance)\b/i;

/**
 * Structural traits (uniform sentence length, few named entities, no nearby citation) are
 * each common in perfectly normal academic writing on their own — a long, entity-light
 * topic sentence is not evidence of AI authorship by itself. They only become meaningful
 * combined with an actual AI-sounding tell (formulaic phrasing or a dense hedge cluster), so
 * "strong" signals gate the flag and structural traits only add weight once a strong signal
 * already fired.
 */
function scorePassage(text: string, features: ReturnType<typeof computeAIFeatures>): number {
  let strongSignals = 0;
  let score = 0;
  if (FORMULAIC.test(text)) {
    score += 2.5;
    strongSignals += 1;
  }
  // Dense hedging only (was 0.05 — ordinary "may/could" in STEM tripped too often)
  if (features.hedgingDensity > 0.08) {
    score += 1.5;
    strongSignals += 1;
  }
  if (strongSignals === 0) return 0; // no hallmark AI tell — structural traits alone are too common to act on

  if (features.sentenceLengthVariance < 10 && features.avgSentenceLength > 20) score += 0.75;
  if (features.concreteEntityCount < 1 && text.length > 160) score += 0.75;
  if (features.avgSentenceLength > 32) score += 0.5;
  if (features.citationCount === 0 && text.length > 220) score += 0.25;
  return score;
}

/** Soft AI spans for categorizeAll when no Turnitin AI PDF was provided. */
export function scanLocalAiSpans(paper: ParsedPaper, maxFlags = 12): AlignedSpan[] {
  const out: AlignedSpan[] = [];
  for (const s of paper.sentences) {
    if (s.text.length < 110) continue;
    if (/^(abstract|introduction|conclusion|references|acknowledg)/i.test(s.text.trim())) continue;
    // First-person result reporting is almost never the AI-voice problem users care about.
    if (/\b(?:we|our|this (?:work|study|paper))\b/i.test(s.text) && !FORMULAIC.test(s.text)) continue;
    const features = computeAIFeatures(s.text, paper, s.startOffset, s.endOffset);
    const score = scorePassage(s.text, features);
    if (score < 3.5) continue;
    out.push({
      reportText: s.text,
      paperStart: s.startOffset,
      paperEnd: s.endOffset,
      paperPage: s.page,
      paperText: s.text,
      score: Math.min(0.9, 0.5 + score * 0.07),
      sources: [],
      matchPct: null,
      kind: 'ai',
      positionOnly: true,
      origin: 'local_heuristic',
    });
    if (out.length >= maxFlags) break;
  }
  return out;
}

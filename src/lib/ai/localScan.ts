/**
 * Local AI-voice scan when no Turnitin AI report is uploaded.
 * Surfaces high-risk machine-like passages so AI rewrite support is always available.
 */

import type { AlignedSpan, ParsedPaper } from '../../types';
import { computeAIFeatures } from './features';

const FORMULAIC =
  /\b(Furthermore|Moreover|Additionally|In conclusion|It is (?:important|worth) (?:to note|noting) that|In today's world|delve into|landscape of|multifaceted|robust framework|plays a crucial role|It is widely (?:known|recognized))\b/i;

function scorePassage(text: string, features: ReturnType<typeof computeAIFeatures>): number {
  let score = 0;
  if (features.sentenceLengthVariance < 12 && features.avgSentenceLength > 18) score += 2;
  if (features.hedgingDensity > 0.035) score += 1;
  if (features.concreteEntityCount < 2 && text.length > 140) score += 2;
  if (FORMULAIC.test(text)) score += 2;
  if (features.avgSentenceLength > 30) score += 1;
  if (features.citationCount === 0 && text.length > 180) score += 1;
  return score;
}

/** Soft AI spans for categorizeAll when no Turnitin AI PDF was provided. */
export function scanLocalAiSpans(paper: ParsedPaper, maxFlags = 24): AlignedSpan[] {
  const out: AlignedSpan[] = [];
  for (const s of paper.sentences) {
    if (s.text.length < 90) continue;
    if (/^(abstract|introduction|conclusion|references|acknowledg)/i.test(s.text.trim())) continue;
    const features = computeAIFeatures(s.text, paper, s.startOffset, s.endOffset);
    const score = scorePassage(s.text, features);
    if (score < 3) continue;
    out.push({
      reportText: s.text,
      paperStart: s.startOffset,
      paperEnd: s.endOffset,
      paperPage: s.page,
      paperText: s.text,
      score: Math.min(0.92, 0.45 + score * 0.08),
      sources: [],
      matchPct: null,
      kind: 'ai',
      positionOnly: true,
    });
    if (out.length >= maxFlags) break;
  }
  return out;
}

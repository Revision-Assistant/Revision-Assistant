/**
 * Unit tests for manuscript-quality rules / label mapping.
 * Run: npx tsx src/lib/quality/manuscriptQuality.test.ts
 */
import {
  computeQualityFeatures,
  detectManuscriptQuality,
  isEligibleForQualityCheck,
} from './manuscriptQuality';
import type { ParsedPaper } from '../../types';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const novelty = computeQualityFeatures(
  'To the best of our knowledge, this is a novel approach for semantic segmentation.',
  'Introduction'
);
assert(novelty.hasNoveltyIssue, 'should flag novelty boilerplate');
assert(novelty.predictedLabel === 'novelty_issue', 'label novelty_issue');

const noveltyOk = computeQualityFeatures(
  'Compared to prior CNN baselines, our model improves mean IoU by 4.2 points on Cityscapes.',
  'Introduction'
);
assert(!noveltyOk.hasNoveltyIssue, 'substantiated comparison should not be novelty_issue');

const num = computeQualityFeatures(
  'Accuracy increased significantly after fine-tuning on several patients.',
  'Results'
);
assert(num.hasNumericalAmbiguity, 'should flag vague numerical phrasing');
assert(num.predictedLabel === 'numerical_ambiguity', 'label numerical_ambiguity');

const numOk = computeQualityFeatures(
  'Accuracy increased from 71.2% to 76.8% (n = 214, p < 0.01, 95% CI 3.1–7.9).',
  'Results'
);
assert(!numOk.hasNumericalAmbiguity, 'precise stats should not flag');

const pub = computeQualityFeatures(
  'Standard procedures were used and results were promising as shown in Figure 3.',
  'Methods'
);
assert(pub.hasPublicationIssue, 'should flag publication craft issue');

assert(
  !isEligibleForQualityCheck({ text: 'Short.', section: 'Other' }),
  'short sentences ineligible'
);
assert(
  !isEligibleForQualityCheck({
    text: 'Smith J. A long reference entry that should be skipped entirely here.',
    section: 'References',
  }),
  'references ineligible'
);

const paper: ParsedPaper = {
  fullText:
    'To the best of our knowledge this paper presents a novel method for graph pooling without naming a baseline.',
  pages: [{ pageNumber: 1, text: '', startOffset: 0, endOffset: 200 }],
  sentences: [
    {
      text: 'To the best of our knowledge this paper presents a novel method for graph pooling without naming a baseline.',
      startOffset: 0,
      endOffset: 108,
      page: 1,
      sentenceIndex: 0,
      section: 'Introduction',
    },
  ],
  sections: [],
  references: [],
  citations: [],
  detectedCitationStyle: 'unknown',
  pageCount: 1,
};

const findings = detectManuscriptQuality(paper);
assert(findings.length >= 1, 'detector should emit at least one finding');
assert(findings[0].kind === 'manuscript_quality', 'kind manuscript_quality');
assert(findings[0].category === 'novelty_issue', 'category novelty_issue');

console.log('manuscriptQuality.test.ts: ok');

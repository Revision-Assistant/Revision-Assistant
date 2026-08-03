/**
 * Manuscript-quality model loader (browser ONNX via Transformers.js).
 *
 * Production: VITE_QUALITY_MODEL_ID on Hugging Face Hub.
 * Fallback: /models/manuscript-quality or rules in manuscriptQuality.ts.
 */

import type { Finding, ParsedPaper } from '../../types';
import {
  buildQualityFinding,
  detectManuscriptQuality,
  isEligibleForQualityCheck,
  type QualityLabel,
} from './manuscriptQuality';

interface InferenceConfig {
  threshold: number;
  thresholds?: Record<string, number>;
  base_model: string;
  labels?: string[];
  test_issue_precision?: number;
  test_issue_recall?: number;
}

type TextClassificationPipeline = (
  text: string,
  opts?: { topk?: number }
) => Promise<{ label: string; score: number }[] | { label: string; score: number }>;

let cached: { classify: TextClassificationPipeline; config: InferenceConfig } | null = null;
let loadFailed = false;

const LABEL_MAP: Record<string, QualityLabel | null> = {
  LABEL_0: null,
  '0': null,
  none: null,
  LABEL_1: 'numerical_ambiguity',
  '1': 'numerical_ambiguity',
  numerical_ambiguity: 'numerical_ambiguity',
  LABEL_2: 'publication_issue',
  '2': 'publication_issue',
  publication_issue: 'publication_issue',
  LABEL_3: 'novelty_issue',
  '3': 'novelty_issue',
  novelty_issue: 'novelty_issue',
};

function modelId(): string {
  return (import.meta.env.VITE_QUALITY_MODEL_ID as string | undefined)?.trim() || '';
}

async function loadInferenceConfig(remoteId: string): Promise<InferenceConfig> {
  if (remoteId) {
    const url = `https://huggingface.co/${remoteId}/resolve/main/inference_config.json`;
    const r = await fetch(url);
    if (r.ok) return r.json();
  }
  const local = await fetch('/models/manuscript-quality/inference_config.json');
  if (!local.ok) {
    return {
      threshold: 0.55,
      thresholds: { '1': 0.55, '2': 0.55, '3': 0.55 },
      base_model: 'allenai/scibert_scivocab_uncased',
    };
  }
  return local.json();
}

const MIN_LIVE_THRESHOLD = 0.5;

/** Mid-confidence model hits still need a surface cue matching the training seeds. */
const CUE_BY_LABEL: Record<QualityLabel, RegExp> = {
  numerical_ambiguity:
    /\b(?:approximately|roughly|around|about|nearly|several|numerous|significant(?:ly)?|substantial(?:ly)?|\d+(?:\.\d+)?\s*%)\b/i,
  publication_issue:
    /\b(?:as\s+shown\s+in|Fig(?:ure)?|Table|standard\s+(?:methods?|procedures?)|carefully\s+(?:performed|conducted)|results?\s+were\s+(?:significant|promising))\b/i,
  novelty_issue:
    /\b(?:to\s+the\s+best\s+of\s+our\s+knowledge|for\s+the\s+first\s+time|novel\s+(?:approach|method|framework|algorithm|technique|model)|unprecedented|no\s+previous\s+(?:work|study))\b/i,
};

async function loadModel(): Promise<typeof cached> {
  if (cached) return cached;
  if (loadFailed) return null;

  try {
    const remoteId = modelId();
    const config = await loadInferenceConfig(remoteId);
    const { pipeline, env } = await import('@huggingface/transformers');
    env.useBrowserCache = true;

    let classify: TextClassificationPipeline;
    if (remoteId) {
      env.allowRemoteModels = true;
      env.allowLocalModels = false;
      classify = (await Promise.race([
        pipeline('text-classification', remoteId, { dtype: 'q8' }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Quality model load timed out')), 90000)
        ),
      ])) as TextClassificationPipeline;
    } else {
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      env.localModelPath = `${window.location.origin}/models/`;
      classify = (await Promise.race([
        pipeline('text-classification', 'manuscript-quality', {
          dtype: 'q8',
          local_files_only: true,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Quality model load timed out')), 45000)
        ),
      ])) as TextClassificationPipeline;
    }

    cached = { classify, config };
    return cached;
  } catch (err) {
    console.warn('Manuscript-quality model unavailable, using rules fallback:', err);
    loadFailed = true;
    return null;
  }
}

function parsePredictions(
  raw: { label: string; score: number }[] | { label: string; score: number }
): { label: QualityLabel; score: number } | null {
  const preds = Array.isArray(raw) ? raw : [raw];
  let best: { label: QualityLabel; score: number } | null = null;
  for (const p of preds) {
    const mapped = LABEL_MAP[p.label] ?? LABEL_MAP[p.label.toLowerCase()];
    if (!mapped) continue;
    if (!best || p.score > best.score) best = { label: mapped, score: p.score };
  }
  return best;
}

export interface QualityModelOptions {
  maxFindings?: number;
  batchSize?: number;
  onProgress?: (done: number, total: number) => void;
}

export async function detectManuscriptQualitySmart(
  paper: ParsedPaper,
  options: QualityModelOptions = {}
): Promise<Finding[]> {
  const model = await loadModel();
  if (!model) return detectManuscriptQuality(paper);

  const { classify, config } = model;
  const maxFindings = options.maxFindings ?? 24;
  const batchSize = options.batchSize ?? 16;
  const defaultT = Math.max(config.threshold ?? 0, MIN_LIVE_THRESHOLD);
  const thresholds: Record<QualityLabel, number> = {
    numerical_ambiguity: Math.max(config.thresholds?.['1'] ?? defaultT, MIN_LIVE_THRESHOLD),
    publication_issue: Math.max(config.thresholds?.['2'] ?? defaultT, MIN_LIVE_THRESHOLD),
    novelty_issue: Math.max(config.thresholds?.['3'] ?? defaultT, MIN_LIVE_THRESHOLD),
  };
  const HIGH_CONF = 0.82;

  const candidates = paper.sentences.filter((s) => isEligibleForQualityCheck(s));
  const out: Finding[] = [];

  for (let i = 0; i < candidates.length && out.length < maxFindings; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (s) => {
        try {
          const raw = await classify(s.text, { topk: 4 });
          return { s, pred: parsePredictions(raw) };
        } catch {
          return { s, pred: null };
        }
      })
    );

    for (const { s, pred } of results) {
      if (!pred) continue;
      const t = thresholds[pred.label];
      if (pred.score < t) continue;
      if (pred.score < HIGH_CONF && !CUE_BY_LABEL[pred.label].test(s.text)) continue;
      out.push(buildQualityFinding(s, paper, pred.label, pred.score));
      if (out.length >= maxFindings) break;
    }

    options.onProgress?.(Math.min(i + batchSize, candidates.length), candidates.length);
  }

  return out;
}

export function isQualityModelAvailable(): boolean {
  return cached !== null;
}

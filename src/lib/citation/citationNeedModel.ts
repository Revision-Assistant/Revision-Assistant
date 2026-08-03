/**
 * Citation-need model loader for public MVP.
 *
 * Production: load quantized ONNX from Hugging Face Hub (free hosting) via
 * VITE_CITATION_MODEL_ID. Local dev can still use /models/citation-need if present.
 *
 * Private test manuscripts are never bundled.
 */

import type { Finding, ParsedPaper } from '../../types';
import { isEligibleForCitationCheck, buildCitationNeedFinding, detectCitationNeed } from './citationNeed';

interface InferenceConfig {
  threshold: number;
  base_model: string;
  test_precision: number;
  test_recall: number;
}

type TextClassificationPipeline = (
  text: string
) => Promise<{ label: string; score: number }[]>;

let cached: { classify: TextClassificationPipeline; config: InferenceConfig } | null = null;
let loadFailed = false;

function modelId(): string {
  return (import.meta.env.VITE_CITATION_MODEL_ID as string | undefined)?.trim() || '';
}

function localModelBase(): string {
  return `${window.location.origin}/models/`;
}

async function loadInferenceConfig(remoteId: string): Promise<InferenceConfig> {
  if (remoteId) {
    // HF raw file for inference_config.json published next to the model
    const url = `https://huggingface.co/${remoteId}/resolve/main/inference_config.json`;
    const r = await fetch(url);
    if (r.ok) return r.json();
  }
  const local = await fetch('/models/citation-need/inference_config.json');
  if (!local.ok) {
    return {
      threshold: 0.55,
      base_model: 'allenai/scibert_scivocab_uncased',
      test_precision: 0,
      test_recall: 0,
    };
  }
  return local.json();
}

/** Never trust a Hub/config threshold below this — prior 0.30 flood of false prompts. */
const MIN_LIVE_THRESHOLD = 0.55;

/** Attribution-shaped language: model alone is too loose without this cue at mid scores. */
const ATTRIBUTION_HINT =
  /\b(?:studies|research|works?|papers?|authors?|investigations?)\s+(?:have\s+)?(?:shown|demonstrated|reported|found|indicated|suggested|revealed|established|confirmed)\b|\bit\s+(?:has\s+been|was|is)\s+(?:shown|demonstrated|reported|found|observed|established|suggested|proposed)\b|\b(?:previous|prior|earlier|recent|several|many|numerous)\s+(?:studies|works?|reports?|investigations?|authors?|researchers?)\b|\b(?:according\s+to|as\s+reported\s+by|as\s+shown\s+by|as\s+described\s+(?:by|in))\b|\bhas\s+been\s+(?:widely|extensively|commonly|successfully)\s+(?:used|studied|investigated|applied|reported)\b|\b(?:is|are)\s+(?:widely|well|commonly|generally)\s+(?:known|established|accepted|recognized|reported|documented)\b|\b(?:approximately|about|nearly|over|more\s+than|up\s+to)\s+\d|\b\d+(?:\.\d+)?\s*%\s+of\b/i;

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
      // Free public hosting on Hugging Face Hub
      env.allowRemoteModels = true;
      env.allowLocalModels = false;
      classify = (await Promise.race([
        pipeline('text-classification', remoteId, { dtype: 'q8' }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Citation model load timed out')), 90000)
        ),
      ])) as TextClassificationPipeline;
    } else {
      // Local/public folder fallback (dev only — ONNX often gitignored)
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      env.localModelPath = localModelBase();
      classify = (await Promise.race([
        pipeline('text-classification', 'citation-need', {
          dtype: 'q8',
          local_files_only: true,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Citation model load timed out')), 45000)
        ),
      ])) as TextClassificationPipeline;
    }

    cached = { classify, config };
    return cached;
  } catch (err) {
    console.warn('Citation-need model unavailable, using rules fallback:', err);
    loadFailed = true;
    return null;
  }
}

export interface CitationNeedModelOptions {
  maxFindings?: number;
  batchSize?: number;
  onProgress?: (done: number, total: number) => void;
}

export async function detectCitationNeedSmart(
  paper: ParsedPaper,
  options: CitationNeedModelOptions = {}
): Promise<Finding[]> {
  const model = await loadModel();
  if (!model) return detectCitationNeed(paper);

  const { classify, config } = model;
  const maxFindings = options.maxFindings ?? 20;
  const batchSize = options.batchSize ?? 16;
  const threshold = Math.max(config.threshold ?? 0, MIN_LIVE_THRESHOLD);
  /** Mid-confidence scores need an attribution/statistic cue; very high scores can pass alone. */
  const HIGH_CONF = Math.max(threshold + 0.2, 0.82);

  const candidates = paper.sentences.filter((s) => isEligibleForCitationCheck(s, paper));
  const out: Finding[] = [];

  for (let i = 0; i < candidates.length && out.length < maxFindings; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (s) => {
        try {
          const raw = await classify(s.text);
          const preds = Array.isArray(raw) ? raw : [raw];
          const pos = preds.find((p) => p.label === 'LABEL_1' || p.label === '1');
          const score = pos
            ? pos.score
            : preds[0]?.label === 'LABEL_0' || preds[0]?.label === '0'
              ? 1 - preds[0].score
              : 0;
          return { s, score };
        } catch {
          return { s, score: 0 };
        }
      })
    );

    for (const { s, score } of results) {
      if (score < threshold) continue;
      if (score < HIGH_CONF && !ATTRIBUTION_HINT.test(s.text)) continue;
      out.push(
        buildCitationNeedFinding(
          s,
          paper,
          score,
          'reads as an attributable claim (trained-model judgment)'
        )
      );
      if (out.length >= maxFindings) break;
    }

    options.onProgress?.(Math.min(i + batchSize, candidates.length), candidates.length);
  }

  return out;
}

export function isCitationNeedModelAvailable(): boolean {
  return cached !== null;
}

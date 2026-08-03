/**
 * Optional in-browser ONNX multi-label journal-readiness signal heads.
 * Falls back gracefully when VITE_JOURNAL_MODEL_ID / local weights are missing.
 */

export type JournalSignalName =
  | 'structure_ok'
  | 'numerical_clear'
  | 'novelty_ok'
  | 'methods_concrete'
  | 'selective_ready'
  | 'ieee_craft';

export interface JournalModelSignals {
  available: boolean;
  source: 'hub' | 'local' | 'none';
  probs: Partial<Record<JournalSignalName, number>>;
  /** Mapped 0–100 heuristic adjustments (not acceptance odds). */
  q1Boost: number;
  q2Boost: number;
  ieeeBoost: number;
}

interface InferenceConfig {
  threshold: number;
  thresholds?: Record<string, number>;
  labels?: string[];
  base_model?: string;
}

type TextClassificationPipeline = (
  text: string,
  opts?: { topk?: number | null }
) => Promise<{ label: string; score: number }[] | { label: string; score: number }>;

let cached: { classify: TextClassificationPipeline; config: InferenceConfig } | null = null;
let loadFailed = false;

const DEFAULT_LABELS: JournalSignalName[] = [
  'structure_ok',
  'numerical_clear',
  'novelty_ok',
  'methods_concrete',
  'selective_ready',
  'ieee_craft',
];

function modelId(): string {
  return (import.meta.env.VITE_JOURNAL_MODEL_ID as string | undefined)?.trim() || '';
}

async function loadInferenceConfig(remoteId: string): Promise<InferenceConfig> {
  if (remoteId) {
    try {
      const url = `https://huggingface.co/${remoteId}/resolve/main/inference_config.json`;
      const r = await fetch(url);
      if (r.ok) return r.json();
    } catch {
      /* fall through */
    }
  }
  try {
    const local = await fetch('/models/journal-readiness/inference_config.json');
    if (local.ok) return local.json();
  } catch {
    /* ignore */
  }
  return { threshold: 0.5, labels: DEFAULT_LABELS, base_model: 'allenai/scibert_scivocab_uncased' };
}

async function loadModel(): Promise<typeof cached> {
  if (cached) return cached;
  if (loadFailed) return null;

  try {
    const remoteId = modelId();
    const config = await loadInferenceConfig(remoteId);
    const { pipeline, env } = await import('@huggingface/transformers');
    env.useBrowserCache = true;

    let classify: TextClassificationPipeline;
    let source: 'hub' | 'local' = 'local';
    if (remoteId) {
      env.allowRemoteModels = true;
      env.allowLocalModels = false;
      classify = (await Promise.race([
        pipeline('text-classification', remoteId, { dtype: 'q8' }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Journal model load timed out')), 90000)
        ),
      ])) as TextClassificationPipeline;
      source = 'hub';
    } else {
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      classify = (await Promise.race([
        pipeline('text-classification', '/models/journal-readiness', { dtype: 'q8' }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Local journal model load timed out')), 60000)
        ),
      ])) as TextClassificationPipeline;
    }
    cached = { classify, config };
    (cached as { _source?: string })._source = source;
    return cached;
  } catch (e) {
    console.warn('[journal-model] unavailable, using heuristics only:', e);
    loadFailed = true;
    return null;
  }
}

function normalizeScores(
  raw: { label: string; score: number }[] | { label: string; score: number }
): Partial<Record<JournalSignalName, number>> {
  const list = Array.isArray(raw) ? raw : [raw];
  const out: Partial<Record<JournalSignalName, number>> = {};
  for (const row of list) {
    const label = String(row.label)
      .replace(/^LABEL_/, '')
      .toLowerCase() as JournalSignalName | string;
    const mapped =
      (DEFAULT_LABELS as string[]).includes(label)
        ? (label as JournalSignalName)
        : DEFAULT_LABELS[Number(label)];
    if (mapped) out[mapped] = row.score;
  }
  return out;
}

function boostsFromProbs(probs: Partial<Record<JournalSignalName, number>>): {
  q1Boost: number;
  q2Boost: number;
  ieeeBoost: number;
} {
  const g = (k: JournalSignalName) => probs[k] ?? 0.5;
  // Map signal heads → small adjustments on checklist scores (−12 … +12)
  const selective = g('selective_ready');
  const structure = g('structure_ok');
  const numerical = g('numerical_clear');
  const novelty = g('novelty_ok');
  const methods = g('methods_concrete');
  const ieee = g('ieee_craft');

  const craft = (structure + numerical + novelty + methods) / 4;
  const q1Boost = Math.round((selective - 0.5) * 18 + (craft - 0.5) * 10);
  const q2Boost = Math.round((selective - 0.5) * 10 + (craft - 0.5) * 8);
  const ieeeBoost = Math.round((ieee - 0.5) * 16 + (methods - 0.5) * 6 + (numerical - 0.5) * 4);
  return {
    q1Boost: Math.max(-12, Math.min(12, q1Boost)),
    q2Boost: Math.max(-10, Math.min(10, q2Boost)),
    ieeeBoost: Math.max(-12, Math.min(12, ieeeBoost)),
  };
}

/**
 * Score title+abstract lead text with the optional ONNX model.
 * Returns available:false when model missing — callers keep pure heuristics.
 */
export async function scoreJournalModelSignals(leadText: string): Promise<JournalModelSignals> {
  const empty: JournalModelSignals = {
    available: false,
    source: 'none',
    probs: {},
    q1Boost: 0,
    q2Boost: 0,
    ieeeBoost: 0,
  };
  const text = leadText.replace(/\s+/g, ' ').trim().slice(0, 900);
  if (text.length < 40) return empty;

  const loaded = await loadModel();
  if (!loaded) return empty;

  try {
    const raw = await loaded.classify(text, { topk: null });
    const probs = normalizeScores(raw as { label: string; score: number }[]);
    const boosts = boostsFromProbs(probs);
    const src = (loaded as { _source?: 'hub' | 'local' })._source || (modelId() ? 'hub' : 'local');
    return {
      available: true,
      source: src,
      probs,
      ...boosts,
    };
  } catch (e) {
    console.warn('[journal-model] inference failed:', e);
    return empty;
  }
}

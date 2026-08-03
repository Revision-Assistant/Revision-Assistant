/**
 * Trained AI-writing detector (SciBERT, quantized ONNX via Transformers.js).
 *
 * Loads from Hugging Face Hub when VITE_AI_MODEL_ID is set; falls back to the
 * heuristic scanLocalAiSpans when the model is unavailable or fails to load.
 * Wired like citationNeedModel.ts. Label 1 = machine-generated.
 */

import type { AlignedSpan, ParsedPaper } from '../../types';
import { scanLocalAiSpans } from './localScan';

interface AiDetectConfig {
  threshold: number;
  base_model: string;
  max_len?: number;
}

type TextClassificationPipeline = (
  text: string
) => Promise<{ label: string; score: number }[]>;

let cached: { classify: TextClassificationPipeline; config: AiDetectConfig } | null = null;
let loadFailed = false;

/** Never trust a Hub threshold below this — wrong AI accusations are the costliest mistake. */
const MIN_LIVE_THRESHOLD = 0.6;

/** Passages shorter than this carry too little signal for a reliable verdict. */
const MIN_PASSAGE_CHARS = 180;
const TARGET_PASSAGE_CHARS = 550;

function modelId(): string {
  return (import.meta.env.VITE_AI_MODEL_ID as string | undefined)?.trim() || '';
}

async function loadModel(): Promise<typeof cached> {
  if (cached) return cached;
  if (loadFailed) return null;

  const remoteId = modelId();
  if (!remoteId) {
    loadFailed = true;
    return null;
  }

  try {
    let config: AiDetectConfig = { threshold: 0.6, base_model: '' };
    const r = await fetch(`https://huggingface.co/${remoteId}/resolve/main/inference_config.json`);
    if (r.ok) config = await r.json();

    const { pipeline, env } = await import('@huggingface/transformers');
    env.useBrowserCache = true;
    env.allowRemoteModels = true;
    env.allowLocalModels = false;

    const classify = (await Promise.race([
      pipeline('text-classification', remoteId, { dtype: 'q8' }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('AI detector load timed out')), 90000)
      ),
    ])) as TextClassificationPipeline;

    cached = { classify, config };
    return cached;
  } catch (err) {
    console.warn('AI-writing detector unavailable, using heuristic fallback:', err);
    loadFailed = true;
    return null;
  }
}

interface Window {
  text: string;
  start: number;
  end: number;
  page: number;
}

/** Pack consecutive sentences into passages matching the training distribution (~550 chars). */
function buildWindows(paper: ParsedPaper): Window[] {
  const windows: Window[] = [];
  let buf: typeof paper.sentences = [];
  let bufLen = 0;

  const flush = () => {
    if (!buf.length) return;
    const text = buf.map((s) => s.text).join(' ');
    if (text.length >= MIN_PASSAGE_CHARS) {
      windows.push({
        text,
        start: buf[0].startOffset,
        end: buf[buf.length - 1].endOffset,
        page: buf[0].page,
      });
    }
    buf = [];
    bufLen = 0;
  };

  for (const s of paper.sentences) {
    const t = s.text.trim();
    if (t.length < 20) {
      flush();
      continue;
    }
    if (/^(references|acknowledg|bibliography)/i.test(t)) {
      flush();
      continue;
    }
    // break windows at page boundaries so highlight offsets stay tight
    if (buf.length && buf[buf.length - 1].page !== s.page) flush();
    buf.push(s);
    bufLen += t.length;
    if (bufLen >= TARGET_PASSAGE_CHARS) flush();
  }
  flush();
  return windows;
}

function machineScore(preds: { label: string; score: number }[]): number {
  const pos = preds.find((p) => p.label === 'LABEL_1' || p.label === '1');
  if (pos) return pos.score;
  const neg = preds.find((p) => p.label === 'LABEL_0' || p.label === '0');
  return neg ? 1 - neg.score : 0;
}

/**
 * Model-backed AI-voice scan; falls back to the heuristic scan when no model is available.
 * Same output contract as scanLocalAiSpans.
 */
export async function scanAiSpansSmart(
  paper: ParsedPaper,
  maxFlags = 12,
  onProgress?: (done: number, total: number) => void
): Promise<AlignedSpan[]> {
  const model = await loadModel();
  if (!model) return scanLocalAiSpans(paper, maxFlags);

  const { classify, config } = model;
  const threshold = Math.max(config.threshold ?? 0, MIN_LIVE_THRESHOLD);
  const windows = buildWindows(paper);
  const out: AlignedSpan[] = [];
  const batchSize = 8;

  for (let i = 0; i < windows.length && out.length < maxFlags; i += batchSize) {
    const batch = windows.slice(i, i + batchSize);
    const scored = await Promise.all(
      batch.map(async (w) => {
        try {
          const raw = await classify(w.text);
          return { w, score: machineScore(Array.isArray(raw) ? raw : [raw]) };
        } catch {
          return { w, score: 0 };
        }
      })
    );

    for (const { w, score } of scored) {
      if (score < threshold) continue;
      out.push({
        reportText: w.text,
        paperStart: w.start,
        paperEnd: w.end,
        paperPage: w.page,
        paperText: w.text,
        score: Math.min(0.98, score),
        sources: [],
        matchPct: null,
        kind: 'ai',
        positionOnly: true,
        origin: 'local_heuristic',
      });
      if (out.length >= maxFlags) break;
    }
    onProgress?.(Math.min(i + batchSize, windows.length), windows.length);
  }

  return out;
}

export function isAiDetectModelAvailable(): boolean {
  return cached !== null;
}

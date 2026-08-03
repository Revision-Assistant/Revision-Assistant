/**
 * Client helper for Netlify humanize drafts (author must Accept / Save).
 */

import type { Finding } from '../../types';
import { restoreMissingEntities } from './entityGuard';
import {
  EXPLAIN_MAX_SPANS,
  EXPLAIN_MAX_TEXT_CHARS,
  truncateForExplain,
} from '../files/limits';

export interface HumanizeDraft {
  id: string;
  draft: string;
}

export async function requestHumanizeDrafts(
  findings: Finding[],
  opts?: { accessToken?: string | null; citationStyle?: string; onProgress?: (done: number, total: number) => void }
): Promise<HumanizeDraft[]> {
  const targets = findings
    .filter(
      (f) =>
        f.status === 'open' &&
        !f.isInformational &&
        (f.kind === 'ai' ||
          f.category === 'needs_restatement' ||
          f.category === 'ai_flagged')
    )
    .slice(0, EXPLAIN_MAX_SPANS);

  if (targets.length === 0) return [];

  const spans = targets.map((f) => ({
    id: f.id,
    kind: f.kind,
    category: f.category,
    text: truncateForExplain(f.text, EXPLAIN_MAX_TEXT_CHARS),
  }));

  opts?.onProgress?.(0, spans.length);

  const res = await fetch('/.netlify/functions/humanize', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(opts?.accessToken ? { Authorization: `Bearer ${opts.accessToken}` } : {}),
    },
    body: JSON.stringify({
      spans,
      citationStyle: opts?.citationStyle || 'unknown',
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Humanize failed (${res.status}): ${t.slice(0, 200)}`);
  }

  const data = (await res.json()) as { drafts?: { id: string; draft: string }[]; error?: string };
  if (data.error && !(data.drafts && data.drafts.length)) {
    throw new Error(data.error);
  }

  const byId = new Map(targets.map((f) => [f.id, f]));
  const out: HumanizeDraft[] = [];
  for (const d of data.drafts || []) {
    const src = byId.get(d.id);
    if (!src || !d.draft?.trim()) continue;
    out.push({ id: d.id, draft: restoreMissingEntities(src.text, d.draft) });
  }
  opts?.onProgress?.(spans.length, spans.length);
  return out;
}

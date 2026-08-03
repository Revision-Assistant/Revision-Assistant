/**
 * Opt-in Crossref enrichment for bibliography restyling.
 * Sends only individual reference strings / DOIs — never manuscript prose.
 * Throttled to ~3 req/s (Crossref polite-pool guidance, Dec 2025).
 */

import { diceCoefficient } from '../alignment/fuzzyMatch';
import { extractDoi } from '../submission/referenceHygiene';
import { mergeCrossrefMessage, type ParsedCslRef } from './parseToCsl';

const MAILTO = 'revision-assistant@users.noreply.github.com';
const TITLE_SIM_THRESHOLD = 0.55;

export interface EnrichProgress {
  done: number;
  total: number;
}

export interface EnrichOptions {
  /** Abort mid-run */
  signal?: AbortSignal;
  onProgress?: (p: EnrichProgress) => void;
  fetchImpl?: typeof fetch;
  /** Max lookups (default 80) */
  maxLookups?: number;
  /** Delay between requests in ms (default 350 ≈ 3/s) */
  delayMs?: number;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const t = window.setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true }
    );
  });
}

function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function bestTitleSim(queryTitle: string, candidateTitles: string[]): number {
  const q = normalizeTitle(queryTitle);
  if (!q) return 0;
  let best = 0;
  for (const c of candidateTitles) {
    best = Math.max(best, diceCoefficient(q, normalizeTitle(c)));
  }
  return best;
}

async function lookupByDoi(
  doi: string,
  doFetch: typeof fetch,
  signal?: AbortSignal
): Promise<Record<string, unknown> | null> {
  const res = await doFetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { message?: Record<string, unknown> };
  return data.message ?? null;
}

async function lookupByBibliographic(
  query: string,
  doFetch: typeof fetch,
  signal?: AbortSignal
): Promise<Record<string, unknown> | null> {
  const url =
    `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(query.slice(0, 400))}` +
    `&rows=2&mailto=${encodeURIComponent(MAILTO)}`;
  const res = await doFetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    message?: { items?: Record<string, unknown>[] };
  };
  const items = data.message?.items || [];
  if (items.length === 0) return null;

  const localTitle = String(
    (items[0] && Array.isArray((items[0] as { title?: string[] }).title)
      ? (items[0] as { title: string[] }).title[0]
      : '') || ''
  );
  // Prefer first item; caller validates similarity against local parse title
  void localTitle;
  return items[0] ?? null;
}

/**
 * Enrich a list of locally parsed refs via Crossref.
 * Entries that fail lookup are left unchanged (never dropped).
 */
export async function enrichViaCrossref(
  entries: ParsedCslRef[],
  opts: EnrichOptions = {}
): Promise<ParsedCslRef[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const max = opts.maxLookups ?? 80;
  const delayMs = opts.delayMs ?? 350;
  const out = entries.map((e) => ({ ...e, csl: { ...e.csl } }));
  const targets = out.slice(0, max);

  for (let i = 0; i < targets.length; i++) {
    if (opts.signal?.aborted) break;
    const entry = targets[i];
    opts.onProgress?.({ done: i, total: targets.length });

    try {
      const doi = entry.csl.DOI || extractDoi(entry.raw);
      let message: Record<string, unknown> | null = null;

      if (doi) {
        message = await lookupByDoi(doi, doFetch, opts.signal);
      }
      if (!message) {
        const q = entry.csl.title || entry.raw.replace(/^\[\d+\]\s*/, '').slice(0, 300);
        message = await lookupByBibliographic(q, doFetch, opts.signal);
        if (message) {
          const candTitles = Array.isArray(message.title)
            ? (message.title as string[])
            : [];
          const localTitle = String(entry.csl.title || '');
          const sim = bestTitleSim(localTitle, candTitles);
          if (localTitle && candTitles.length && sim < TITLE_SIM_THRESHOLD) {
            message = null; // reject weak match
          }
        }
      }

      if (message) {
        out[i] = mergeCrossrefMessage(entry, message);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') break;
      // leave entry as-is
    }

    if (i + 1 < targets.length && delayMs > 0) {
      try {
        await sleep(delayMs, opts.signal);
      } catch {
        break;
      }
    }
  }

  opts.onProgress?.({ done: targets.length, total: targets.length });
  return out;
}

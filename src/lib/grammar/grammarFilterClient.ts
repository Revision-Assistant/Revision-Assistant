/**
 * Client for the Netlify grammarFilter LLM stage.
 * Fail-open: on network/provider errors, return the original findings unchanged.
 */

import type { Finding } from '../../types';
import { EXPLAIN_MAX_PAYLOAD_CHARS, truncateForExplain } from '../files/limits';

/** Short span budget — filter only needs enough text to judge name vs grammar. */
export const GRAMMAR_FILTER_MAX_TEXT = 220;
export const GRAMMAR_FILTER_MAX_ITEMS = 40;

export interface GrammarFilterItem {
  id: string;
  text: string;
  message: string;
  ruleId: string;
  category: string;
}

export interface GrammarFilterDecision {
  id: string;
  keep: boolean;
  reason?: string;
}

export interface GrammarFilterClientOptions {
  accessToken?: string | null;
  /** Injectable for unit tests */
  fetchImpl?: typeof fetch;
  endpoint?: string;
  onProgress?: (message: string) => void;
}

export function findingToFilterItem(f: Finding): GrammarFilterItem {
  return {
    id: f.id,
    text: truncateForExplain(f.text, GRAMMAR_FILTER_MAX_TEXT),
    message: truncateForExplain(f.grammarLtMessage || f.explanation || '', 240),
    ruleId: (f.grammarRuleId || '').slice(0, 80),
    category: (f.grammarLtCategory || 'GRAMMAR').slice(0, 60),
  };
}

/**
 * Apply keep/drop decisions. Missing ids default to KEEP (fail-open per item).
 * Never invents findings — only filters the input list.
 */
export function applyGrammarFilterDecisions(
  findings: Finding[],
  decisions: GrammarFilterDecision[]
): Finding[] {
  if (!decisions.length) return findings;
  const map = new Map(decisions.map((d) => [d.id, d]));
  return findings.filter((f) => {
    const d = map.get(f.id);
    if (!d) return true;
    return d.keep !== false;
  });
}

/**
 * Second-stage LLM filter for open grammar findings.
 * Returns the input list unchanged when the endpoint is unavailable or fails.
 */
export async function filterGrammarFindingsWithLlm(
  findings: Finding[],
  opts: GrammarFilterClientOptions = {}
): Promise<Finding[]> {
  const openGrammar = findings.filter(
    (f) => f.kind === 'grammar' && f.status === 'open' && !f.isInformational
  );
  if (openGrammar.length === 0) return findings;

  const items = openGrammar.slice(0, GRAMMAR_FILTER_MAX_ITEMS).map(findingToFilterItem);
  let payload = { items };
  let body = JSON.stringify(payload);
  while (body.length > EXPLAIN_MAX_PAYLOAD_CHARS && payload.items.length > 4) {
    payload = { items: payload.items.slice(0, Math.ceil(payload.items.length * 0.7)) };
    body = JSON.stringify(payload);
  }

  opts.onProgress?.('Reviewing grammar with AI…');

  const fetchFn = opts.fetchImpl || fetch;
  const endpoint = opts.endpoint || '/.netlify/functions/grammarFilter';

  try {
    const res = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(opts.accessToken ? { Authorization: `Bearer ${opts.accessToken}` } : {}),
      },
      body,
    });

    if (!res.ok) {
      console.warn('grammarFilter failed', res.status, await res.text());
      return findings;
    }

    const data = (await res.json()) as {
      decisions?: GrammarFilterDecision[];
      fallback?: boolean;
      error?: string;
    };

    if (data.fallback || !data.decisions?.length) {
      if (data.error) console.warn('grammarFilter unavailable', data.error);
      return findings;
    }

    const filteredOpen = applyGrammarFilterDecisions(
      openGrammar.slice(0, payload.items.length),
      data.decisions
    );
    const keptIds = new Set(filteredOpen.map((f) => f.id));
    // Findings beyond the batch cap stay (not sent → not dropped)
    for (const f of openGrammar.slice(payload.items.length)) {
      keptIds.add(f.id);
    }

    return findings.filter((f) => {
      if (f.kind !== 'grammar') return true;
      if (f.status !== 'open' || f.isInformational) return true;
      return keptIds.has(f.id);
    });
  } catch (err) {
    console.warn('grammarFilter error', err);
    return findings;
  }
}

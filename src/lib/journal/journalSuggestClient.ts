/**
 * Client helper for Netlify journalSuggest (title/abstract/keywords only).
 */

export interface LlmVenueSuggestion {
  name: string;
  reason: string;
  confidence: 'low' | 'medium';
  openAccessHint?: string;
  caution?: string;
  source: 'llm';
}

export interface JournalSuggestResult {
  suggestions: LlmVenueSuggestion[];
  themes: string[];
  disclaimer: string;
  cached: boolean;
  error?: string;
}

const CACHE_KEY = 'ra_journal_suggest_v1';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h light client cache

function cacheKey(title: string, abstract: string): string {
  return `${title.trim().slice(0, 120)}|${abstract.trim().slice(0, 200)}`.toLowerCase();
}

function readCache(key: string): JournalSuggestResult | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      key: string;
      at: number;
      data: JournalSuggestResult;
    };
    if (parsed.key !== key) return null;
    if (Date.now() - parsed.at > CACHE_TTL_MS) return null;
    return { ...parsed.data, cached: true };
  } catch {
    return null;
  }
}

function writeCache(key: string, data: JournalSuggestResult): void {
  try {
    sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ key, at: Date.now(), data: { ...data, cached: false } })
    );
  } catch {
    /* quota / private mode */
  }
}

export async function requestJournalSuggestions(opts: {
  title: string;
  abstract: string;
  keywords?: string;
  fields?: string[];
  accessToken?: string | null;
  force?: boolean;
}): Promise<JournalSuggestResult> {
  const title = opts.title.trim().slice(0, 300);
  const abstract = opts.abstract.trim().slice(0, 1200);
  const keywords = (opts.keywords || '').trim().slice(0, 200);
  const key = cacheKey(title, abstract);

  if (!opts.force) {
    const hit = readCache(key);
    if (hit) return hit;
  }

  if (!title && !abstract) {
    return {
      suggestions: [],
      themes: [],
      disclaimer: 'Provide a title or abstract snippet first.',
      cached: false,
      error: 'empty',
    };
  }

  const res = await fetch('/.netlify/functions/journalSuggest', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.accessToken ? { Authorization: `Bearer ${opts.accessToken}` } : {}),
    },
    body: JSON.stringify({
      title,
      abstract,
      keywords,
      fields: (opts.fields || []).slice(0, 5),
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    return {
      suggestions: [],
      themes: [],
      disclaimer:
        'LLM venue refresh unavailable. Local heuristic suggestions still apply — not acceptance guarantees.',
      cached: false,
      error: `HTTP ${res.status}: ${t.slice(0, 180)}`,
    };
  }

  const data = (await res.json()) as {
    suggestions?: {
      name: string;
      reason: string;
      confidence?: string;
      openAccessHint?: string;
      caution?: string;
    }[];
    themes?: string[];
    disclaimer?: string;
    error?: string;
  };

  const suggestions: LlmVenueSuggestion[] = (data.suggestions || [])
    .filter((s) => s.name && s.reason)
    .slice(0, 6)
    .map((s) => ({
      name: String(s.name).slice(0, 160),
      reason: String(s.reason).slice(0, 400),
      confidence: s.confidence === 'medium' ? 'medium' : 'low',
      openAccessHint: s.openAccessHint ? String(s.openAccessHint).slice(0, 200) : undefined,
      caution: s.caution ? String(s.caution).slice(0, 240) : undefined,
      source: 'llm' as const,
    }));

  const result: JournalSuggestResult = {
    suggestions,
    themes: (data.themes || []).map((t) => String(t).slice(0, 80)).slice(0, 8),
    disclaimer:
      data.disclaimer ||
      'LLM suggestions are heuristic topical ideas from open literature cues — not endorsements or acceptance predictions.',
    cached: false,
    error: data.error,
  };
  if (suggestions.length) writeCache(key, result);
  return result;
}

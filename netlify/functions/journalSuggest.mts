/**
 * LLM open-venue suggestions from title / abstract / keywords only (truncated).
 * Never accepts full PDF. Does not invent Impact Factors or fake Q1/Q2 claims.
 *
 * Env: same LLM providers as explain/humanize + DAILY_TOKEN_CAP / DAILY_REQUEST_CAP
 */

import type { Context } from '@netlify/functions';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const XAI_URL = 'https://api.x.ai/v1/chat/completions';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

interface ProviderConfig {
  name: string;
  url: string;
  apiKey: string;
  model: string;
  fallbackModel: string;
  extraHeaders?: Record<string, string>;
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function resolveProvider(): ProviderConfig | null {
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  const xaiKey = process.env.XAI_API_KEY;
  const preferred = (process.env.LLM_PROVIDER || 'groq').toLowerCase();

  const list: ProviderConfig[] = [];
  const push = (p: ProviderConfig | null) => {
    if (p) list.push(p);
  };

  const groq = (k: string): ProviderConfig => ({
    name: 'groq',
    url: GROQ_URL,
    apiKey: k,
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    fallbackModel: process.env.GROQ_MODEL_FALLBACK || 'llama-3.1-8b-instant',
  });
  const gemini = (k: string): ProviderConfig => ({
    name: 'gemini',
    url: GEMINI_URL,
    apiKey: k.startsWith('yAIza') ? k.slice(1) : k,
    model: process.env.GEMINI_MODEL || 'gemini-flash-latest',
    fallbackModel: process.env.GEMINI_MODEL_FALLBACK || 'gemini-2.0-flash-lite',
  });
  const openrouter = (k: string): ProviderConfig => ({
    name: 'openrouter',
    url: OPENROUTER_URL,
    apiKey: k,
    model: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free',
    fallbackModel: process.env.OPENROUTER_MODEL_FALLBACK || 'google/gemma-3-27b-it:free',
    extraHeaders: {
      'HTTP-Referer': process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://revision-assistant.app',
      'X-Title': 'Revision Assistant MVP',
    },
  });

  if (preferred === 'groq' && groqKey) push(groq(groqKey));
  if ((preferred === 'gemini' || preferred === 'google') && geminiKey) push(gemini(geminiKey));
  if (preferred === 'openrouter' && openRouterKey) push(openrouter(openRouterKey));
  if (groqKey) push(groq(groqKey));
  if (geminiKey) push(gemini(geminiKey));
  if (openRouterKey) push(openrouter(openRouterKey));
  if (xaiKey) {
    push({
      name: 'xai',
      url: XAI_URL,
      apiKey: xaiKey,
      model: process.env.XAI_MODEL || 'grok-3-mini',
      fallbackModel: process.env.XAI_MODEL_FALLBACK || 'grok-3-mini',
    });
  }

  const seen = new Set<string>();
  for (const p of list) {
    const id = `${p.name}:${p.apiKey.slice(0, 8)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    return p;
  }
  return null;
}

async function callChat(
  provider: ProviderConfig,
  model: string,
  system: string,
  user: string
): Promise<{ content: string; tokens: number }> {
  const res = await fetch(provider.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
      ...(provider.extraHeaders || {}),
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${provider.name} ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices: { message: { content: string } }[];
    usage?: { total_tokens?: number };
  };
  return {
    content: data.choices[0]?.message?.content || '{}',
    tokens: data.usage?.total_tokens || 0,
  };
}

async function checkAndIncrementUsage(
  userId: string | null,
  tokens: number
): Promise<{ allowed: boolean; reason?: string }> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const tokenCap = parseInt(process.env.DAILY_TOKEN_CAP || '50000', 10);
  const reqCap = parseInt(process.env.DAILY_REQUEST_CAP || '40', 10);

  if (!url || !key || !userId) return { allowed: true };

  const today = new Date().toISOString().slice(0, 10);
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };

  const getRes = await fetch(
    `${url}/rest/v1/usage?user_id=eq.${userId}&date=eq.${today}&select=*`,
    { headers }
  );
  const rows = (await getRes.json()) as { tokens_used: number; requests_made: number }[];
  const current = rows[0] || { tokens_used: 0, requests_made: 0 };
  if (current.requests_made >= reqCap) {
    return { allowed: false, reason: 'Daily request cap reached. Try again tomorrow.' };
  }
  if (current.tokens_used >= tokenCap) {
    return { allowed: false, reason: 'Daily token cap reached. Try again tomorrow.' };
  }

  if (rows[0]) {
    await fetch(`${url}/rest/v1/usage?user_id=eq.${userId}&date=eq.${today}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        tokens_used: current.tokens_used + tokens,
        requests_made: current.requests_made + 1,
      }),
    });
  } else {
    await fetch(`${url}/rest/v1/usage`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        user_id: userId,
        date: today,
        tokens_used: tokens,
        requests_made: 1,
      }),
    });
  }
  return { allowed: true };
}

async function resolveUserId(authHeader: string | null): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon) return null;
  const res = await fetch(`${url}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: anon },
  });
  if (!res.ok) return null;
  const user = (await res.json()) as { id?: string };
  return user.id || null;
}

const SYSTEM = `You suggest openly indexed research venues and themes from SHORT metadata only
(title, abstract snippet, keywords). Legal/honesty rules you MUST follow:

1. Prefer open literature: arXiv subject classes, open-access journals, well-known society
   venues the author can verify themselves. Do NOT invent Impact Factors, SJR, or fake
   "Q1"/"Q2" / Clarivate / Scimago ranks.
2. Never claim a journal "will accept" the paper. Confidence may only be "low" or "medium".
3. Label uncertainty. Say suggestions are topical fit heuristics, not endorsements, and not
   affiliated with IEEE, Elsevier, Clarivate, or Scimago.
4. If unsure, suggest arXiv classes or broad OA venues and say so.
5. Return STRICT JSON:
{
  "suggestions": [
    {
      "name": "venue or arXiv class",
      "reason": "why topical fit (open literature)",
      "confidence": "low"|"medium",
      "openAccessHint": "optional OA note",
      "caution": "optional caution"
    }
  ],
  "themes": ["recent open theme 1", "..."],
  "disclaimer": "one sentence honesty disclaimer"
}
Return 3–6 suggestions.`;

export default async (req: Request, _context: Context) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const provider = resolveProvider();
  if (!provider) {
    return json(
      {
        error: 'No LLM provider configured',
        suggestions: [],
        themes: [],
        disclaimer:
          'LLM refresh unavailable. Use local heuristic venues — not acceptance guarantees.',
      },
      200
    );
  }

  let body: {
    title?: string;
    abstract?: string;
    keywords?: string;
    fields?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  // Truncate aggressively — never full manuscript / PDF
  const title = String(body.title || '').slice(0, 300);
  const abstract = String(body.abstract || '').slice(0, 1200);
  const keywords = String(body.keywords || '').slice(0, 200);
  const fields = (body.fields || []).map((f) => String(f).slice(0, 40)).slice(0, 5);

  if (!title.trim() && !abstract.trim()) {
    return json({ error: 'title or abstract required', suggestions: [], themes: [] }, 400);
  }

  const userId = await resolveUserId(req.headers.get('Authorization'));
  const gate = await checkAndIncrementUsage(userId, 0);
  if (!gate.allowed) {
    return json(
      {
        error: gate.reason,
        suggestions: [],
        themes: [],
        disclaimer: gate.reason,
      },
      429
    );
  }

  const user = JSON.stringify({
    title,
    abstract,
    keywords,
    inferredFields: fields,
    instruction:
      'Suggest open venues/themes only. No Impact Factors. No fake Q1/Q2. Not an endorsement.',
  });

  let lastErr = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const model = attempt > 0 ? provider.fallbackModel : provider.model;
      const { content, tokens } = await callChat(provider, model, SYSTEM, user);
      await checkAndIncrementUsage(userId, Math.max(tokens, 200));
      const parsed = JSON.parse(content) as {
        suggestions?: unknown[];
        themes?: unknown[];
        disclaimer?: string;
      };
      const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
      return json({
        suggestions: suggestions.slice(0, 6),
        themes: Array.isArray(parsed.themes) ? parsed.themes.slice(0, 8) : [],
        disclaimer:
          parsed.disclaimer ||
          'Heuristic open-venue ideas only — not peer review, not quartile ranks, not acceptance guarantees.',
      });
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
    }
  }

  return json(
    {
      error: lastErr.slice(0, 200),
      suggestions: [],
      themes: [],
      disclaimer:
        'LLM venue refresh failed. Local heuristic list still applies — not an acceptance guarantee.',
    },
    200
  );
};

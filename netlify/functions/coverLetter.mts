/**
 * Cover letter draft generator from SHORT metadata only (title, abstract snippet,
 * venue name, optional contribution note). Never accepts the full manuscript.
 * Output is a DRAFT with [PLACEHOLDERS] the author must fill and verify.
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
      temperature: 0.4,
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

const SYSTEM = `You draft journal-submission cover letters from SHORT metadata only
(title, abstract snippet, venue name, optional contribution note). Rules you MUST follow:

1. The letter is a DRAFT the author must edit. Use [PLACEHOLDERS] for anything you cannot
   know: [EDITOR NAME], [AUTHOR NAME], [AFFILIATION], [CORRESPONDING EMAIL], suggested
   reviewers, funding details.
2. One page maximum. Structure: greeting; 2–3 sentence contribution pitch in plain words
   (do NOT copy the abstract verbatim); 1–2 sentences on why it fits the named venue;
   standard declarations (original work, not under review elsewhere, all authors approved,
   no undisclosed conflicts) — phrased as statements the author must confirm are true.
3. Never overclaim ("groundbreaking", "guaranteed impact"), never invent results, metrics,
   Impact Factors, or editor names. Never state the paper will be accepted.
4. Return STRICT JSON:
{
  "letter": "full letter text with \\n line breaks",
  "tips": ["short actionable tip 1", "..."],
  "disclaimer": "one sentence: this is a draft the author must verify and edit"
}
Return 2-4 tips.`;

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
        letter: '',
        tips: [],
        disclaimer: 'Cover-letter drafting unavailable — no LLM provider configured.',
      },
      200
    );
  }

  let body: {
    title?: string;
    abstract?: string;
    venue?: string;
    contribution?: string;
    articleType?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  // Truncate aggressively — never full manuscript / PDF
  const title = String(body.title || '').slice(0, 300);
  const abstract = String(body.abstract || '').slice(0, 1200);
  const venue = String(body.venue || '').slice(0, 160);
  const contribution = String(body.contribution || '').slice(0, 500);
  const articleType = String(body.articleType || 'full article').slice(0, 60);

  if (!title.trim() || !abstract.trim()) {
    return json({ error: 'title and abstract required', letter: '', tips: [] }, 400);
  }

  const userId = await resolveUserId(req.headers.get('Authorization'));
  const gate = await checkAndIncrementUsage(userId, 0);
  if (!gate.allowed) {
    return json({ error: gate.reason, letter: '', tips: [], disclaimer: gate.reason }, 429);
  }

  const user = JSON.stringify({
    title,
    abstract,
    targetVenue: venue || '[TARGET JOURNAL]',
    authorContributionNote: contribution || null,
    articleType,
    instruction:
      'Draft the cover letter per the rules. Placeholders for unknown facts. No overclaiming.',
  });

  let lastErr = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const model = attempt > 0 ? provider.fallbackModel : provider.model;
      const { content, tokens } = await callChat(provider, model, SYSTEM, user);
      await checkAndIncrementUsage(userId, Math.max(tokens, 300));
      const parsed = JSON.parse(content) as {
        letter?: string;
        tips?: unknown[];
        disclaimer?: string;
      };
      const letter = String(parsed.letter || '').slice(0, 6000);
      if (!letter.trim()) throw new Error('empty letter');
      return json({
        letter,
        tips: Array.isArray(parsed.tips) ? parsed.tips.slice(0, 4).map((t) => String(t).slice(0, 240)) : [],
        disclaimer:
          parsed.disclaimer ||
          'This is an AI-assisted draft. You are responsible for every statement in it — verify the declarations are true before sending.',
      });
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
    }
  }

  return json(
    {
      error: lastErr.slice(0, 200),
      letter: '',
      tips: [],
      disclaimer: 'Cover-letter drafting failed — try again later.',
    },
    200
  );
};

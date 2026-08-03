/**
 * Response-to-reviewers scaffold: the author pastes reviewer comments (their own
 * decision letter — short excerpt, capped), and the LLM splits them into points and
 * drafts a polite point-by-point response TEMPLATE with [PLACEHOLDERS] for the
 * author's actual changes. Never accepts the full manuscript.
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

const SYSTEM = `You turn pasted peer-review comments into a structured, polite,
point-by-point response TEMPLATE. Rules you MUST follow:

1. Split the pasted text into individual reviewer points (max 12). Keep each original
   comment verbatim (trim only whitespace). If reviewers are numbered ("Reviewer 1",
   "R2"), preserve the grouping in the point labels.
2. For each point, draft a courteous response OPENER (thank/acknowledge, restate briefly)
   followed by a [PLACEHOLDER] for the author's actual answer, e.g.
   "[DESCRIBE THE CHANGE MADE, WITH SECTION/PAGE/LINE NUMBERS]" or, for disagreement,
   "[POLITE EVIDENCE-BASED REBUTTAL — cite data or literature]".
3. NEVER invent scientific content, results, or claims about what the author changed.
   The template must make clear the author fills in the substance.
4. Include a short preamble template thanking the editor/reviewers and summarizing that
   major changes are listed below (with a [SUMMARY OF MAJOR CHANGES] placeholder).
5. Return STRICT JSON:
{
  "preamble": "template text",
  "points": [
    { "label": "Reviewer 1, point 1", "comment": "verbatim comment", "response": "template with placeholders" }
  ],
  "disclaimer": "one sentence: templates only, author supplies the substance"
}`;

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
        preamble: '',
        points: [],
        disclaimer: 'Reviewer-response drafting unavailable — no LLM provider configured.',
      },
      200
    );
  }

  let body: { comments?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  // Cap pasted comments — short spans only, never a full manuscript
  const comments = String(body.comments || '').slice(0, 6000);
  if (comments.trim().length < 30) {
    return json({ error: 'Paste at least a few reviewer comments (30+ characters).', points: [] }, 400);
  }

  const userId = await resolveUserId(req.headers.get('Authorization'));
  const gate = await checkAndIncrementUsage(userId, 0);
  if (!gate.allowed) {
    return json({ error: gate.reason, preamble: '', points: [], disclaimer: gate.reason }, 429);
  }

  const user = JSON.stringify({
    reviewerComments: comments,
    instruction: 'Build the point-by-point response template per the rules. Max 12 points.',
  });

  let lastErr = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const model = attempt > 0 ? provider.fallbackModel : provider.model;
      const { content, tokens } = await callChat(provider, model, SYSTEM, user);
      await checkAndIncrementUsage(userId, Math.max(tokens, 300));
      const parsed = JSON.parse(content) as {
        preamble?: string;
        points?: { label?: string; comment?: string; response?: string }[];
        disclaimer?: string;
      };
      const points = (Array.isArray(parsed.points) ? parsed.points : [])
        .filter((p) => p && p.comment && p.response)
        .slice(0, 12)
        .map((p) => ({
          label: String(p.label || 'Point').slice(0, 80),
          comment: String(p.comment).slice(0, 1500),
          response: String(p.response).slice(0, 1500),
        }));
      if (points.length === 0) throw new Error('no points parsed');
      return json({
        preamble: String(parsed.preamble || '').slice(0, 2000),
        points,
        disclaimer:
          parsed.disclaimer ||
          'These are response templates only — you supply the scientific substance and verify every statement.',
      });
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
    }
  }

  return json(
    {
      error: lastErr.slice(0, 200),
      preamble: '',
      points: [],
      disclaimer: 'Reviewer-response drafting failed — try again later.',
    },
    200
  );
};

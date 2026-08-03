/**
 * Second-stage LLM filter for LanguageTool grammar findings.
 * Drops false positives (names, STEM jargon, style nits); keeps real grammar errors.
 * Never invents new findings — only keep/drop decisions for provided ids.
 *
 * Env: same LLM providers as explain/humanize + DAILY_TOKEN_CAP / DAILY_REQUEST_CAP
 * Prefer Gemini / Groq (xAI last — may be out of credits).
 */

import type { Context } from '@netlify/functions';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const XAI_URL = 'https://api.x.ai/v1/chat/completions';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

interface ProviderConfig {
  name: 'gemini' | 'groq' | 'xai' | 'openrouter';
  url: string;
  apiKey: string;
  model: string;
  fallbackModel: string;
  extraHeaders?: Record<string, string>;
}

function resolveProvider(): ProviderConfig | null {
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  const xaiKey = process.env.XAI_API_KEY;
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  const preferred = (process.env.LLM_PROVIDER || 'groq').toLowerCase();

  const chain: ProviderConfig[] = [];
  const push = (p: ProviderConfig | null) => {
    if (p) chain.push(p);
  };

  const gemini = (k: string): ProviderConfig => ({
    name: 'gemini',
    url: GEMINI_URL,
    apiKey: k.startsWith('yAIza') ? k.slice(1) : k,
    model: process.env.GEMINI_MODEL || 'gemini-flash-latest',
    fallbackModel: process.env.GEMINI_MODEL_FALLBACK || 'gemini-2.0-flash-lite',
  });
  const groq = (k: string): ProviderConfig => ({
    name: 'groq',
    url: GROQ_URL,
    apiKey: k,
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    fallbackModel: process.env.GROQ_MODEL_FALLBACK || 'llama-3.1-8b-instant',
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

  if ((preferred === 'gemini' || preferred === 'google') && geminiKey) push(gemini(geminiKey));
  if (preferred === 'groq' && groqKey) push(groq(groqKey));
  if (preferred === 'openrouter' && openRouterKey) push(openrouter(openRouterKey));
  // Free-first fallbacks (skip xAI until last — credits often exhausted)
  if (geminiKey) push(gemini(geminiKey));
  if (groqKey) push(groq(groqKey));
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
  for (const p of chain) {
    const id = `${p.name}:${p.apiKey.slice(0, 8)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    return p;
  }
  return null;
}

export interface GrammarFilterItemIn {
  id: string;
  text: string;
  message: string;
  ruleId: string;
  category: string;
}

const SYSTEM = `You filter LanguageTool grammar suggestions for academic research papers.

For each item, decide KEEP or DROP. Never invent new findings — only judge the provided items.

DROP when the flagged span is (or primarily is):
- A proper person/author name, surname, initials, or author list ("John Smith", "Zhang et al.", "J. Doe")
- A citation marker ([12], (Smith, 2020))
- A unit, symbol, chemical/material formula, acronym, or field-specific STEM jargon
- A stylistic preference, register tip, or British/American swap that does not hurt academic clarity
- An unknown-word spelling flag that is clearly intentional terminology or a name

KEEP when there is a clear, actionable grammar / agreement / tense / article / word-order / real misspelling problem that a researcher should fix before submission.

When unsure but the message describes a real structural grammar error, KEEP.
When unsure but the span looks like a name or jargon, DROP.
Output valid JSON only.`;

function buildUserPrompt(items: GrammarFilterItemIn[]): string {
  const payload = items.map((item) => ({
    id: item.id,
    text: String(item.text || '').slice(0, 220),
    message: String(item.message || '').slice(0, 240),
    ruleId: String(item.ruleId || '').slice(0, 80),
    category: String(item.category || '').slice(0, 60),
  }));

  return `Judge each LanguageTool suggestion. Return keep=true only for real actionable grammar/spelling errors.

Items:
${JSON.stringify(payload, null, 2)}

Respond with JSON:
{"decisions":[{"id":"...","keep":true,"reason":"short"},{"id":"...","keep":false,"reason":"proper name"}]}`;
}

async function callChatCompletion(
  url: string,
  apiKey: string,
  model: string,
  systemContent: string,
  userContent: string,
  extraHeaders?: Record<string, string>
): Promise<{ content: string; usage: { total_tokens: number } }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(extraHeaders || {}),
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: userContent },
      ],
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${url} ${res.status}: ${t}`);
  }

  const data = (await res.json()) as {
    choices: { message: { content: string } }[];
    usage?: { total_tokens?: number };
  };

  return {
    content: data.choices[0]?.message?.content || '{}',
    usage: { total_tokens: data.usage?.total_tokens || 0 },
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

  if (!url || !key || !userId) {
    return { allowed: true };
  }

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
  const rows = (await getRes.json()) as {
    tokens_used: number;
    requests_made: number;
  }[];

  const current = rows[0] || { tokens_used: 0, requests_made: 0 };
  if (current.requests_made >= reqCap) {
    return { allowed: false, reason: 'Daily request cap reached. Try again tomorrow.' };
  }
  if (current.tokens_used >= tokenCap) {
    return { allowed: false, reason: 'Daily token cap reached. Try again tomorrow.' };
  }

  const newTokens = current.tokens_used + tokens;
  const newReqs = current.requests_made + 1;

  if (rows[0]) {
    await fetch(`${url}/rest/v1/usage?user_id=eq.${userId}&date=eq.${today}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        tokens_used: newTokens,
        requests_made: newReqs,
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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

export default async (req: Request, _context: Context) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const provider = resolveProvider();
  if (!provider) {
    return json(
      {
        error: 'No LLM provider configured — set GEMINI_API_KEY or GROQ_API_KEY',
        decisions: [],
        fallback: true,
      },
      200
    );
  }

  let body: { items?: GrammarFilterItemIn[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const items = (body.items || []).slice(0, 40);
  if (!items.length) {
    return json({ decisions: [] });
  }

  const userId = await resolveUserId(req.headers.get('authorization'));
  const gate = await checkAndIncrementUsage(userId, 0);
  if (!gate.allowed) {
    return json({ error: gate.reason, decisions: [], fallback: true }, 429);
  }

  const batches: GrammarFilterItemIn[][] = [];
  for (let i = 0; i < items.length; i += 10) {
    batches.push(items.slice(i, i + 10));
  }

  const allDecisions: { id: string; keep: boolean; reason?: string }[] = [];
  let totalTokens = 0;

  for (let b = 0; b < batches.length; b++) {
    const prompt = buildUserPrompt(batches[b]);
    let attempt = 0;
    let done = false;
    while (attempt < 4 && !done) {
      try {
        const model = attempt > 1 ? provider.fallbackModel : provider.model;
        const result = await callChatCompletion(
          provider.url,
          provider.apiKey,
          model,
          SYSTEM,
          prompt,
          provider.extraHeaders
        );
        totalTokens += result.usage.total_tokens;
        const parsed = JSON.parse(result.content) as {
          decisions?: { id: string; keep: boolean; reason?: string }[];
        };
        for (const d of parsed.decisions || []) {
          if (!d?.id) continue;
          allDecisions.push({
            id: String(d.id),
            keep: d.keep !== false,
            reason: d.reason ? String(d.reason).slice(0, 120) : undefined,
          });
        }
        done = true;
      } catch (err) {
        attempt++;
        const wait = Math.min(8000, 500 * 2 ** attempt);
        console.error(`${provider.name} grammarFilter batch error`, err);
        await sleep(wait);
      }
    }
  }

  if (userId && totalTokens > 0) {
    await checkAndIncrementUsage(userId, totalTokens);
  }

  return json({ decisions: allDecisions, tokens: totalTokens });
};

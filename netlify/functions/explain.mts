/**
 * Background-friendly LLM explain endpoint for public MVP.
 * API keys stay server-side (Netlify env). Prefer free-tier Groq / Gemini / OpenRouter.
 *
 * Env:
 *   LLM_PROVIDER = groq | gemini | openrouter | xai
 *   GROQ_API_KEY (recommended free tier for MVP)
 *   GEMINI_API_KEY / GOOGLE_API_KEY
 *   OPENROUTER_API_KEY (optional free models)
 *   XAI_API_KEY (paid)
 *   DAILY_TOKEN_CAP, DAILY_REQUEST_CAP
 */

import type { Context } from '@netlify/functions';
import { extractMarkers } from '../../src/lib/citation/guard';

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

  const chain: Array<ProviderConfig | null> = [];
  const pushPreferred = () => {
    if (preferred === 'groq' && groqKey) chain.push(groqConfig(groqKey));
    if ((preferred === 'gemini' || preferred === 'google') && geminiKey) chain.push(geminiConfig(geminiKey));
    if (preferred === 'openrouter' && openRouterKey) chain.push(openRouterConfig(openRouterKey));
    if (preferred === 'xai' && xaiKey) chain.push(xaiConfig(xaiKey));
  };
  pushPreferred();
  // Free-first fallbacks for public MVP (never require a specific personal key)
  if (groqKey) chain.push(groqConfig(groqKey));
  if (openRouterKey) chain.push(openRouterConfig(openRouterKey));
  if (geminiKey) chain.push(geminiConfig(geminiKey));
  if (xaiKey) chain.push(xaiConfig(xaiKey));

  const seen = new Set<string>();
  for (const p of chain) {
    if (!p) continue;
    const id = `${p.name}:${p.apiKey.slice(0, 8)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    return p;
  }
  return null;
}

function geminiConfig(apiKey: string): ProviderConfig {
  return {
    name: 'gemini',
    url: GEMINI_URL,
    apiKey: apiKey.startsWith('yAIza') ? apiKey.slice(1) : apiKey,
    model: process.env.GEMINI_MODEL || 'gemini-flash-latest',
    fallbackModel: process.env.GEMINI_MODEL_FALLBACK || 'gemini-2.0-flash-lite',
  };
}

function groqConfig(apiKey: string): ProviderConfig {
  return {
    name: 'groq',
    url: GROQ_URL,
    apiKey,
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    fallbackModel: process.env.GROQ_MODEL_FALLBACK || 'llama-3.1-8b-instant',
  };
}

function openRouterConfig(apiKey: string): ProviderConfig {
  return {
    name: 'openrouter',
    url: OPENROUTER_URL,
    apiKey,
    model: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free',
    fallbackModel: process.env.OPENROUTER_MODEL_FALLBACK || 'google/gemma-3-27b-it:free',
    extraHeaders: {
      'HTTP-Referer': process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://revision-assistant.app',
      'X-Title': 'Revision Assistant MVP',
    },
  };
}

function xaiConfig(apiKey: string): ProviderConfig {
  return {
    name: 'xai',
    url: XAI_URL,
    apiKey,
    model: process.env.XAI_MODEL || 'grok-3-mini',
    fallbackModel: process.env.XAI_MODEL_FALLBACK || 'grok-3-mini',
  };
}

interface SpanIn {
  id: string;
  kind: string;
  category: string;
  text: string;
  sourceTitle?: string | null;
  sourceUrl?: string | null;
  sourceType?: string | null;
  matchPct?: number | null;
  aiFeatures?: Record<string, number> | null;
  context?: string;
}

const SYSTEM = `You are a research-paper revision assistant — NOT a plagiarism or AI-detection evasion tool.

Rules:
- Explain WHY a passage was flagged and what the author should change themselves.
- NEVER return a drop-in replacement paragraph that could be pasted to game a detector.
- NEVER invent or fabricate citations (authors, titles, years, DOIs). If you lack a real source, say so.
- For student-paper matches: do not propose a citation.
- For missing citations: suggest adding a proper citation if the source is identifiable; describe the fix clearly.
- For AI flags: use the provided feature diagnostics; coach specificity, voice, and evidence — not synonym tricks.
- CITATION PRESERVATION IS NON-NEGOTIABLE: each span may include "existingCitations" — markers already present in that passage. Your guidance must explicitly tell the author to keep every one of those exact markers in their rewrite. Never suggest deleting, renumbering, or paraphrasing away a citation marker.
- Be concise (3–6 sentences per span). Output valid JSON only.`;

function buildUserPrompt(spans: SpanIn[], citationStyle: string): string {
  const payload = spans.map((s) => ({
    id: s.id,
    kind: s.kind,
    category: s.category,
    text: s.text.slice(0, 800),
    existingCitations: extractMarkers(s.text).map((m) => m.marker),
    sourceTitle: s.sourceTitle,
    sourceUrl: s.sourceUrl,
    sourceType: s.sourceType,
    matchPct: s.matchPct,
    aiFeatures: s.aiFeatures,
    context: (s.context || '').slice(0, 600),
  }));

  return `Citation style preferred: ${citationStyle || 'unknown'}.

For each span, return explanation + optional suggestion (guidance only, not a full rewrite). If "existingCitations" is non-empty, your suggestion MUST tell the author to retain those exact markers.

Spans:
${JSON.stringify(payload, null, 2)}

Respond with JSON:
{"explanations":[{"id":"...","explanation":"...","suggestion":"..."}]}`;
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
      temperature: 0.35,
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
    // Anonymous / unconfigured: allow small free pass with env-less local dev
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
    await fetch(
      `${url}/rest/v1/usage?user_id=eq.${userId}&date=eq.${today}`,
      {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({
          tokens_used: newTokens,
          requests_made: newReqs,
        }),
      }
    );
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

export default async (req: Request, _context: Context) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const provider = resolveProvider();
  if (!provider) {
    return json(
      {
        error: 'No LLM provider configured — set GEMINI_API_KEY, GROQ_API_KEY, or XAI_API_KEY',
        explanations: [],
        fallback: true,
      },
      200
    );
  }

  let body: { spans?: SpanIn[]; citationStyle?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const spans = (body.spans || []).slice(0, 30);
  if (!spans.length) {
    return json({ explanations: [] });
  }

  const userId = await resolveUserId(req.headers.get('authorization'));
  const gate = await checkAndIncrementUsage(userId, 0);
  if (!gate.allowed) {
    return json({ error: gate.reason, explanations: [] }, 429);
  }

  const citationStyle = body.citationStyle || 'unknown';
  const batches: SpanIn[][] = [];
  for (let i = 0; i < spans.length; i += 8) {
    batches.push(spans.slice(i, i + 8));
  }

  const allExplanations: { id: string; explanation: string; suggestion?: string }[] = [];
  let totalTokens = 0;

  for (let b = 0; b < batches.length; b++) {
    const prompt = buildUserPrompt(batches[b], citationStyle);
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
          explanations?: { id: string; explanation: string; suggestion?: string }[];
        };
        if (parsed.explanations) allExplanations.push(...parsed.explanations);
        done = true;
      } catch (err) {
        attempt++;
        const wait = Math.min(8000, 500 * 2 ** attempt);
        console.error(`${provider.name} batch error`, err);
        await sleep(wait);
      }
    }
  }

  // Record token usage (second increment for tokens only — requests already counted)
  if (userId && totalTokens > 0) {
    await checkAndIncrementUsage(userId, totalTokens);
  }

  return json({ explanations: allExplanations, tokens: totalTokens });
};

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

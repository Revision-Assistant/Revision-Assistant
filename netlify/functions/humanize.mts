/**
 * LLM humanize drafts for AI-flagged / restatement spans.
 * Returns reviewable drafts — never silent full-document rewrite.
 */

import type { Context } from '@netlify/functions';
import { extractMarkers } from '../../src/lib/citation/guard';

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

function resolveProvider(): ProviderConfig | null {
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  const xaiKey = process.env.XAI_API_KEY;
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  const preferred = (process.env.LLM_PROVIDER || 'groq').toLowerCase();

  const configs: ProviderConfig[] = [];
  const push = (p: ProviderConfig | null) => {
    if (p) configs.push(p);
  };
  if (preferred === 'groq' && groqKey) {
    push({
      name: 'groq',
      url: GROQ_URL,
      apiKey: groqKey,
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      fallbackModel: process.env.GROQ_MODEL_FALLBACK || 'llama-3.1-8b-instant',
    });
  }
  if ((preferred === 'gemini' || preferred === 'google') && geminiKey) {
    push({
      name: 'gemini',
      url: GEMINI_URL,
      apiKey: geminiKey.startsWith('yAIza') ? geminiKey.slice(1) : geminiKey,
      model: process.env.GEMINI_MODEL || 'gemini-flash-latest',
      fallbackModel: process.env.GEMINI_MODEL_FALLBACK || 'gemini-2.0-flash-lite',
    });
  }
  if (preferred === 'openrouter' && openRouterKey) {
    push({
      name: 'openrouter',
      url: OPENROUTER_URL,
      apiKey: openRouterKey,
      model: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free',
      fallbackModel: process.env.OPENROUTER_MODEL_FALLBACK || 'google/gemma-3-27b-it:free',
      extraHeaders: {
        'HTTP-Referer': process.env.URL || 'https://revision-assistant.app',
        'X-Title': 'Revision Assistant MVP',
      },
    });
  }
  if (groqKey) {
    push({
      name: 'groq',
      url: GROQ_URL,
      apiKey: groqKey,
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      fallbackModel: process.env.GROQ_MODEL_FALLBACK || 'llama-3.1-8b-instant',
    });
  }
  if (openRouterKey) {
    push({
      name: 'openrouter',
      url: OPENROUTER_URL,
      apiKey: openRouterKey,
      model: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free',
      fallbackModel: process.env.OPENROUTER_MODEL_FALLBACK || 'google/gemma-3-27b-it:free',
      extraHeaders: {
        'HTTP-Referer': process.env.URL || 'https://revision-assistant.app',
        'X-Title': 'Revision Assistant MVP',
      },
    });
  }
  if (geminiKey) {
    push({
      name: 'gemini',
      url: GEMINI_URL,
      apiKey: geminiKey.startsWith('yAIza') ? geminiKey.slice(1) : geminiKey,
      model: process.env.GEMINI_MODEL || 'gemini-flash-latest',
      fallbackModel: process.env.GEMINI_MODEL_FALLBACK || 'gemini-2.0-flash-lite',
    });
  }
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
  for (const p of configs) {
    const id = `${p.name}:${p.apiKey.slice(0, 8)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    return p;
  }
  return null;
}

interface SpanIn {
  id: string;
  kind: string;
  category: string;
  text: string;
}

const SYSTEM = `You help researchers revise academic prose in their own voice.

Rules:
- Return a revised DRAFT of each passage that sounds more specific, less formulaic, and more human — without gaming detectors.
- Preserve meaning, technical terms, numbers, units, Greek letters, and EVERY citation marker exactly (e.g. [12], (Smith, 2020)).
- Do not invent citations, DOIs, or sources.
- Do not synonym-swap to evade plagiarism tools; rewrite for clarity and authorial voice.
- Keep roughly similar length (±30%).
- Output valid JSON only.`;

function buildPrompt(spans: SpanIn[], citationStyle: string): string {
  const payload = spans.map((s) => ({
    id: s.id,
    category: s.category,
    text: s.text.slice(0, 900),
    keepMarkers: extractMarkers(s.text).map((m) => m.marker),
  }));
  return `Citation style: ${citationStyle || 'unknown'}.

For each span, write one revised draft. Keep keepMarkers unchanged in the draft.

Spans:
${JSON.stringify(payload, null, 2)}

Respond with JSON:
{"drafts":[{"id":"...","draft":"..."}]}`;
}

async function callChat(
  provider: ProviderConfig,
  model: string,
  userContent: string
): Promise<string> {
  const res = await fetch(provider.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json',
      ...(provider.extraHeaders || {}),
    },
    body: JSON.stringify({
      model,
      temperature: 0.45,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userContent },
      ],
    }),
  });
  if (!res.ok) throw new Error(`${provider.name} ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0]?.message?.content || '{}';
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
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const provider = resolveProvider();
  if (!provider) {
    return json({ error: 'No LLM provider configured', drafts: [] }, 200);
  }

  let body: { spans?: SpanIn[]; citationStyle?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const spans = (body.spans || []).slice(0, 16);
  if (!spans.length) return json({ drafts: [] });

  const all: { id: string; draft: string }[] = [];
  for (let i = 0; i < spans.length; i += 4) {
    const batch = spans.slice(i, i + 4);
    const prompt = buildPrompt(batch, body.citationStyle || 'unknown');
    let attempt = 0;
    while (attempt < 3) {
      try {
        const model = attempt > 0 ? provider.fallbackModel : provider.model;
        const content = await callChat(provider, model, prompt);
        const parsed = JSON.parse(content) as { drafts?: { id: string; draft: string }[] };
        if (parsed.drafts) all.push(...parsed.drafts);
        break;
      } catch (err) {
        attempt++;
        console.error('humanize batch', err);
        await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
      }
    }
  }

  return json({ drafts: all });
};

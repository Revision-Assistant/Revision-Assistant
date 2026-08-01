/**
 * Vite dev middleware: serves /.netlify/functions/explain using Gemini from .env
 * so Grammar/Plagiarism/AI Solve + pipeline explain work without `netlify dev`.
 */
import type { Plugin, Connect } from 'vite';
import { loadEnv } from 'vite';

type SpanIn = {
  id: string;
  kind?: string;
  category?: string;
  text: string;
  sourceTitle?: string | null;
  matchPct?: number | null;
  context?: string;
};

function normalizeKey(raw: string): string {
  let key = raw.trim().replace(/^["']|["']$/g, '');
  if (key.startsWith('yAIza')) key = key.slice(1);
  const m = key.match(/AIza[0-9A-Za-z_-]{20,}/);
  return m ? m[0] : key;
}

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function systemForMode(mode?: string): string {
  const base = `You are an Academic Writing Repair Specialist. Improve manuscripts; do not game detectors.
Hard rules: never invent citations; keep citation markers, numbers, units, formulas, proper nouns exact; JSON only.`;
  if (mode === 'ai') {
    return `${base}
Mode AI: for each span return explanation, suggestion, draftRewrite with more natural academic voice.`;
  }
  if (mode === 'plagiarism') {
    return `${base}
Mode PLAGIARISM: for each span return explanation, suggestion, draftRewrite as a deep structural restatement (not synonym swap).`;
  }
  return `${base}
For each span return explanation, suggestion, and optional draftRewrite.`;
}

function buildPrompt(spans: SpanIn[], citationStyle: string, mode?: string): string {
  return `citationStyle=${citationStyle}; mode=${mode || 'auto'}
Return JSON: {"explanations":[{"id":"...","explanation":"...","suggestion":"...","draftRewrite":"..."}]}
Spans:
${JSON.stringify(
    spans.map((s) => ({
      id: s.id,
      category: s.category,
      kind: s.kind,
      text: s.text,
      sourceTitle: s.sourceTitle,
      matchPct: s.matchPct,
      context: (s.context || '').slice(0, 400),
    })),
    null,
    0
  )}`;
}

async function geminiGenerate(
  apiKey: string,
  model: string,
  system: string,
  user: string
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: 'application/json',
      },
    }),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 400);
    throw new Error(`Gemini ${res.status}: ${detail}`);
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '{}';
}

export function explainDevPlugin(): Plugin {
  return {
    name: 'explain-dev-middleware',
    configureServer(server) {
      const env = loadEnv(server.config.mode, server.config.root, '');
      const apiKey = normalizeKey(env.GEMINI_API_KEY || env.GOOGLE_API_KEY || '');
      const models = [
        env.GEMINI_MODEL || 'gemini-flash-latest',
        env.GEMINI_MODEL_FALLBACK || 'gemini-2.0-flash-lite',
        'gemini-2.0-flash',
        'gemini-2.0-flash-lite',
      ].filter(Boolean);

      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0] || '';
        if (url !== '/.netlify/functions/explain') return next();

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        try {
          if (!apiKey) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ explanations: [], fallback: true, error: 'GEMINI_API_KEY missing in .env' }));
            return;
          }

          const raw = await readBody(req);
          const body = JSON.parse(raw || '{}') as {
            spans?: SpanIn[];
            citationStyle?: string;
            mode?: string;
          };
          const spans = (body.spans || []).slice(0, 30);
          if (!spans.length) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ explanations: [] }));
            return;
          }

          const system = systemForMode(body.mode);
          const user = buildPrompt(spans, body.citationStyle || 'unknown', body.mode);
          let content = '';
          let lastErr: unknown;
          for (const model of models) {
            try {
              content = await geminiGenerate(apiKey, model, system, user);
              lastErr = null;
              break;
            } catch (e) {
              lastErr = e;
            }
          }
          if (lastErr && !content) throw lastErr;

          let explanations: unknown[] = [];
          try {
            const parsed = JSON.parse(content) as { explanations?: unknown[] };
            explanations = parsed.explanations || [];
          } catch {
            const m = content.match(/\{[\s\S]*\}/);
            if (m) {
              const parsed = JSON.parse(m[0]) as { explanations?: unknown[] };
              explanations = parsed.explanations || [];
            }
          }

          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ explanations, provider: 'gemini-dev' }));
        } catch (e) {
          console.error('[explain-dev]', e);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              explanations: [],
              fallback: true,
              error: e instanceof Error ? e.message : String(e),
            })
          );
        }
      });
    },
  };
}

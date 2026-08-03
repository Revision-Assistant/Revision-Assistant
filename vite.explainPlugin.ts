/**
 * Local Vite middleware so /.netlify/functions/{explain,humanize} work in `npm run dev`
 * when GROQ_API_KEY / GEMINI_API_KEY are in .env (same keys as Netlify).
 */
import type { Plugin } from 'vite';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function loadDotEnv(root: string): void {
  const p = resolve(root, '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    if (process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

async function groqJson(system: string, user: string): Promise<string> {
  const key = process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) throw new Error('No GROQ_API_KEY / GEMINI_API_KEY in .env for local functions');
  const isGemini = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) && !process.env.GROQ_API_KEY;
  const url = isGemini
    ? 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
    : 'https://api.groq.com/openai/v1/chat/completions';
  const apiKey = key.startsWith('yAIza') ? key.slice(1) : key;
  const model = isGemini
    ? process.env.GEMINI_MODEL || 'gemini-flash-latest'
    : process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
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
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0]?.message?.content || '{}';
}

export function netlifyFunctionsDevPlugin(): Plugin {
  return {
    name: 'netlify-functions-dev',
    configureServer(server) {
      loadDotEnv(server.config.root);
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || '';
        if (req.method !== 'POST') return next();
        if (
          url !== '/.netlify/functions/humanize' &&
          url !== '/.netlify/functions/explain' &&
          !url.startsWith('/.netlify/functions/humanize?') &&
          !url.startsWith('/.netlify/functions/explain?')
        ) {
          return next();
        }
        try {
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as {
            spans?: { id: string; text: string; category?: string }[];
            citationStyle?: string;
          };
          const spans = (body.spans || []).slice(0, 16);
          if (url.includes('humanize')) {
            const system = `Revise academic passages for clearer human voice. Keep citations/numbers. JSON {"drafts":[{"id","draft"}]}.`;
            const user = `Style: ${body.citationStyle || 'unknown'}\n${JSON.stringify(spans)}`;
            const content = await groqJson(system, user);
            const parsed = JSON.parse(content) as { drafts?: unknown };
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ drafts: parsed.drafts || [] }));
            return;
          }
          const system = `Academic revision coach. JSON {"explanations":[{"id","explanation","suggestion"}]}.`;
          const user = JSON.stringify(spans);
          const content = await groqJson(system, user);
          const parsed = JSON.parse(content) as { explanations?: unknown };
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ explanations: parsed.explanations || [] }));
        } catch (err) {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
              drafts: [],
              explanations: [],
            })
          );
        }
      });
    },
  };
}

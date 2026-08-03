#!/usr/bin/env node
/**
 * Iterative Grok (xAI) bug audit for Revision Assistant.
 * Reads XAI_API_KEY from .env — never prints the key.
 *
 *   node --use-system-ca training/local/grok_bug_audit.mjs --round 1
 *   node --use-system-ca training/local/grok_bug_audit.mjs --round 2 --fixed-summary "..."
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const ENV_PATH = path.join(ROOT, '.env');
const OUT_DIR = path.join(__dirname, 'grok_audit_rounds');

/** Prefer xAI/Grok; fall back to Groq/Gemini when credits are exhausted. */
function resolveProviders(env) {
  const list = [];
  const xai = process.env.XAI_API_KEY || env.XAI_API_KEY;
  if (xai) {
    list.push({
      name: 'xai',
      url: 'https://api.x.ai/v1/chat/completions',
      apiKey: xai,
      model: process.env.XAI_MODEL || env.XAI_MODEL || 'grok-3-mini',
      fallbackModel:
        process.env.XAI_MODEL_FALLBACK || env.XAI_MODEL_FALLBACK || 'grok-3-mini',
    });
  }
  const groq = process.env.GROQ_API_KEY || env.GROQ_API_KEY;
  if (groq) {
    list.push({
      name: 'groq',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      apiKey: groq,
      model: process.env.GROQ_MODEL || env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      fallbackModel:
        process.env.GROQ_MODEL_FALLBACK || env.GROQ_MODEL_FALLBACK || 'llama-3.1-8b-instant',
    });
  }
  const gemini = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  if (gemini) {
    const key = gemini.startsWith('yAIza') ? gemini.slice(1) : gemini;
    list.push({
      name: 'gemini',
      url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      apiKey: key,
      model: process.env.GEMINI_MODEL || env.GEMINI_MODEL || 'gemini-flash-latest',
      fallbackModel:
        process.env.GEMINI_MODEL_FALLBACK || env.GEMINI_MODEL_FALLBACK || 'gemini-2.0-flash-lite',
    });
  }
  return list;
}

function loadEnv(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    env[k] = v;
  }
  return env;
}

const ROUND_FILES = {
  1: [
    'src/lib/pipeline.ts',
    'src/lib/export/exportPdf.ts',
    'src/lib/export/changeLog.ts',
    'src/lib/grammar/languageTool.ts',
    'src/lib/ai/localScan.ts',
    'src/lib/citation/guard.ts',
    'src/lib/citation/citationNeed.ts',
    'src/lib/files/limits.ts',
    'src/hooks/usePrivacySession.ts',
  ],
  2: [
    'src/App.tsx',
    'src/components/FindingsQueue.tsx',
    'src/components/PaperView.tsx',
    'src/components/UploadZone.tsx',
    'src/lib/rewrite/humanizeClient.ts',
    'src/lib/rewrite/entityGuard.ts',
    'src/lib/alignment/fuzzyMatch.ts',
    'src/lib/quality/manuscriptQuality.ts',
    'src/lib/citation/crossref.ts',
  ],
  3: [
    'src/lib/pipeline.ts',
    'src/lib/export/exportPdf.ts',
    'src/lib/export/changeLog.ts',
    'src/App.tsx',
    'src/components/FindingsQueue.tsx',
    'src/lib/grammar/languageTool.ts',
    'src/lib/ai/localScan.ts',
    'src/lib/citation/guard.ts',
    'src/lib/pdf/textUtils.ts',
  ],
};

const SYSTEM = `You are a senior TypeScript/React engineer doing a defect-first code review of a browser-side academic Revision Assistant.

Focus ONLY on real bugs: incorrect logic, race conditions, wrong offsets/spans, silent data loss, citation integrity failures, apply-edit errors, privacy wipe races, upload/path bugs, false-positive generators that clearly misuse offsets, PDF export overlay bugs.

Ignore style nits, naming, comments, and "nice to have" refactors unless they hide a defect.

Return STRICT JSON (no markdown fences) with this shape:
{
  "round_notes": "one sentence",
  "bugs": [
    {
      "id": "R{N}-{n}",
      "file": "path",
      "severity": "what user sees",
      "root_cause": "why",
      "severity": "high|medium|low",
      "suggested_fix": "concrete change",
      "confidence": 0.0
    }
  ]
}

Prefer fewer high-confidence real defects over a long speculative list. Cap at 8 bugs. severity high/medium first.`;

function readFiles(relPaths, maxEach = 14000, budget = 55000) {
  const parts = [];
  let total = 0;
  for (const rel of relPaths) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) {
      parts.push(`\n===== MISSING: ${rel} =====\n`);
      continue;
    }
    let text = fs.readFileSync(p, 'utf8');
    if (text.length > maxEach) {
      text = text.slice(0, maxEach) + `\n…[truncated at ${maxEach} chars]…`;
    }
    const block = `\n===== FILE: ${rel} =====\n${text}\n`;
    if (total + block.length > budget) {
      parts.push(`\n===== SKIPPED (budget): ${rel} =====\n`);
      continue;
    }
    parts.push(block);
    total += block.length;
  }
  return parts.join('');
}

function parseArgs(argv) {
  const out = { round: null, fixedSummary: '', extraFiles: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--round') out.round = Number(argv[++i]);
    else if (a === '--fixed-summary') out.fixedSummary = argv[++i] || '';
    else if (a === '--extra-files') {
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) {
        out.extraFiles.push(argv[++i]);
      }
    }
  }
  return out;
}

function parseJsonContent(content) {
  let c = content.trim();
  if (c.startsWith('```')) {
    c = c.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }
  const start = c.indexOf('{');
  const end = c.lastIndexOf('}');
  if (start >= 0 && end > start) c = c.slice(start, end + 1);
  return JSON.parse(c);
}

async function chat(provider, model, messages) {
  const res = await fetch(provider.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({ model, temperature: 0.2, messages }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  const data = JSON.parse(text);
  return data.choices[0].message.content;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.round) {
    console.error('Usage: --round N [--fixed-summary "..."]');
    process.exit(2);
  }
  const env = loadEnv(ENV_PATH);
  const providers = resolveProviders(env);
  if (providers.length === 0) {
    console.error('ERROR: no LLM API keys found (XAI/GROQ/GEMINI)');
    process.exit(2);
  }

  const files = [...(ROUND_FILES[args.round] || ROUND_FILES[3])];
  for (const f of args.extraFiles) {
    if (!files.includes(f)) files.push(f);
  }

  const codeBlob = readFiles(files);
  const user = `Round ${args.round} defect review of Revision Assistant.

Product context:
- Client-side pipeline parses PDF/DOCX, aligns Turnitin reports, grammar, citation-need, quality, then optional LLM explain/humanize.
- Authors accept/edit/dismiss findings; export watermarked PDF preserving layout when possible; change log with citation integrity.
- Privacy wipe after idle; apply-all must not drop citations.

${
    args.fixedSummary
      ? `Previously fixed in earlier rounds:\n${args.fixedSummary}`
      : 'This is the first audit round — find concrete bugs.'
  }

Code excerpts:
${codeBlob}

Return STRICT JSON only as specified.`;

  const messages = [
    { role: 'system', content: SYSTEM.replace('{N}', String(args.round)) },
    { role: 'user', content: user },
  ];

  let content = null;
  let usedProvider = null;
  let lastErr = null;
  for (const provider of providers) {
    for (const m of [...new Set([provider.model, provider.fallbackModel])]) {
      try {
        console.error(
          `Calling ${provider.name} model=${m} round=${args.round} files=${files.length}…`
        );
        content = await chat(provider, m, messages);
        usedProvider = `${provider.name}:${m}`;
        break;
      } catch (e) {
        lastErr = String(e?.message || e);
        console.error(`${provider.name}/${m} failed: ${lastErr.slice(0, 300)}`);
      }
    }
    if (content) break;
  }
  if (!content) {
    console.error(`ERROR: all models failed: ${lastErr}`);
    process.exit(1);
  }
  console.error(`Using provider ${usedProvider}`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const rawPath = path.join(OUT_DIR, `round${args.round}_raw.txt`);
  fs.writeFileSync(rawPath, content, 'utf8');

  let parsed;
  try {
    parsed = parseJsonContent(content);
  } catch (e) {
    console.error(`WARN: could not parse JSON (${e}); raw at ${rawPath}`);
    console.log(content.slice(0, 2000));
    process.exit(1);
  }

  parsed._meta = { provider: usedProvider, round: args.round };
  const outPath = path.join(OUT_DIR, `round${args.round}.json`);
  fs.writeFileSync(outPath, JSON.stringify(parsed, null, 2), 'utf8');
  console.log(JSON.stringify(parsed, null, 2));
  console.error(`\nSaved: ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

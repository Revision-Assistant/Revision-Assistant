// Dual-LLM UX review collector. Usage: node review_loop/collect_round.mjs <roundNum> [changesFile]
// Reads .env for keys (never prints them). Writes review_loop/round<N>_<model>.json
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const round = process.argv[2] || '1';
const changesFile = process.argv[3];

function loadEnv() {
  const env = {};
  const raw = readFileSync(path.join(ROOT, '.env'), 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}
const ENV = loadEnv();

function slice(file, max = 9000) {
  const p = path.join(ROOT, file);
  if (!existsSync(p)) return `(missing: ${file})`;
  const t = readFileSync(p, 'utf8');
  return t.length > max ? t.slice(0, max) + '\n/* ...truncated... */' : t;
}

const changesSummary = changesFile && existsSync(changesFile)
  ? readFileSync(changesFile, 'utf8')
  : '(First round — no prior changes.)';

const APP_DESCRIPTION = `
# Revision Assistant — web app under review

Single-page React app for researchers. Brand: sage/forest greens, serif display font (Literata) + DM Sans. Privacy-first: analysis runs in-browser, session auto-wipes after 10 min idle.

## User flow / screens
1. LANDING / UPLOAD: hero + working-title input + 3 drop slots (Manuscript required PDF/DOCX; optional Similarity report PDF; optional AI writing report PDF) + Analyze button + "What this session covers" scope list + legal footer.
2. ANALYSIS PROGRESS: stepper (Manuscript, Reports, Align, Sort, Citations, Quality, Grammar, Guidance, Ready) with % bar.
3. WORKSPACE (after analysis): top bar (title, open-findings count, citation style select, "Apply all fixes (N)", Export menu (change log txt / watermarked PDF), Start over). Two-pane split:
   - LEFT PaperView: full manuscript text with colored highlights per finding category, page chips nav, Revised-manuscript toggle.
   - RIGHT FindingsQueue: guided triage. Tabs "Findings | Journal readiness". Progress bar "X of Y reviewed", Prev/Next buttons, filter chips (Everything/Citations/Similarity/AI/Quality/Grammar), search, Show reviewed / Show informational toggles. Cards sorted by severity (Fix first / Review / Polish / FYI). Expanded card: "What to do" guidance, Fix & next / Draft rewrite (assistant reword, review-only) / Mark reviewed & next / Edit text / Dismiss, "Why was this flagged?" disclosure, author note. Grammar suggestions batched into one card in the Everything view with "Fix N safe ones". Humanize bar: "Draft all AI flags (N)" then "Accept N drafts".
4. JOURNAL READINESS tab: disclaimer, 3 score cards (Q1-like / Q2-like / IEEE-oriented, /100), checklist, "What to correct" gaps, suggested venues (heuristic + optional LLM refresh), PDF export.
5. Privacy banner (countdown), legal footer (long attributions/disclaimers).

## Changes made since previous review round
${changesSummary}
`;

const COMPACT = process.env.REVIEW_COMPACT === '1';
const CODE = COMPACT ? `
=== src/components/UploadZone.tsx (copy excerpt) ===
${slice('src/components/UploadZone.tsx', 2000)}

=== src/components/FindingsQueue.tsx (guided triage, excerpt) ===
${slice('src/components/FindingsQueue.tsx', 3000)}
` : `
=== src/App.tsx (layout + workspace bar + export menu) ===
${slice('src/App.tsx')}

=== src/components/UploadZone.tsx ===
${slice('src/components/UploadZone.tsx')}

=== src/components/AnalysisProgress.tsx ===
${slice('src/components/AnalysisProgress.tsx')}

=== src/components/FindingsQueue.tsx (guided triage) ===
${slice('src/components/FindingsQueue.tsx', 14000)}

=== src/components/PaperView.tsx ===
${slice('src/components/PaperView.tsx', 7000)}

=== src/components/JournalReadiness.tsx ===
${slice('src/components/JournalReadiness.tsx', 8000)}

=== src/components/LegalNotices.tsx (footer, truncated) ===
${slice('src/components/LegalNotices.tsx', 4000)}

=== src/App.css (excerpt) ===
${slice('src/App.css', 6000)}
`;

const PROMPT = `You are reviewing a real shipped web app. Two personas, both required:

PERSONA A — Senior UX auditor: list concrete structural / clarity / hierarchy / accessibility / copy issues. Be specific and actionable; reference the actual code/copy given. No generic advice.

PERSONA B — First-time researcher user (a PhD student who just got a similarity report from their university): think aloud through these tasks and note every point of confusion: (1) upload a paper, (2) understand what the findings mean, (3) fix issues, (4) check journal readiness, (5) export results.

${APP_DESCRIPTION}

ACTUAL SOURCE CODE EXCERPTS:
${CODE}

Respond with ONLY valid JSON (no markdown fences), schema:
{
  "auditor_issues": [
    {"issue": "short title", "screen": "upload|progress|workspace|paper_view|findings_queue|journal|footer|global", "severity": "high|medium|low", "why": "1-2 sentences", "fix": "specific suggested fix"}
  ],
  "first_time_user_confusions": [
    {"issue": "what confused them", "screen": "...", "severity": "high|medium|low", "why": "the think-aloud moment", "fix": "suggested fix"}
  ]
}
Max ~12 items per list, ordered by severity. Do not invent features that are not in the code.`;

async function callGemini() {
  const key = ENV.GEMINI_API_KEY || ENV.GOOGLE_API_KEY;
  if (!key) return { ok: false, note: 'no GEMINI_API_KEY' };
  const models = ['gemini-2.5-pro', 'gemini-flash-latest', ENV.GEMINI_MODEL, ENV.GEMINI_MODEL_FALLBACK].filter(Boolean);
  for (const model of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: PROMPT }] }],
            generationConfig: { temperature: 0.4, maxOutputTokens: 8192, responseMimeType: 'application/json' },
          }),
        }
      );
      if (!res.ok) {
        console.error(`gemini ${model}: HTTP ${res.status}`);
        continue;
      }
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
      if (text.trim()) return { ok: true, model, text };
      console.error(`gemini ${model}: empty response`);
    } catch (e) {
      console.error(`gemini ${model}: ${e.message}`);
    }
  }
  return { ok: false, note: 'all gemini models failed' };
}

async function callOpenAICompat(name, baseUrl, key, models) {
  if (!key) return { ok: false, note: `no key for ${name}` };
  for (const model of models.filter(Boolean)) {
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: PROMPT }],
          temperature: 0.4,
          max_tokens: 8000,
          response_format: { type: 'json_object' },
        }),
      });
      if (!res.ok) {
        const body = (await res.text()).slice(0, 200);
        console.error(`${name} ${model}: HTTP ${res.status} ${body}`);
        continue;
      }
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content || '';
      if (text.trim()) return { ok: true, model, text };
      console.error(`${name} ${model}: empty`);
    } catch (e) {
      console.error(`${name} ${model}: ${e.message}`);
    }
  }
  return { ok: false, note: `all ${name} models failed` };
}

function tryParse(text) {
  const cleaned = text.replace(/^```(json)?/m, '').replace(/```\s*$/m, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch { /* fall through */ }
    }
    return null;
  }
}

function save(label, result) {
  const out = path.join(ROOT, 'review_loop', `round${round}_${label}.json`);
  if (!result.ok) {
    writeFileSync(out, JSON.stringify({ ok: false, note: result.note }, null, 2));
    console.log(`${label}: FAILED (${result.note})`);
    return;
  }
  const parsed = tryParse(result.text);
  writeFileSync(
    out,
    JSON.stringify({ ok: true, model: result.model, parsed, raw: parsed ? undefined : result.text }, null, 2)
  );
  console.log(`${label}: OK model=${result.model} parsed=${!!parsed} auditor=${parsed?.auditor_issues?.length ?? '?'} user=${parsed?.first_time_user_confusions?.length ?? '?'}`);
}

if (COMPACT) {
  const groq = await callOpenAICompat('groq', 'https://api.groq.com/openai/v1', ENV.GROQ_API_KEY, [
    'llama-3.3-70b-versatile', 'llama-3.1-8b-instant',
  ]);
  save('groq', groq);
  console.log('done');
  process.exit(0);
}

const [gem, grok] = await Promise.all([
  callGemini(),
  callOpenAICompat('xai', 'https://api.x.ai/v1', ENV.XAI_API_KEY, [
    'grok-4', 'grok-4-fast', 'grok-4-fast-non-reasoning', 'grok-3', ENV.XAI_MODEL, ENV.XAI_MODEL_FALLBACK,
  ]),
]);
save('gemini', gem);
save('grok', grok);

if (!grok.ok) {
  console.log('grok failed -> trying Groq fallback');
  const groq = await callOpenAICompat('groq', 'https://api.groq.com/openai/v1', ENV.GROQ_API_KEY, [
    'llama-3.3-70b-versatile', 'llama-3.1-8b-instant',
  ]);
  save('groq', groq);
}
console.log('done');

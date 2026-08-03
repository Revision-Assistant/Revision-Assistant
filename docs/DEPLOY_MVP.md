# Public MVP deploy (Netlify) — no private manuscripts

This app ships **without** any files from `test/` or personal similarity reports.
Users upload their own papers in the browser.

## Manual deploy (fastest for your current site)

### Option A — Netlify CLI (recommended)

1. Open a terminal in the project folder (`plag and AI`).
2. Install deps if needed: `npm install`
3. Build: `npm run build`
4. Log in (once): `npx netlify login` → browser login
5. Link the existing site (once): `npx netlify link` → pick `revision-assistant-mvp`
6. Publish: `npx netlify deploy --prod`

That uploads `dist/` + `netlify/functions` to production.

### Option B — Netlify UI (drag & drop)

1. Run `npm run build` locally.
2. Open [app.netlify.com](https://app.netlify.com) → your site **revision-assistant-mvp**.
3. **Deploys** → **Deploy manually** → drag the **`dist`** folder.
4. Note: drag-and-drop may **not** update serverless functions. Prefer Option A if LLM explain must keep working.

### Option C — Git push (if the site is connected to GitHub)

1. Commit and push `main`.
2. Netlify auto-builds with `npm run build`, publish `dist`, functions `netlify/functions`.

After any deploy: hard-refresh the site (`Ctrl+Shift+R`) so the old UI cache clears.

### Env vars (Site settings → Environment variables)

Keep these in Netlify (not in git):

```
LLM_PROVIDER=groq
GROQ_API_KEY=<new free key>
VITE_CITATION_MODEL_ID=<your public HF model id>
```

Rebuild after changing any `VITE_*` variable (they are baked into the client at build time).

---

## 1. Free storage for the citation-need model (~110 MB ONNX)

Netlify site bundles should not carry multi‑hundred‑MB weights. Host them for free:

| Option | Free tier | How to use |
|--------|-----------|------------|
| **Hugging Face Hub** (recommended) | Unlimited public model hosting | Create a **public** model repo, upload `public/models/citation-need/**` including `onnx/`, set `VITE_CITATION_MODEL_ID=you/repo-name` |
| Cloudflare R2 | 10 GB / mo | Upload ONNX; put public URL in a thin HF-style layout or proxy |
| GitHub Releases | Soft size limits | Attach zip; less ideal for transformers.js |

### Hugging Face steps

```bash
# once: huggingface-cli login
# create repo on https://huggingface.co/new (type: Model, public)

# from machine that has the trained export:
huggingface-cli upload YOUR_USER/revision-assistant-citation-need \
  public/models/citation-need \
  --repo-type model
```

If unset, the app falls back to rules-based citation-need (still works).

## 2. Free LLM APIs (server-side only — not your personal .env)

Create **new** free-tier keys for the public site. Do **not** commit keys. Set them only in Netlify UI.

| Provider | Signup | Env vars | Notes |
|----------|--------|----------|-------|
| **Groq** (recommended) | https://console.groq.com | `LLM_PROVIDER=groq` `GROQ_API_KEY=…` | Free daily quota; fast |
| **Google AI Studio** | https://aistudio.google.com/apikey | `LLM_PROVIDER=gemini` `GEMINI_API_KEY=…` | Free tier; rate limits |
| **OpenRouter free models** | https://openrouter.ai | `LLM_PROVIDER=openrouter` `OPENROUTER_API_KEY=…` `OPENROUTER_MODEL=meta-llama/llama-3.3-70b-instruct:free` | Free model routes |

Optional caps:

```
DAILY_REQUEST_CAP=30
DAILY_TOKEN_CAP=20000
```

Grammar uses the **public LanguageTool** endpoint (no key) unless you set `VITE_LANGUAGETOOL_URL`.

## 3. Privacy guarantees for this MVP

- `test/` is gitignored — never published
- `public/samples/` has no manuscripts (only `.gitkeep`)
- Demo loaders removed from the UI
- Papers stay in the browser; session wipes after 10 minutes idle
- Findings JSON only is stored if the user signs in (optional Supabase)

## 4. What users get online

1. Upload **their** PDF/DOCX (+ optional similarity / AI writing reports)
2. Grammar + citation integrity + citation-need (HF model or rules)
3. Plagiarism align when a similarity PDF is provided
4. AI flags from an AI writing PDF **or** local voice heuristics
5. Explanation and citation guidance via Netlify function + free LLM tier — guidance only, never a drop-in rewrite

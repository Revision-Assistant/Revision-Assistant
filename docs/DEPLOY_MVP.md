# Public MVP deploy (Netlify) — no private manuscripts

This app ships **without** any files from `test/` or personal Turnitin reports.
Users upload their own papers in the browser.

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

Then in Netlify → Site settings → Environment variables:

```
VITE_CITATION_MODEL_ID=YOUR_USER/revision-assistant-citation-need
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

## 3. Deploy to Netlify (paid plan OK)

```bash
# from repo root — ensure test/ is not tracked
git status   # must NOT list test/ papers or public/samples/*.docx|pdf

npm run build
npx netlify deploy --prod
```

Or connect the GitHub repo in Netlify UI (build: `npm run build`, publish: `dist`, functions: `netlify/functions`).

### Required Netlify env (minimum for LLM-backed explanations)

```
LLM_PROVIDER=groq
GROQ_API_KEY=<new free key>
VITE_CITATION_MODEL_ID=<your public HF model id>
```

## 4. Privacy guarantees for this MVP

- `test/` is gitignored — never published
- `public/samples/` has no manuscripts (only `.gitkeep`)
- Demo loaders removed from the UI
- Papers stay in the browser; only findings JSON is stored if the user signs in (optional Supabase)

## 5. What users get online

1. Upload **their** PDF/DOCX (+ optional Turnitin reports)
2. Grammar + citation integrity + citation-need (HF model or rules)
3. Plagiarism align when a similarity PDF is provided
4. AI flags from Turnitin AI PDF **or** local voice heuristics
5. Explanation and citation guidance via Netlify function + free LLM tier — guidance only, never a drop-in rewrite

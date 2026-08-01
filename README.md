# Research Paper Revision Assistant

A **revision assistant** for authors: upload your paper and Turnitin reports, locate every flagged passage, understand *why* it was flagged, and guide your own rewrite. Ships a **change log** you can show a supervisor.

> Not a score-reduction or detector-evasion tool. Parsing runs in the browser; PDFs are never uploaded.

## Stack (MVP · target $0/month)

| Layer | Service |
|---|---|
| Frontend | React + Vite on Netlify Free |
| LLM | Groq via Netlify Function (key server-side only) |
| Auth + DB | Supabase Free (findings JSON only, RLS) |
| PDF / match | `pdf.js`, Fuse.js / Dice / Levenshtein in-browser |

See [`plan.md`](./plan.md) for full product decisions and pipeline design.

## Quick start

```bash
npm install
npm run dev
```

Open the Vite URL. Upload:

1. **Paper PDF** (required)
2. **Similarity report** (optional but recommended)
3. **AI report** (optional)

Analysis stages 1–4 run entirely client-side. Stage 5 (Groq explanations) calls `/.netlify/functions/explain` when available; otherwise local templates are used for AI flags and rules-based copy for similarity.

### Unit tests (rules, fingerprint, alignment)

```bash
npm install   # includes tsx
npm run test:unit
```

## Environment

Copy `.env.example` → `.env` for local Vite vars:

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

Netlify function env (Netlify UI or CLI):

```env
GROQ_API_KEY=...
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_ANON_KEY=...
DAILY_TOKEN_CAP=50000
DAILY_REQUEST_CAP=40
```

## Supabase setup

1. Create a free project.
2. Run [`supabase/schema.sql`](./supabase/schema.sql) in the SQL editor.
3. Enable email magic-link auth.
4. Add GitHub Actions secrets `SUPABASE_URL` + `SUPABASE_ANON_KEY` so [`.github/workflows/supabase-keepalive.yml`](./.github/workflows/supabase-keepalive.yml) pings hourly (avoids free-tier pause after 7 idle days).

**Never store paper/report PDFs** — only findings rows.

## Deploy (Netlify)

```bash
npm run build
# or
npx netlify deploy --prod
```

- Build command: `npm run build`
- Publish directory: `dist`
- Functions directory: `netlify/functions`

Local full stack (Vite + functions):

```bash
npm run netlify:dev
```

## Pipeline map

| Stage | Where | Module |
|---|---|---|
| 1 Parse paper (PDF or DOCX) | Browser | `src/lib/pdf/paperParser.ts`, `src/lib/docx/extractDocx.ts` |
| 2 Parse reports + fingerprint | Browser | `src/lib/pdf/reportParser.ts`, `badgeReport.ts`, `fingerprint.ts` |
| 3 Align spans | Browser | `src/lib/alignment/fuzzyMatch.ts` |
| 4 Rules categories | Browser | `src/lib/categorize/rules.ts` |
| 5 Citation-need detection | Browser | `src/lib/citation/citationNeed.ts` |
| 5 Grammar/style check | Browser → LanguageTool | `src/lib/grammar/languageTool.ts` |
| 6 Citation metadata lookup | Browser → Crossref | `src/lib/citation/crossref.ts` |
| 7 Explain (escalated only) | Netlify + Groq/xAI | `netlify/functions/explain.mts` |
| 8 UI + export | Browser | `src/components/*`, `src/lib/export/changeLog.ts` |

### How similarity reports are read

Turnitin's standard PDF export **rasterizes the submitted document** — on the body pages the
prose is an image, and the only extractable text is the small numeric match badges overlaid
on it. There is no flagged excerpt text in the file to scrape.

`badgeReport.ts` therefore works from what *is* machine-readable: each badge's number and
(page, x, y), plus the numbered source list on the originality pages. Because the author
uploads their paper separately, a badge's position maps back onto their real text, giving
exact offsets. A badge marks *where* a match occurs but not *how much* of the sentence it
covers, so findings say so rather than implying the whole span was copied. Text-based
exports still fall back to excerpt scraping.

Sources Turnitin weights below 1% are labelled **Trivial match** and shown greyed with the
reason attached — visible, not hidden, per the display decision in plan.md §12.

**Grammar** findings are explicit, reviewable edits — LanguageTool proposes a correction, the author clicks "Apply fix" (or edits it) to accept it. STEM jargon repeated across the paper is filtered out automatically so real issues aren't buried. Every apply/edit — including grammar fixes — runs through the citation-integrity guard (`src/lib/citation/guard.ts`), which blocks (and requires an explicit override for) any change that would drop a citation marker present in the original text.

**LLM provider**: set `GROQ_API_KEY` and/or `XAI_API_KEY` (Grok, OpenAI-compatible) in the Netlify function env — see `.env.example`.

### Category rules (v1)

Informational (shown greyed, not hidden): reference entry, properly quoted, already cited, common phrase, methods boilerplate.

Actionable: missing in-text citation, needs new citation, needs restatement, source unidentifiable (incl. student papers — **no citation proposed**), AI flagged, orphan refs, broken citations.

Only `needs_new_citation`, `needs_restatement`, and `ai_flagged` are sent to Groq. Prompts forbid drop-in rewrites and fabricated citations.

## Privacy / terms notes (before launch)

- State plainly that parsing is in-browser and files are not uploaded.
- Product is a revision assistant, not a score-reduction service.
- Authors should check institutional policy on Turnitin reports and third-party tools.
- Per-user Groq caps are enforced in the Netlify function when Supabase service role is configured.

## Models

**Citation-need detection** finds the gap Turnitin structurally cannot: a claim you wrote in
your own words that still needs attribution. Turnitin only reports text overlapping a source
it has indexed, so an uncited "previous studies have shown…" is invisible to it. v1 is
rules-based and precision-weighted — a wrong *"you must cite this"* costs more than a miss,
so ambiguous sentences are left alone and own-work sentences ("we simulated…", "as shown in
Fig. 4") are explicitly suppressed.

[`training/`](./training) has two runnable Kaggle notebooks that replace those rules with
learned models, both on free compute:

| Notebook | What it learns | Data |
|---|---|---|
| `citation_need_kaggle.ipynb` | SciBERT / DeBERTa-v3-small citation-need classifier | Open-access papers — a sentence that carried a citation is a free positive label |
| `false_positive_classifier.ipynb` | LightGBM ranking of which flags you actually accept | Your own accept/dismiss labels, exported from the app |

Neither model rewrites text or proposes a source — citation-need outputs a single
probability, so fabricated citations are impossible by construction. Inference runs
in-browser via quantized ONNX + `transformers.js`, preserving the "paper never leaves your
machine" property. See [`training/README.md`](./training/README.md).

**Export training labels** in the workspace bar writes `*_labels.jsonl` — one row per
accept/dismiss with its engineered features. Accumulate these; the classifier needs ~300
rows before it beats the rules, and the notebook checks that for you.

## Post-MVP

False-positive classifier from accept/dismiss labels, citation-need detection, source retrieval with verification, LanguageTool grammar, DOCX tracked changes — see plan §9.

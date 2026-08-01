# Research Paper Revision Assistant — Build Plan

**Version:** 1.0
**Stack:** React + Netlify + Supabase + Groq
**Target cost:** $0/month for MVP

---

## 1. What this product is

A **revision assistant**. The author uploads their paper and their Turnitin reports; the tool locates every flagged passage, explains *why* it was flagged, and guides the author's own rewrite.

### Scope boundaries

These are product decisions, not just ethics — they determine what you build.

| Feature | Build this | Not this |
|---|---|---|
| Plagiarism | Add correct citations, guide genuine restatement | Synonym-swapping to lower the score (Turnitin catches paraphrased text anyway) |
| AI flags | Explain what makes a passage read as machine-generated | Optimize text against a detector score (doesn't transfer to Turnitin's model, and turns this into an evasion tool) |
| Grammar | Explicit, reviewable edits the author accepts or rejects | Silent full-paragraph rewrites |

The output the author walks away with is a revised paper **plus a change log** they can show a supervisor. That change log is a feature, not an afterthought.

---

## 2. Architecture

The expensive parts run in the browser. This is what makes the MVP free — and it means the paper never leaves the user's machine, which is a real selling point for a plagiarism tool.

```
BROWSER                          NETLIFY                    SUPABASE
────────────────────────────────────────────────────────────────────
pdf.js
  ├─ parse paper           
  ├─ parse similarity report
  └─ parse AI report
        │
alignment (fuzzy → embeddings)
        │
rules-based categorization
        │
        ├──── flagged spans ────► background function ──► Groq API
        │                          (API key lives here)
        │                          per-user daily cap
        │◄──── explanations ───────────┘
        │
        └──── findings JSON ──────────────────────────► Postgres + RLS
                                                        (files NOT stored)
```

**Why this split:**
- PDF parsing and embeddings are CPU-heavy but not secret → browser
- The Groq API key **must not** reach the browser → Netlify function only
- Only small JSON hits Supabase → free tier lasts effectively forever

---

## 3. Free-tier budget

| Layer | Service | Allowance |
|---|---|---|
| Frontend | Netlify Free | 100 GB bandwidth, 125k function invocations, 300 build min |
| Long jobs | Netlify Background Functions | 15-min runtime, available on Free |
| DB + auth | Supabase Free | 500 MB DB, 1 GB storage, 5 GB egress, 50k MAU, 2 projects |
| PDF + embeddings | Browser (pdf.js, transformers.js) | $0 |
| LLM | Groq | Free tier, or Developer tier with $0 minimum |

### Gotchas to design around

1. **Supabase pauses free projects after 7 days with no DB request.** Fix: GitHub Actions cron pinging hourly. Free. Do this on day one or you will get burned during a demo.
2. **Don't store the PDFs.** Store findings JSON only (a few KB vs several MB). Keeps you under 1 GB storage and 5 GB egress permanently.
3. **Netlify sync functions time out well before an LLM batch finishes.** Use background functions and Supabase Realtime for progress, not a blocking request.
4. **No backups on Supabase Free.** Findings are regenerable from the source PDFs, so this is acceptable for MVP — but know it.

---

## 4. Processing pipeline

### Stage 1 — Parse the paper
`pdf.js` → text with page and character offsets. Segment into sentences and IMRaD sections (Abstract / Intro / Methods / Results / Discussion / References).

Also extract:
- **The reference list** as structured entries (authors, year, title, venue) — needed by Stage 4
- **In-text citation markers** and their positions
- **Citation style**, auto-detected from formatting: `[1]` brackets → IEEE, superscript numerals → Vancouver, `Author (Year)` → APA/Harvard. Show the detected style in a dropdown the user can override. Auto-detect with confirmation beats making them choose from a blank field.

### Stage 2 — Parse the Turnitin reports
**Format is confirmed consistent across sample reports → this is deterministic extraction, no ML.**

Extract from the similarity report:
- Flagged spans (text + position)
- Match Overview table: source URL/title + percentage per source
- Overall similarity percentage

Extract from the AI report:
- Flagged sentences
- Overall AI percentage

**Required safeguard — format fingerprinting.** Turnitin will change their template eventually. On ingest, verify: page-1 header text, expected section labels, table column positions. On mismatch, **fail loudly** with "unsupported report format." Silently mis-parsing and giving someone wrong advice about their paper is the worst failure mode this product has.

### Stage 3 — Align report spans to the paper
Fuzzy string matching first (`fuse.js` or a Levenshtein ratio, ~90% threshold on normalized text). PDF reflow, hyphenation, and ligatures break naive matching.

Only if match rate falls below ~90%: add `transformers.js` with a quantized MiniLM (~25 MB ONNX, WASM) for semantic matching. **Measure before adding this.**

### Stage 4 — Categorize (rules for v1)

Each similarity span gets one label:

| Label | Rule | Cost |
|---|---|---|
| Reference entry | Span falls inside the References section | free |
| Properly quoted | Span sits inside quotation marks | free |
| Already cited | Citation marker within ~15 tokens | free |
| Common phrase | Under 8 words, or matches a boilerplate list | free |
| Methods boilerplate | In Methods section + matches standard-protocol patterns | free |
| **Missing in-text citation** | Source **is** in the author's reference list, but no citation marker near the span | free |
| **Needs new citation** | Source **is not** in the reference list → escalate to LLM | tokens |
| **Needs restatement** | Long span, high overlap, no citation | tokens |
| **Source unidentifiable** | Turnitin gave a student-paper or database match | flag only |

Only two categories cost tokens. Everything else resolves with rules.

#### Source-type handling

Turnitin's Match Overview returns three kinds of source, and they need different treatment:

| Turnitin source type | Resolvable? | Treatment |
|---|---|---|
| Internet source (URL) | Yes | Match against reference list, fetch metadata |
| Publication (journal/book) | Yes | Match against reference list, Crossref lookup |
| Student paper ("Submitted to X University") | **No** | Cannot show the user the matched text or propose a citation. Present as "requires your judgement" with lower confidence and no suggestion. |

Never propose a citation for a student-paper match. There is nothing to cite.

#### Reference-list cross-check

Parse the paper's own reference list in Stage 1 and match Turnitin's identified sources against it (fuzzy on title, tight on year and first author surname). Be conservative — on an uncertain match, fall through to the LLM path rather than asserting a match.

This split is worth the effort because the two outcomes are completely different fixes:
- **In the reference list** → "you cite this paper, but this passage has no in-text citation." A ten-second fix, high confidence, zero tokens.
- **Not in the reference list** → a genuine gap requiring a new source. Needs the LLM.

Two free bonus features fall out of having the reference list parsed, and both are things journals reject papers for:
- **Orphan references** — in the bibliography but never cited in the text
- **Broken citations** — cited in the text but missing from the bibliography

### Stage 5 — Explain (Groq)
For escalated spans only, request: why it was flagged, what specifically to change, and a suggested citation if a source is identifiable. **Never** return a drop-in replacement paragraph — return guidance.

For AI-flagged paragraphs, compute feature diagnostics locally (sentence-length variance, hedging density, count of concrete numbers/entities/citations) and have the LLM turn them into readable feedback.

### Stage 6 — Present
Split pane: paper left with colored spans, issue queue right. Accept / dismiss / edit per finding. Export revised text + change log.

---

## 5. Groq integration

### Setup
Generate a key at `console.groq.com/keys`. Nothing else to purchase — Groq has no separate API product or credit system. Adding a card moves you to Developer tier (10x rate limits, 25% discount, zero minimum spend).

Groq is OpenAI-SDK compatible — usually just a base-URL change. **Keep a thin provider adapter anyway** so you can swap later without touching business logic.

### Model routing

| Task | Model | Rate (per 1M) |
|---|---|---|
| Explanations, revision guidance | GPT-OSS 120B | $0.15 in / $0.60 out |
| Binary classification fallback | Llama 3.1 8B Instant | $0.05 in / $0.08 out |

Batch API gives 50% off for async jobs — a good fit here, since analysis is already a background job.

### Rate limits are the real constraint, not cost

Free tier: **6,000 tokens/min, 30 requests/min, 14,400 requests/day**, enforced at the *organization* level (extra API keys do not help).

Design rules:
- **Never send the whole paper.** Send flagged spans plus ~2 sentences of surrounding context.
- Batch 5–10 spans per request.
- Queue with exponential backoff inside the background function.
- Per-user daily cap enforced server-side so one user can't drain the account.

At 2–4k tokens per paper, cost is **under $0.01 per analysis** — roughly 100+ papers per dollar.

### Kimi K3 — not for this
2.8T parameters, not hosted on Groq, impractical to self-host. Available via Moonshot's API or OpenRouter if you ever want to A/B it on rewrite-guidance quality, but it is not an MVP decision.

---

## 6. Data model (Supabase)

```sql
profiles (id → auth.users, created_at)

projects (id, user_id, title, created_at,
          similarity_pct, ai_pct, report_format_version)

findings (id, project_id,
          kind,           -- similarity | ai | grammar
          category,       -- from Stage 4
          start_offset, end_offset, page,
          source_url, source_title, match_pct,
          explanation, suggestion,
          status,         -- open | accepted | dismissed
          created_at)

usage (user_id, date, tokens_used, requests_made)  -- rate limiting
```

RLS on every table keyed to `auth.uid()`. No exceptions.

**`findings.status` is your most valuable asset.** Every accept/dismiss is a labelled training example for the classifier in Section 8. Log them from day one even though you won't use them for months.

---

## 7. Build order

| Week | Deliverable | Done when |
|---|---|---|
| 0 (½ day) | **Parser spike** — local Python script against sample reports | You can reliably recover flagged text + source for every sample |
| 1 | pdf.js paper parsing + section segmentation, no backend | Upload a PDF, see structured text |
| 2 | Report parser + fingerprint guard + alignment | ≥90% of flagged spans map to correct paper offsets |
| 3 | Rules categorization + split-pane viewer | Colored spans, accept/dismiss works, zero LLM calls |
| 4 | Supabase auth + persistence, Netlify function + Groq, deploy | End-to-end on a live URL |

Weeks 1–3 involve no API costs and no backend. If the product isn't useful by end of week 3, the LLM won't save it.

---

## 8. Accuracy and evaluation

Hand-label findings for 20–30 of your sample reports. Track on every change:

| Metric | Target |
|---|---|
| Span alignment recall | ≥ 95% |
| Category precision (needs-citation) | ≥ 90% |
| Fabricated citations | **0 — non-negotiable** |
| Grammar suggestion precision (F₀.₅) | Precision-weighted; a wrong "fix" is worse than a miss |

Ship a confidence threshold. Below it, show "review manually" rather than a confident wrong answer.

---

## 9. Post-MVP roadmap

Ordered by return on effort. Do none of these until the MVP has real users.

1. **False-positive classifier** — LightGBM over engineered features (section, span length, in-quotes, citation proximity, source type, n-gram frequency), trained on accumulated accept/dismiss labels. Upgrade to fine-tuned DeBERTa-v3-small at ~2k labels. *This is the moat — nobody else has your label set.*
2. **Citation-need detection** — flag claim sentences needing citations even when Turnitin didn't. Bootstrap training data by stripping citations from open-access PMC/arXiv papers.
3. **Source retrieval (RAG)** — bi-encoder over OpenAlex/Crossref → cross-encoder rerank → LLM verification. **Never surface an unverified citation.**
4. **Real grammar engine** — self-hosted LanguageTool + an edit-based GEC model (GECToR-style: comparable accuracy to seq2seq at ~10x speed, and emits explicit gateable edits rather than over-correcting your terminology).
5. **DOCX export** with tracked changes.
6. **pgvector** for cross-paper similarity once the browser approach hits its ceiling.

---

## 10. Reference repositories

| Repo | For |
|---|---|
| `mozilla/pdf.js` | Browser PDF parsing |
| `huggingface/transformers.js` | In-browser ONNX embeddings |
| `pymupdf/PyMuPDF` (discussions #820, #1573) | Parser spike — highlight extraction |
| `supabase/supabase` `examples/` | RLS, storage, realtime patterns |
| `languagetool-org/languagetool` | Grammar engine (post-MVP) |
| `citation-js/citation-js` | Formatting citations from Crossref metadata |
| `rapidfuzz/RapidFuzz` | Alignment reference implementation |

---

## 11. Before launch

- [ ] Check institutional policy on uploading Turnitin reports to third-party services — the report is the user's document, but rules vary
- [ ] Privacy statement: state plainly that parsing happens in-browser and files are never uploaded
- [ ] Terms that describe the product as a revision assistant, not a score-reduction service
- [ ] Supabase keep-alive cron running
- [ ] Per-user Groq cap enforced and tested

---

## 12. Resolved decisions

| # | Decision | Consequence |
|---|---|---|
| 1 | **Two separate PDFs** — similarity report and AI report uploaded independently | Three upload slots total. Make the AI report **optional** — plenty of users only have the similarity report, and blocking them on a file they don't have kills conversion. |
| 2 | **PDF only** for the paper | One parser path, `pdf.js`. DOCX later. Note the tradeoff: PDF offsets are messier than DOCX, so Stage 3 alignment carries more weight. |
| 3 | **Author-only** | No sharing, no roles, no org model in v1. Cuts roughly a week. The exported change log is how a supervisor sees anything. |
| 4 | **All citation styles**, auto-detected with user override | Detection is rules-based and cheap. Formatting a *new* citation correctly per style is the real work — use `citation-js`, don't hand-roll it. |
| 5 | **Parse the reference list and cross-check** | See Stage 4. Splits the highest-stakes category into two very different fixes and cuts token spend. |

### Display decision: show false positives, don't hide them

Spans your rules classify as reference entries, common phrases, or boilerplate get shown **greyed out with the reason attached**, not removed.

The user is looking at their own Turnitin report alongside your tool. If your tool shows 12 issues where Turnitin showed 40, they will assume it is broken. Showing "28 of these are reference-list entries and standard phrasing — here's why" is the single clearest demonstration that the tool understands the report better than they do. It is also your best answer to the obvious question of why they should pay for this.

# Grok / LLM iterative bug audit

Date: 2026-08-02

Preferred API: xAI Grok (`XAI_API_KEY` / `grok-3-mini`). **xAI returned HTTP 403 (credits / spending limit)** on every round, so reviews fell back to **Gemini** (`gemini-flash-latest`) via the same OpenAI-compatible chat script (`training/local/grok_bug_audit.mjs`). Groq was tried but hit TPM 413 on large payloads.

No API keys are recorded here. Round JSON lives in `training/local/grok_audit_rounds/`.

## Round 1 — pipeline / export / grammar / citation

| ID | Severity | Finding | Action |
|----|----------|---------|--------|
| R1-1 | high (defensive) | `sourceBytes` sliced after parsers may touch buffers | Copy `sourceBytes` at start of `runPipeline` |
| R1-2 | high | pdf-lib WinAnsi crash on em-dash / curly quotes | `sanitizeWinAnsi` + ASCII watermark |
| R1-3 | high | `findNormalizedIndex` returned `0` on map failure; char-trim also drifted on spaces | Origin map + return `-1`; later `findNormalizedRange` |
| R1-4 | medium | Citation model `!== false` vs docs “opt-in” | `requestCitationModel === true` |

## Round 2 — UI / state

| ID | Severity | Finding | Action |
|----|----------|---------|--------|
| R2-1 | medium | Page anchors stacked at top → jump always to page 1 | Interleave anchors at page offsets in `PaperView` |
| R2-2 | medium | Uploads cleared before pipeline → failed runs force re-upload | Clear File handles only after success |
| R2-3 | medium | Stale `editText` across selection | Clear edit state when `selectedId` changes |

Also fixed (local): `analyzeGenRef` so Start over / privacy wipe ignore stale pipeline results; `humanizeRunRef` for stale humanize responses.

## Round 3 — export / privacy

| ID | Severity | Finding | Action |
|----|----------|---------|--------|
| R3-1 | high | Dual `downloadText` in one tick → changelog blocked | 350ms delay between downloads |
| R3-2 | high | Overlay used `idx + needle.length` on raw hay with normalized needle | `findNormalizedRange` for true raw end |
| R3-3 | high | Multi-line rewrite drawn outside whiteout | Expand whiteout to replacement footprint |
| R3-4 | medium | Privacy wipe kept manuscript title | `setFiles(EMPTY_FILES)` on wipe + Start over |

## Verification

- `npx tsc --noEmit` — green (post-fixes)
- `npm run test:unit` — green, including `pdfDrawSafe.test.ts`

## Deploy

- Production: https://revision-assistant-mvp.netlify.app
- Unique: https://6a6f550bfaf660dafa211469--revision-assistant-mvp.netlify.app

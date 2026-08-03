# Training

Two models, both from `plan.md` §9, both trainable on free compute (Kaggle T4 ×2 / Colab).

| Notebook | Model | Trains on | Replaces |
|---|---|---|---|
| `citation_need_kaggle.ipynb` | SciBERT / DeBERTa-v3-small classifier | Open-access papers (S2ORC / PMC OA / arXiv) | the rules in `src/lib/citation/citationNeed.ts` |
| `false_positive_classifier.ipynb` | LightGBM → DeBERTa at ~2k labels | Your own accept/dismiss labels | nothing — it's a new ranking layer |

## Why these two

Neither model rewrites anything. They both *find* things the current pipeline misses:

- **Citation-need** — Turnitin only flags text overlapping a source it has indexed. It is blind to a claim you wrote in your own words that still needs attribution. That's the more common reviewer complaint, and it's a supervised-learning problem with essentially free labels: in a published open-access paper, a sentence that carries a citation is a positive example, and stripping the marker gives you the input.
- **False-positive ranking** — every accept/dismiss in the app is a human judgement on whether a flag was real. `plan.md` calls this the moat. Export labels from the app (**Export training labels** in the workspace bar) and accumulate them.

## Getting the data (all free, no card required)

| Source | Size | Access |
|---|---|---|
| **S2ORC** (Semantic Scholar) | 136M papers, citation spans pre-annotated | API key, free for research |
| **PMC Open Access Subset** | ~5M biomedical full texts | Direct FTP/HTTP bulk download, no auth |
| **unarXive** | 1.9M arXiv papers with resolved citations | Hugging Face `saier/unarxive_citrec` |
| **CORE** | 290M open-access papers | Free API key |

`unarxive_citrec` on Hugging Face is the fastest start — it is *already* framed as citation
recommendation, so the positive/negative split is done for you.

### Local (this machine) — larger free corpus

You already have `raw_train.jsonl` (~unarXive). Rebuild a bigger balanced set and retrain:

```bash
cd training/local
# optional refresh from HF:
# python download_citation_data.py --max-blobs 400000

python prepare_data.py 200000   # default is now 200k balanced rows (hard-neg mining)
python train_scibert.py         # 3 epochs, precision target 0.90, min threshold 0.55
python export_onnx.py
```

Latest citation-need retrain (hard-neg mined 200k pool → 48k train on laptop GPU, 2 epochs): test @ t=0.55 → P=0.941 R=0.822 F1=0.878 AUC=0.957 (prior ship: t=0.30 P=0.924 R=0.933). Live app also floors threshold at ≥0.55 and requires an attribution cue unless score is very high.

### Manuscript quality (numerical / publication / novelty-claim)

Weakly labeled multi-class SciBERT from open arXiv-derived text (unarXive citrec, optional
`armanc/scientific_papers` abstracts, rewrite_data open pairs) plus template augmentation on
clean open sentences. Not a novelty search or formal stats audit.

```bash
cd training/local
python prepare_quality_data.py 400000   # aim ≥100k selected rows
python train_quality.py 120000          # SciBERT, 4 epochs, precision-first thresholds
python export_quality_onnx.py
python upload_quality_to_hf.py          # needs HF_TOKEN → revision-assistant-manuscript-quality
```

Set `VITE_QUALITY_MODEL_ID` (local `.env` + Netlify). Metrics land in
`quality_best/inference_config.json` / `quality_train_metrics.json`.

Latest hard train (2026-08-02, RTX 3050): **150k** selected sentences (400k unarXive blobs +
rewrite_data open pairs + template synth on open clean sentences; HF arXiv stream skipped for
reliability). SciBERT 90k×3 epochs, **77 min** wall. Test @ t=0.55 (weak-label holdout):
macro P/R/F1 ≈ 0.996/0.997/0.996; any-issue P/R/F1 ≈ 0.995/0.998/0.997; AUC ≈ 0.999.
Hub: `sk1729271/revision-assistant-manuscript-quality`. Live UI floors mid-confidence with
surface cues; metrics are on weakly labeled data matching the training distribution — not a
human gold audit.

### Journal readiness (multi-label heuristic heads)

Weakly labeled SciBERT multi-label classifier from **open research only** (unarXive /
arXiv-derived blobs). Heads: `structure_ok`, `numerical_clear`, `novelty_ok`,
`methods_concrete`, `selective_ready`, `ieee_craft`. These feed **Q1-like / Q2-like /
IEEE-oriented craft heuristics** in the app — **not** acceptance probability, **not**
Scimago/Clarivate quartiles, **not** IEEE affiliation. No paywalled full texts, student
papers, Turnitin dumps, or scraped rank DBs.

```bash
cd training/local
python prepare_journal_data.py 250000
python train_journal_readiness.py 24000
python export_journal_onnx.py
python upload_journal_to_hf.py   # needs HF_TOKEN → revision-assistant-journal-readiness
```

Set `VITE_JOURNAL_MODEL_ID` (local `.env` + Netlify). If the model is missing, the UI uses
pure checklist heuristics. Optional Netlify `journalSuggest` refreshes open-venue ideas from
title/abstract only (LLM; no full PDF).

Rewrite models (optional offline Flan-T5):

```bash
python prepare_rewrite_data.py --force   # ParaSCI + SciHRA, larger caps (open HF datasets)
python filter_rewrite_data.py
python train_rewrite.py --task plag --epochs 2 --max-train 20000
python train_rewrite.py --task ai --epochs 2 --max-train 20000
```

Caps in `prepare_rewrite_data.py`: `MAX_PLAG=120000`, `MAX_AI=60000` (quality filter yields ~16k plag / ~1.7k AI train pairs). Latest offline Flan-T5 retrain (2 epochs, CUDA): plag eval_loss ≈ 2.48; ai eval_loss ≈ 2.99. Weights under `training/local/rewrite_best/{plag,ai}/` — browser ONNX not shipped; live humanize uses Netlify LLM.

### Report-driven revision (offline)

Product “debug from reports” uses uploaded similarity/AI PDF fields in the findings UI and
Netlify `explain` (match %, sources, report excerpt, origin). To train offline Flan-T5 on the
*same open pairs* with report-style framing (no private papers):

```bash
cd training/local
# requires existing filtered plag_*.jsonl / ai_*.jsonl
python prepare_report_debug_data.py
python train_report_debug.py --task report_plag --epochs 2 --max-train 12000
python train_report_debug.py --task report_ai --epochs 2 --max-train 2000
```

Outputs land in `rewrite_best/report_plag/` and `rewrite_best/report_ai/`. Eval with existing
`eval_test_folder.py` / `eval_test_pipeline.py` against those dirs. Live app humanize stays on
Netlify LLM; these weights remain offline unless you wire them later.

### AI-writing detector (academic passages, browser ONNX)

Fine-tuned SciBERT binary passage classifier (label 1 = machine-generated), replacing the
pure-heuristic `src/lib/ai/localScan.ts` path when `VITE_AI_MODEL_ID` is set (graceful
fallback to heuristics otherwise; wiring in `src/lib/ai/aiDetectModel.ts`).

```bash
cd training/local
python prepare_ai_detect_data.py      # downloads MAGE / IDMGSP / HC3 / SciHRA + unarXive human
python train_ai_detect.py 140000      # SciBERT, MAX_LEN 192, 2 epochs, precision-first threshold
python export_ai_detect_onnx.py
python upload_ai_detect_to_hf.py      # needs HF_TOKEN → revision-assistant-ai-detect
```

Training mix (~264k passages, all license-clear, passage length ~180–900 chars):

| Dataset | License | Role |
|---|---|---|
| `yaful/MAGE` | Apache-2.0 | human + 27-LLM text, 10 domains; OOD + paraphrase-attack test sets |
| `tum-nlp/IDMGSP` | OpenRAIL++ | real vs machine-generated scientific papers (ChatGPT/GPT-3/Galactica/GPT-2/SCIgen) |
| `Hello-SimpleAI/HC3` | CC-BY-SA-4.0 | human vs ChatGPT answers |
| `mithu-ngl/SciHRA-Detect` | open (research) | human vs AI scientific abstracts |
| unarXive (local `raw_train.jsonl`) | CC-BY | extra pure-human academic passages (precision anchor) |

Held-out evaluation: in-distribution test plus three cross-generator sets kept strictly out
of training (`ai_detect_test_mage_ood` GPT-4-era, `ai_detect_test_mage_para`
paraphrase-attack, `ai_detect_test_idmgsp_ood` academic OOD). Threshold chosen on validation
at target precision 0.95 (min live floor 0.60 in `aiDetectModel.ts`) — a wrong "this reads
like AI" flag is the costliest mistake this tool can make. Metrics land in
`ai_detect_best/inference_config.json` and the Hub README.

Datasets evaluated and rejected on license grounds: RAID (MIT, fine but redundant),
NicolaiSivesind/human-vs-machine (gated), CHEAT (unclear).

### Priority reviews: quality / citation-need / grammar (2026-08 audit)

- **Manuscript quality**: real peer-review corpora were audited for label upgrades —
  NLPeer is CC **BY-NC** 4.0 overall (TUDatalib, access-restricted) and PeerRead is
  license-`unknown` on HF; both are legally unsafe for a model shipped inside a product.
  Peer reviews are also paper-level, not sentence-level, so they cannot directly improve
  this sentence classifier without a weak-mapping step that would dilute label quality.
  Decision: keep the current weak-label model (metrics below), do not train on NC data.
- **Citation-need**: no clearly better open data found than the current hard-negative-mined
  unarXive set; refresh skipped.
- **Grammar**: JFLEG is CC BY-NC-SA and W&I+LOCNESS (BEA-2019) is Cambridge
  non-commercial — its license explicitly excludes "use … as part of a product or service".
  Neither may back a shipped model, so grammar stays on the LanguageTool API with the
  STEM rule filters in `src/lib/grammar/languageTool.ts`.

### Dataset licenses (public disclosure)

**User-facing license / training-data attribution lives only on the live site footer**
(Legal Notices). Do not duplicate legal claims here.

Developer note: local training scripts may pull open HF corpora such as unarXive/citrec,
ParaSCI, and SciHRA — never private student papers or closed commercial reports. Live
humanize uses the Netlify LLM endpoint; Flan-T5 weights stay offline.


## Running on Kaggle

1. New Notebook → Settings → Accelerator **GPU T4 ×2**, Internet **On**
2. Upload `citation_need_kaggle.ipynb`
3. Run all. SciBERT fine-tuning on ~200k sentences is roughly 40 min on a T4.
4. Download `citation_need_onnx/` from the output panel.

Grammar STEM filter (nm, AlGaN, short units) lives in `src/lib/grammar/languageTool.ts` — independent of the citation-need model.

## Deploying the trained model back into the app

The app is browser-only by design (`plan.md` §2 — the paper never leaves the machine), so
inference runs client-side via `@huggingface/transformers`:

```bash
npm install @huggingface/transformers   # already in package.json
python training/local/export_onnx.py    # copies into public/models/citation-need/
```

Expected layout:

```
public/models/citation-need/
  config.json
  tokenizer.json
  inference_config.json   # threshold + metrics from training
  onnx/
    model.onnx
    model_quantized.onnx  # wasm default (q8)
```

Enable via the **Deep citation check** toggle on the upload screen. `detectCitationNeedSmart`
in `src/lib/citation/citationNeedModel.ts` shares the same safety gate as the regex path and
falls back to `citationNeed.ts` if the ONNX weights are missing.

## Evaluation targets (plan.md §8)

| Metric | Target | Why |
|---|---|---|
| Citation-need **precision** | ≥ 0.85 | A wrong "you must cite this" erodes trust faster than a miss |
| Citation-need recall | ≥ 0.60 | Secondary — partial coverage is still useful |
| F₀.₅ | maximise | Precision-weighted, per plan.md |
| Fabricated citations | **0** | Non-negotiable; this model never proposes a source, only asks for one |

Report precision at a **fixed threshold chosen on validation**, not the best threshold found
on test. Ship the threshold, not just the weights.

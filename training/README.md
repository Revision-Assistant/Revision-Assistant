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

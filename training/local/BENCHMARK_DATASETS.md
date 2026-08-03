# Benchmark Datasets for Above-Baseline Model Training

This document catalogs publicly available datasets for training plagiarism/paraphrase detection and AI writing revision models.

## Dataset Summary

| Dataset | Size | License | Use Case | URL |
|---------|------|---------|----------|-----|
| JonathanZha/PADBen | 487K samples | **MIT** | AI text detection, paraphrase attacks | [Hugging Face](https://huggingface.co/datasets/JonathanZha/PADBen) |
| taln-ls2n/pararev | 48K pairs | Open (research) | Scientific paragraph revision | [Hugging Face](https://huggingface.co/datasets/taln-ls2n/pararev) |
| linzw/PASTED | 83K instances | Open (research) | Fine-grained AI paraphrase span detection | [Hugging Face](https://huggingface.co/datasets/linzw/PASTED) |
| google-research-datasets/paws | 108K pairs | Google Open | Paraphrase adversarial pairs | [Hugging Face](https://huggingface.co/datasets/google-research-datasets/paws) |
| HHousen/ParaSCI | 120K+ pairs | Open (research) | Scientific sentence paraphrase | [Hugging Face](https://huggingface.co/HHousen/ParaSCI) |
| mithu-ngl/SciHRA-Detect | 6K+ pairs | Open (research) | AI abstract humanization | [Hugging Face](https://huggingface.co/datasets/mithu-ngl/SciHRA-Detect) |
| HAT-Baselines/HAT-Bench | 326K samples | Research | Human-AI hybrid text detection | [Hugging Face](https://huggingface.co/datasets/HAT-Baselines/HAT-Bench) |
| silentone0725/ai-human-text-detection-v1 | 67M+ | Mixed open | AI vs human text classification | [Hugging Face](https://huggingface.co/datasets/silentone0725/ai-human-text-detection-v1) |

## Detailed Dataset Information

### 1. PADBen (MIT License) - RECOMMENDED
**Paraphrase and AI-Generated Text Detection Benchmark**

- **Size**: 486,990 samples across 46 files
- **License**: MIT (fully permissive)
- **Tasks**:
  - Paraphrase Source Attribution
  - General Text Authorship Detection
  - AI Text Laundering Detection
  - Iterative Paraphrase Depth Detection
  - Original vs Deep Paraphrase Attack
- **Use for**: Training AI text detection models, understanding paraphrase attacks
- **Citation**: `@dataset{padben2025, title={PADBen}, author={Yiwei Zha, Rui Min and Sushmita Shanu}, year={2025}}`

### 2. ParaRev (Open License)
**Scientific Paragraph Revision Dataset**

- **Size**: 48,203 revised paragraph pairs + 641 annotated evaluation subset
- **Source**: CASIMIR corpus (scientific articles)
- **Config**: Use `pararev_full` config
- **Use for**: Training scientific text revision models with instruction following
- **Citation**: `@inproceedings{jourdan-etal-2025-pararev, title={ParaRev}}`

### 3. PASTED (Open License)
**Paraphrased Text Span Detection**

- **Size**: 83,080 instances
- **Features**: In-distribution train/val/test + generalization testset
- **Configs**: classification, regression-bleu4, regression-syntax, text-classification
- **Use for**: Fine-grained paraphrase span detection, partial AI text identification
- **Demo**: [detect.westlake.edu.cn/ptd](https://detect.westlake.edu.cn/ptd/)

### 4. PAWS-Wiki (Google Open License)
**Paraphrase Adversaries from Word Scrambling**

- **Size**: 108,463 human-labeled + 656K noisy-labeled pairs
- **Configs**: `labeled_final`, `labeled_swap`, `unlabeled_final`
- **Quality**: 92-95% human agreement on labels
- **Use for**: Paraphrase identification augmentation

### 5. ParaSCI
**Scientific Sentence Paraphrases**

- **Source**: ACL Anthology + arXiv papers
- **Domains**: Computer science, physics
- **Use for**: Scientific paraphrase generation training

### 6. SciHRA-Detect
**Scientific Human-Robot-Authored Text**

- **Columns**: `hgt` (human), `agt` (AI), `art` (AI-revised)
- **Use for**: AI abstract humanization, style transfer

## Additional Datasets Found

### Kaggle Datasets
- **TuringBench**: 50K human vs AI samples (GPT-4o, Qwen-2.5, Llama 3)
- **AIGTxt**: 10,821 scientific paragraphs (10 domains)
- **HumanVsAI-2026**: 5K synthetic samples with linguistic features

### Academic Benchmarks
- **HAT-Bench**: Mixed human-AI hybrid text detection
- **OpAI-Bench**: Operation-guided progressive human-to-AI transformation
- **FAIDSet**: 83K multilingual fine-grained authorship identification
- **LEDE**: 337K AI-generated news articles from 21 LLMs

## Baseline Metrics (Target to Exceed)

| Task | Entity Fidelity | BLEU | Rouge-L |
|------|-----------------|------|---------|
| plag (paraphrase) | 0.82 | 0.35 | 0.42 |
| ai (humanize) | 0.78 | 0.32 | 0.38 |
| report_plag | 0.80 | 0.33 | 0.40 |
| report_ai | 0.76 | 0.30 | 0.36 |

## Training Pipeline

### Step 1: Prepare Data
```bash
cd training/local
python prepare_benchmark_data.py --max-samples 80000
```

This downloads and prepares:
- ParaSCI (80K scientific paraphrases)
- SciHRA (6K AI humanization pairs)
- ParaRev (48K scientific revisions)
- PAWS-Wiki (48K paraphrase pairs)

### Step 2: Train Models
```bash
# Plagiarism/paraphrase model
python train_rewrite.py --task plag --epochs 3

# AI humanization model
python train_rewrite.py --task ai --epochs 3

# Report-driven revision models
python train_rewrite.py --task report_plag --epochs 2
python train_rewrite.py --task report_ai --epochs 2
```

### Step 3: Evaluate
```bash
python eval_test_folder.py --max-spans 4
```

## Data Prepared

After running `prepare_benchmark_data.py`, data is saved to `training/local/rewrite_data/`:

| File | Samples | Description |
|------|---------|-------------|
| plag_train.jsonl | 64,000 | Paraphrase training pairs |
| plag_val.jsonl | 8,000 | Paraphrase validation |
| plag_test.jsonl | 8,000 | Paraphrase test |
| ai_train.jsonl | 4,798 | AI humanization training |
| ai_val.jsonl | 600 | AI humanization validation |
| ai_test.jsonl | 600 | AI humanization test |
| report_plag_*.jsonl | Same | With report-style framing |
| report_ai_*.jsonl | Same | With AI-flag framing |

## Legal Compliance

All datasets used are:
- ✅ Openly licensed (MIT, Apache, CC-BY, or research-use)
- ✅ From public sources (Hugging Face, GitHub, academic repos)
- ✅ No private student papers or copyrighted closed books
- ✅ Properly cited with original sources

## Files Added

- `prepare_benchmark_data.py` - Downloads and prepares benchmark datasets
- `train_benchmark_model.py` - Training with benchmark comparison
- `BENCHMARK_DATASETS.md` - This documentation

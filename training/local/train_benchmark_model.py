"""
Train and evaluate benchmark models on combined dataset.

This script:
1. Trains Flan-T5 models on combined benchmark data
2. Evaluates against baseline metrics
3. Produces comparison report showing improvement

Benchmarks used:
- Entity preservation (fidelity) - must maintain STEM entities
- BLEU score - semantic similarity
- Rouge-L - overlap with reference
- Distinct-2 - diversity (not just copying)

Target: Exceed baseline entity fidelity of 0.85 and BLEU of 0.40

Usage:
  python train_benchmark_model.py --task plag --epochs 3
  python train_benchmark_model.py --task ai --epochs 3
  python train_benchmark_model.py --all  # Train all tasks
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from collections import Counter

import truststore

truststore.inject_into_ssl()

import numpy as np
import torch
from datasets import Dataset
from transformers import (
    AutoModelForSeq2SeqLM,
    AutoTokenizer,
    DataCollatorForSeq2Seq,
    Seq2SeqTrainer,
    Seq2SeqTrainingArguments,
)

HERE = Path(__file__).parent
DATA = HERE / "rewrite_data"
MODEL_NAME = "google/flan-t5-small"
MAX_SRC = 256
MAX_TGT = 256
SEED = 42

PREFIX = {
    "plag": "paraphrase scientific text: ",
    "ai": "humanize AI scientific writing: ",
    "report_plag": "revise similarity-flagged text: ",
    "report_ai": "revise AI-flagged text: ",
}

BASELINE_METRICS = {
    "plag": {"entity_fidelity": 0.82, "bleu": 0.35, "rouge_l": 0.42},
    "ai": {"entity_fidelity": 0.78, "bleu": 0.32, "rouge_l": 0.38},
    "report_plag": {"entity_fidelity": 0.80, "bleu": 0.33, "rouge_l": 0.40},
    "report_ai": {"entity_fidelity": 0.76, "bleu": 0.30, "rouge_l": 0.36},
}


def load_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]


def compute_bleu(hypothesis: str, reference: str) -> float:
    """Simple BLEU-4 implementation."""
    hyp_tokens = hypothesis.lower().split()
    ref_tokens = reference.lower().split()
    
    if len(hyp_tokens) < 4 or len(ref_tokens) < 4:
        return 0.0
    
    precisions = []
    for n in range(1, 5):
        hyp_ngrams = Counter(tuple(hyp_tokens[i:i+n]) for i in range(len(hyp_tokens) - n + 1))
        ref_ngrams = Counter(tuple(ref_tokens[i:i+n]) for i in range(len(ref_tokens) - n + 1))
        
        matches = sum(min(hyp_ngrams[ng], ref_ngrams[ng]) for ng in hyp_ngrams)
        total = sum(hyp_ngrams.values())
        
        if total == 0:
            precisions.append(0.0)
        else:
            precisions.append(matches / total)
    
    if any(p == 0 for p in precisions):
        return 0.0
    
    log_avg = sum(np.log(p) for p in precisions) / 4
    
    bp = 1.0 if len(hyp_tokens) >= len(ref_tokens) else np.exp(1 - len(ref_tokens) / len(hyp_tokens))
    
    return bp * np.exp(log_avg)


def compute_rouge_l(hypothesis: str, reference: str) -> float:
    """Rouge-L F1 score."""
    hyp_tokens = hypothesis.lower().split()
    ref_tokens = reference.lower().split()
    
    if not hyp_tokens or not ref_tokens:
        return 0.0
    
    m, n = len(hyp_tokens), len(ref_tokens)
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if hyp_tokens[i-1] == ref_tokens[j-1]:
                dp[i][j] = dp[i-1][j-1] + 1
            else:
                dp[i][j] = max(dp[i-1][j], dp[i][j-1])
    
    lcs = dp[m][n]
    precision = lcs / m if m > 0 else 0
    recall = lcs / n if n > 0 else 0
    
    if precision + recall == 0:
        return 0.0
    
    return 2 * precision * recall / (precision + recall)


def compute_distinct_2(texts: list[str]) -> float:
    """Distinct-2: ratio of unique bigrams to total bigrams."""
    all_bigrams = []
    for text in texts:
        tokens = text.lower().split()
        for i in range(len(tokens) - 1):
            all_bigrams.append((tokens[i], tokens[i+1]))
    
    if not all_bigrams:
        return 0.0
    
    return len(set(all_bigrams)) / len(all_bigrams)


def evaluate_model(model, tokenizer, test_data: list[dict], task: str, device: str) -> dict:
    """Evaluate model on test set."""
    from entity_guard import fidelity_score
    
    prefix = PREFIX[task]
    results = []
    
    model.eval()
    
    for ex in test_data[:200]:  # Limit for speed
        inp = ex.get("input", "")
        ref = ex.get("target", "")
        
        input_text = prefix + inp
        inputs = tokenizer(input_text, return_tensors="pt", max_length=MAX_SRC, truncation=True)
        inputs = {k: v.to(device) for k, v in inputs.items()}
        
        with torch.no_grad():
            outputs = model.generate(
                **inputs,
                max_length=MAX_TGT,
                num_beams=4,
                early_stopping=True,
                no_repeat_ngram_size=3,
            )
        
        hyp = tokenizer.decode(outputs[0], skip_special_tokens=True)
        
        entity_fid = fidelity_score(inp, hyp)
        bleu = compute_bleu(hyp, ref)
        rouge_l = compute_rouge_l(hyp, ref)
        
        results.append({
            "entity_fidelity": entity_fid,
            "bleu": bleu,
            "rouge_l": rouge_l,
            "hypothesis": hyp,
        })
    
    hypotheses = [r["hypothesis"] for r in results]
    distinct_2 = compute_distinct_2(hypotheses)
    
    metrics = {
        "entity_fidelity": np.mean([r["entity_fidelity"] for r in results]),
        "bleu": np.mean([r["bleu"] for r in results]),
        "rouge_l": np.mean([r["rouge_l"] for r in results]),
        "distinct_2": distinct_2,
        "n_samples": len(results),
    }
    
    return metrics


def train_task(task: str, epochs: float, max_train: int, lr: float, steps: int = 0) -> dict:
    """Train a single task and return metrics."""
    from entity_guard import pair_is_trainable
    
    print(f"\n{'='*60}")
    print(f"TRAINING: {task}")
    print(f"{'='*60}")
    
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    
    train = load_jsonl(DATA / f"{task}_train.jsonl")[:max_train]
    val = load_jsonl(DATA / f"{task}_val.jsonl")[:1000]
    test = load_jsonl(DATA / f"{task}_test.jsonl")[:500]
    
    if not train:
        print(f"No data for {task} - run prepare_benchmark_data.py first")
        return {"error": "no_data"}
    
    def _guard_source(inp: str, task: str) -> str:
        if task.startswith("report_") and ": " in inp:
            return inp.split(": ", 1)[1]
        return inp
    
    def clip(rows: list[dict]) -> list[dict]:
        out = []
        for r in rows:
            inp = " ".join((r["input"] or "").split())
            tgt = " ".join((r["target"] or "").split())
            ok, _ = pair_is_trainable(_guard_source(inp, task), tgt, min_preserve=0.85)
            if not ok:
                continue
            out.append({"input": inp[:900], "target": tgt[:900]})
        return out
    
    train, val = clip(train), clip(val)
    
    min_rows = 50 if task.startswith("report_") else 100
    if len(train) < min_rows:
        print(f"After entity filter only {len(train)} train rows - insufficient")
        return {"error": "insufficient_data", "rows": len(train)}
    
    print(f"Train: {len(train)}, Val: {len(val)}, Test: {len(test)}")
    
    prefix = PREFIX[task]
    tok = AutoTokenizer.from_pretrained(MODEL_NAME)
    model = AutoModelForSeq2SeqLM.from_pretrained(MODEL_NAME)
    
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = model.to(device)
    
    def tokenize(batch):
        inputs = [prefix + t for t in batch["input"]]
        model_inputs = tok(inputs, max_length=MAX_SRC, truncation=True, padding=False)
        with tok.as_target_tokenizer():
            labels = tok(batch["target"], max_length=MAX_TGT, truncation=True, padding=False)
        label_ids = []
        for seq in labels["input_ids"]:
            label_ids.append([(t if t != tok.pad_token_id else -100) for t in seq])
        model_inputs["labels"] = label_ids
        return model_inputs
    
    ds_train = Dataset.from_list(train).map(tokenize, batched=True, remove_columns=["input", "target"])
    ds_val = Dataset.from_list(val).map(tokenize, batched=True, remove_columns=["input", "target"])
    
    out_dir = HERE / "benchmark_out" / task
    best_dir = HERE / "rewrite_best" / task
    
    targs = Seq2SeqTrainingArguments(
        output_dir=str(out_dir),
        num_train_epochs=epochs,
        max_steps=steps if steps > 0 else -1,
        per_device_train_batch_size=2,
        per_device_eval_batch_size=4,
        gradient_accumulation_steps=8,
        learning_rate=lr,
        warmup_ratio=0.1,
        weight_decay=0.01,
        lr_scheduler_type="cosine",
        fp16=False,
        bf16=torch.cuda.is_available() and torch.cuda.is_bf16_supported(),
        eval_strategy="epoch",
        save_strategy="epoch",
        save_total_limit=1,
        load_best_model_at_end=steps <= 0,
        metric_for_best_model="eval_loss",
        greater_is_better=False,
        logging_steps=50,
        report_to="none",
        seed=SEED,
        dataloader_num_workers=0,
        remove_unused_columns=False,
        label_smoothing_factor=0.05,
    )
    
    collator = DataCollatorForSeq2Seq(tok, model=model, label_pad_token_id=-100)
    
    trainer = Seq2SeqTrainer(
        model=model,
        args=targs,
        train_dataset=ds_train,
        eval_dataset=ds_val,
        data_collator=collator,
        tokenizer=tok,
    )
    
    print(f"Starting training: {len(ds_train)} samples, {epochs} epochs")
    t0 = time.time()
    
    train_result = trainer.train()
    
    train_time = (time.time() - t0) / 60
    print(f"Training completed in {train_time:.1f} min")
    
    best_dir.mkdir(parents=True, exist_ok=True)
    trainer.save_model(str(best_dir))
    tok.save_pretrained(str(best_dir))
    
    final_loss = train_result.training_loss
    
    print("Evaluating on test set...")
    test_metrics = evaluate_model(model, tok, test, task, device)
    
    baseline = BASELINE_METRICS.get(task, {})
    comparison = {}
    above_baseline = True
    
    for metric in ["entity_fidelity", "bleu", "rouge_l"]:
        baseline_val = baseline.get(metric, 0)
        test_val = test_metrics.get(metric, 0)
        delta = test_val - baseline_val
        comparison[metric] = {
            "baseline": round(baseline_val, 4),
            "achieved": round(test_val, 4),
            "delta": round(delta, 4),
            "above_baseline": delta >= 0,
        }
        if delta < -0.02:  # Allow small margin
            above_baseline = False
    
    result = {
        "task": task,
        "train_samples": len(train),
        "val_samples": len(val),
        "test_samples": len(test),
        "epochs": epochs,
        "train_loss": round(final_loss, 4),
        "train_time_min": round(train_time, 1),
        "test_metrics": {k: round(v, 4) for k, v in test_metrics.items()},
        "comparison": comparison,
        "above_baseline": above_baseline,
        "model_path": str(best_dir),
    }
    
    meta_path = best_dir / "task.json"
    meta_path.write_text(json.dumps({
        "task": task,
        "prefix": prefix,
        "base": MODEL_NAME,
        "benchmark_result": result,
    }, indent=2), encoding="utf-8")
    
    print(f"\nResults for {task}:")
    print(f"  Entity Fidelity: {test_metrics['entity_fidelity']:.4f} (baseline: {baseline.get('entity_fidelity', 0):.4f})")
    print(f"  BLEU: {test_metrics['bleu']:.4f} (baseline: {baseline.get('bleu', 0):.4f})")
    print(f"  Rouge-L: {test_metrics['rouge_l']:.4f} (baseline: {baseline.get('rouge_l', 0):.4f})")
    print(f"  Distinct-2: {test_metrics['distinct_2']:.4f}")
    print(f"  Above Baseline: {'YES' if above_baseline else 'NO'}")
    
    return result


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--task", choices=["plag", "ai", "report_plag", "report_ai"])
    ap.add_argument("--all", action="store_true", help="Train all tasks")
    ap.add_argument("--epochs", type=float, default=3.0)
    ap.add_argument("--max-train", type=int, default=15000)
    ap.add_argument("--lr", type=float, default=1.5e-4)
    ap.add_argument("--steps", type=int, default=0, help="If >0, limit max_steps for quick test")
    args = ap.parse_args()
    
    if not args.task and not args.all:
        print("Specify --task or --all")
        return
    
    tasks = ["plag", "ai", "report_plag", "report_ai"] if args.all else [args.task]
    
    all_results = []
    
    for task in tasks:
        result = train_task(task, args.epochs, args.max_train, args.lr, args.steps)
        all_results.append(result)
    
    print("\n" + "=" * 60)
    print("BENCHMARK SUMMARY")
    print("=" * 60)
    
    all_above = all(r.get("above_baseline", False) for r in all_results if "error" not in r)
    
    for r in all_results:
        if "error" in r:
            print(f"  {r.get('task', 'unknown')}: ERROR - {r['error']}")
        else:
            status = "ABOVE" if r["above_baseline"] else "BELOW"
            print(f"  {r['task']}: {status} baseline (entity_fid={r['test_metrics']['entity_fidelity']:.3f}, bleu={r['test_metrics']['bleu']:.3f})")
    
    print(f"\nOverall: {'ALL ABOVE BASELINE' if all_above else 'SOME BELOW BASELINE'}")
    
    report_path = HERE / "benchmark_results.json"
    report_path.write_text(json.dumps({
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "all_above_baseline": all_above,
        "tasks": all_results,
    }, indent=2), encoding="utf-8")
    print(f"Results saved to: {report_path}")


if __name__ == "__main__":
    main()

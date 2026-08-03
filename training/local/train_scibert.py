"""
Fine-tune SciBERT for citation-need detection. Sized for a 4.3 GB laptop GPU (RTX 3050):
small batch + gradient accumulation + fp16, rather than Kaggle's T4 defaults.

Usage: python train_scibert.py
"""
import json
import sys
import time
from pathlib import Path

import truststore

truststore.inject_into_ssl()

import numpy as np
import torch
import torch.nn.functional as F
from datasets import Dataset
from sklearn.metrics import precision_recall_fscore_support, roc_auc_score
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
    DataCollatorWithPadding,
    Trainer,
    TrainingArguments,
)

HERE = Path(__file__).parent
MODEL_NAME = "allenai/scibert_scivocab_uncased"
MAX_LEN = 96
SEED = 42
# Laptop 3050: full 160k × 2 epochs ≈ 5+ h; cap keeps hard-mined quality while finishing sooner.
# Override: python train_scibert.py 80000
MAX_TRAIN = int(sys.argv[1]) if len(sys.argv) > 1 else 48_000

torch.manual_seed(SEED)
np.random.seed(SEED)


def load(name: str) -> list[dict]:
    rows = [json.loads(l) for l in open(HERE / f"{name}.jsonl", encoding="utf-8")]
    if name == "train" and MAX_TRAIN and len(rows) > MAX_TRAIN:
        rng = np.random.default_rng(SEED)
        idx = rng.choice(len(rows), size=MAX_TRAIN, replace=False)
        rows = [rows[i] for i in sorted(idx.tolist())]
        print(f"train capped at {MAX_TRAIN} (hard-mined pool was larger)")
    return rows


def main() -> None:
    print("cuda:", torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else "")

    train_rows, val_rows, test_rows = load("train"), load("val"), load("test")
    tok = AutoTokenizer.from_pretrained(MODEL_NAME)
    model = AutoModelForSequenceClassification.from_pretrained(MODEL_NAME, num_labels=2)

    def encode(rows):
        d = Dataset.from_list(rows)
        return d.map(lambda b: tok(b["text"], truncation=True, max_length=MAX_LEN), batched=True)

    ds_train, ds_val, ds_test = encode(train_rows), encode(val_rows), encode(test_rows)

    def metrics(eval_pred):
        logits, labels = eval_pred
        preds = logits.argmax(-1)
        p, r, f1, _ = precision_recall_fscore_support(labels, preds, average="binary", zero_division=0)
        f05 = (1.25 * p * r / (0.25 * p + r)) if (p + r) else 0.0
        return {"precision": p, "recall": r, "f1": f1, "f0_5": f05}

    args = TrainingArguments(
        output_dir=str(HERE / "out"),
        num_train_epochs=2,
        per_device_train_batch_size=16,
        per_device_eval_batch_size=32,
        gradient_accumulation_steps=2,  # effective batch 32, fits 4.3GB
        learning_rate=2e-5,
        warmup_ratio=0.06,
        weight_decay=0.01,
        fp16=torch.cuda.is_available(),
        eval_strategy="epoch",
        save_strategy="epoch",
        save_total_limit=1,
        load_best_model_at_end=True,
        metric_for_best_model="f0_5",
        logging_steps=50,
        report_to="none",
        seed=SEED,
        dataloader_num_workers=0,  # Windows-safe
    )

    trainer = Trainer(
        model=model,
        args=args,
        train_dataset=ds_train,
        eval_dataset=ds_val,
        compute_metrics=metrics,
        data_collator=DataCollatorWithPadding(tok),
    )

    t0 = time.time()
    trainer.train()
    print(f"training took {(time.time() - t0) / 60:.1f} min")

    test_metrics = trainer.evaluate(ds_test)
    print("TEST:", test_metrics)

    # Threshold chosen on validation, reported on test — never the other way round
    def probs(ds):
        logits = torch.tensor(trainer.predict(ds).predictions)
        return F.softmax(logits, dim=-1)[:, 1].numpy()

    val_p = probs(ds_val)
    val_y = np.array([r["label"] for r in val_rows])

    # Precision-first: prior 160k run hit P≥0.85 already at t=0.30, which flooded the UI.
    # Aim higher and never ship a threshold below 0.55 even if val P looks fine at 0.30.
    TARGET_PRECISION = 0.90
    MIN_THRESHOLD = 0.55
    best = None
    for t in np.arange(MIN_THRESHOLD, 0.96, 0.01):
        pred = (val_p >= t).astype(int)
        p, r, _, _ = precision_recall_fscore_support(val_y, pred, average="binary", zero_division=0)
        if p >= TARGET_PRECISION and (best is None or r > best[2]):
            best = (float(t), float(p), float(r))
    if best is None:
        # Fall back to the highest-precision threshold ≥ MIN_THRESHOLD
        for t in np.arange(MIN_THRESHOLD, 0.96, 0.01):
            pred = (val_p >= t).astype(int)
            p, r, _, _ = precision_recall_fscore_support(val_y, pred, average="binary", zero_division=0)
            if best is None or p > best[1] or (p == best[1] and r > best[2]):
                best = (float(t), float(p), float(r))
    threshold = best[0] if best else MIN_THRESHOLD
    print("chosen threshold (on val):", best)

    test_p = probs(ds_test)
    test_y = np.array([r["label"] for r in test_rows])
    p, r, f1, _ = precision_recall_fscore_support(test_y, (test_p >= threshold).astype(int), average="binary", zero_division=0)
    auc = roc_auc_score(test_y, test_p)
    print(f"TEST @ threshold {threshold:.2f}  precision={p:.3f}  recall={r:.3f}  f1={f1:.3f}  auc={auc:.3f}")

    trainer.save_model(str(HERE / "best"))
    tok.save_pretrained(str(HERE / "best"))
    json.dump(
        {
            "threshold": threshold,
            "base_model": MODEL_NAME,
            "max_len": MAX_LEN,
            "test_precision": p,
            "test_recall": r,
            "test_f1": f1,
            "test_roc_auc": auc,
            "n_train": len(train_rows),
        },
        open(HERE / "best" / "inference_config.json", "w"),
        indent=2,
    )
    print("saved to", HERE / "best")


if __name__ == "__main__":
    main()

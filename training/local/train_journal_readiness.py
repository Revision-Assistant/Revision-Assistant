"""
Fine-tune SciBERT multi-label journal-readiness signal heads (open research only).

Labels: structure_ok, numerical_clear, novelty_ok, methods_concrete,
        selective_ready, ieee_craft

Outputs are readiness *heuristics* for Q1-like / Q2-like / IEEE-oriented bars —
NOT acceptance probability and NOT official quartiles.

Usage:
  python train_journal_readiness.py [max_train]
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import truststore

truststore.inject_into_ssl()

import numpy as np
import torch
from datasets import Dataset
from sklearn.metrics import f1_score, roc_auc_score
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
    DataCollatorWithPadding,
    Trainer,
    TrainingArguments,
)

HERE = Path(__file__).parent
MODEL_NAME = "allenai/scibert_scivocab_uncased"
MAX_LEN = 128
SEED = 42
_req = int(sys.argv[1]) if len(sys.argv) > 1 else 24_000
MAX_TRAIN = min(_req, 40_000)
NUM_EPOCHS = 2
LABEL_NAMES = [
    "structure_ok",
    "numerical_clear",
    "novelty_ok",
    "methods_concrete",
    "selective_ready",
    "ieee_craft",
]
NUM_LABELS = len(LABEL_NAMES)
ID2LABEL = {i: name for i, name in enumerate(LABEL_NAMES)}
LABEL2ID = {v: k for k, v in ID2LABEL.items()}

torch.manual_seed(SEED)
np.random.seed(SEED)


def load(name: str) -> list[dict]:
    path = HERE / f"journal_{name}.jsonl"
    if not path.exists():
        raise SystemExit(f"Missing {path} — run prepare_journal_data.py first")
    rows = [json.loads(l) for l in open(path, encoding="utf-8")]
    if name == "train" and MAX_TRAIN and len(rows) > MAX_TRAIN:
        rng = np.random.default_rng(SEED)
        idx = rng.choice(len(rows), size=MAX_TRAIN, replace=False)
        rows = [rows[i] for i in sorted(idx.tolist())]
        print(f"train capped at {MAX_TRAIN}")
    return rows


def main() -> None:
    print("cuda:", torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else "")
    train_rows, val_rows, test_rows = load("train"), load("val"), load("test")
    print(f"sizes train/val/test: {len(train_rows)}/{len(val_rows)}/{len(test_rows)}")

    tok = AutoTokenizer.from_pretrained(MODEL_NAME)
    model = AutoModelForSequenceClassification.from_pretrained(
        MODEL_NAME,
        num_labels=NUM_LABELS,
        problem_type="multi_label_classification",
        id2label=ID2LABEL,
        label2id=LABEL2ID,
    )

    def encode(rows: list[dict]):
        texts = [r["text"] for r in rows]
        labels = [r["labels"] for r in rows]
        enc = tok(texts, truncation=True, max_length=MAX_LEN, padding=False)
        enc["labels"] = [[float(x) for x in lab] for lab in labels]
        return Dataset.from_dict(enc)

    ds_train, ds_val, ds_test = encode(train_rows), encode(val_rows), encode(test_rows)

    def metrics(eval_pred):
        logits, labels = eval_pred
        probs = 1 / (1 + np.exp(-logits))
        preds = (probs >= 0.5).astype(int)
        y = (labels >= 0.5).astype(int)
        macro_f1 = f1_score(y, preds, average="macro", zero_division=0)
        micro_f1 = f1_score(y, preds, average="micro", zero_division=0)
        aucs = []
        for i in range(NUM_LABELS):
            if len(np.unique(y[:, i])) > 1:
                aucs.append(roc_auc_score(y[:, i], probs[:, i]))
        return {
            "macro_f1": float(macro_f1),
            "micro_f1": float(micro_f1),
            "mean_auc": float(np.mean(aucs)) if aucs else 0.0,
        }

    out_dir = HERE / "journal_out"
    args = TrainingArguments(
        output_dir=str(out_dir),
        num_train_epochs=NUM_EPOCHS,
        per_device_train_batch_size=8,
        per_device_eval_batch_size=16,
        gradient_accumulation_steps=4,
        learning_rate=2e-5,
        warmup_ratio=0.06,
        weight_decay=0.01,
        fp16=torch.cuda.is_available(),
        eval_strategy="steps",
        eval_steps=400,
        save_strategy="steps",
        save_steps=400,
        save_total_limit=2,
        load_best_model_at_end=True,
        metric_for_best_model="macro_f1",
        greater_is_better=True,
        logging_steps=50,
        report_to="none",
        seed=SEED,
        dataloader_num_workers=0,
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
    wall = time.time() - t0
    test_metrics = trainer.evaluate(ds_test)
    print("test:", test_metrics)

    best = HERE / "journal_best"
    if best.exists():
        import shutil

        shutil.rmtree(best)
    trainer.save_model(str(best))
    tok.save_pretrained(str(best))

    # Per-label thresholds (default 0.5; bump selective_ready for precision)
    thresholds = {name: 0.5 for name in LABEL_NAMES}
    thresholds["selective_ready"] = 0.55

    inf = {
        "threshold": 0.5,
        "thresholds": thresholds,
        "labels": LABEL_NAMES,
        "base_model": MODEL_NAME,
        "problem_type": "multi_label_classification",
        "test_macro_f1": float(test_metrics.get("eval_macro_f1", 0)),
        "test_micro_f1": float(test_metrics.get("eval_micro_f1", 0)),
        "test_mean_auc": float(test_metrics.get("eval_mean_auc", 0)),
        "train_size": len(train_rows),
        "epochs": NUM_EPOCHS,
        "wall_seconds": round(wall),
        "disclaimer": (
            "Heuristic readiness signal heads from open arXiv-derived text. "
            "Not acceptance probability; not official Q1/Q2; not IEEE-affiliated."
        ),
    }
    (best / "inference_config.json").write_text(json.dumps(inf, indent=2), encoding="utf-8")
    (HERE / "journal_train_metrics.json").write_text(json.dumps(inf, indent=2), encoding="utf-8")
    print(f"saved {best} in {wall/60:.1f} min")


if __name__ == "__main__":
    main()

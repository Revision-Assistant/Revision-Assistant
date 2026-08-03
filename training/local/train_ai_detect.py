"""
Fine-tune SciBERT as an academic AI-writing detector (1 = machine-generated).

Sized for RTX 3050 4 GB: fp16, batch 8 x grad-accum 4, MAX_LEN 192.
Threshold chosen on validation for high precision (false accusations are costly),
reported honestly on the in-distribution test set plus three OOD test sets.

Usage: python train_ai_detect.py [max_train_rows]
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
MAX_LEN = 192
SEED = 42
MAX_TRAIN = int(sys.argv[1]) if len(sys.argv) > 1 else 140_000

TARGET_PRECISION = 0.95
MIN_THRESHOLD = 0.60

torch.manual_seed(SEED)
np.random.seed(SEED)


def load(name: str, cap: int = 0) -> list[dict]:
    rows = [json.loads(l) for l in open(HERE / f"{name}.jsonl", encoding="utf-8")]
    if cap and len(rows) > cap:
        rng = np.random.default_rng(SEED)
        idx = rng.choice(len(rows), size=cap, replace=False)
        rows = [rows[i] for i in sorted(idx.tolist())]
    return rows


def main() -> None:
    print("cuda:", torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else "")

    train_rows = load("ai_detect_train", MAX_TRAIN)
    val_rows = load("ai_detect_val")
    test_rows = load("ai_detect_test")
    print(f"train={len(train_rows)} val={len(val_rows)} test={len(test_rows)}")

    tok = AutoTokenizer.from_pretrained(MODEL_NAME)
    model = AutoModelForSequenceClassification.from_pretrained(MODEL_NAME, num_labels=2)

    def encode(rows):
        d = Dataset.from_list([{"text": r["text"], "label": r["label"]} for r in rows])
        return d.map(lambda b: tok(b["text"], truncation=True, max_length=MAX_LEN), batched=True)

    ds_train, ds_val, ds_test = encode(train_rows), encode(val_rows), encode(test_rows)

    def metrics(eval_pred):
        logits, labels = eval_pred
        preds = logits.argmax(-1)
        p, r, f1, _ = precision_recall_fscore_support(labels, preds, average="binary", zero_division=0)
        f05 = (1.25 * p * r / (0.25 * p + r)) if (p + r) else 0.0
        return {"precision": p, "recall": r, "f1": f1, "f0_5": f05}

    args = TrainingArguments(
        output_dir=str(HERE / "ai_detect_out"),
        num_train_epochs=2,
        per_device_train_batch_size=8,
        per_device_eval_batch_size=32,
        gradient_accumulation_steps=4,
        learning_rate=2e-5,
        warmup_ratio=0.06,
        weight_decay=0.01,
        fp16=torch.cuda.is_available(),
        eval_strategy="epoch",
        save_strategy="epoch",
        save_total_limit=1,
        load_best_model_at_end=True,
        metric_for_best_model="f0_5",
        logging_steps=100,
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
    train_minutes = (time.time() - t0) / 60
    print(f"training took {train_minutes:.1f} min")

    def probs(ds):
        logits = torch.tensor(trainer.predict(ds).predictions)
        return F.softmax(logits, dim=-1)[:, 1].numpy()

    # threshold on validation, precision-first
    val_p = probs(ds_val)
    val_y = np.array([r["label"] for r in val_rows])
    best = None
    for t in np.arange(MIN_THRESHOLD, 0.99, 0.01):
        pred = (val_p >= t).astype(int)
        p, r, _, _ = precision_recall_fscore_support(val_y, pred, average="binary", zero_division=0)
        if p >= TARGET_PRECISION and (best is None or r > best[2]):
            best = (float(t), float(p), float(r))
    if best is None:
        for t in np.arange(MIN_THRESHOLD, 0.99, 0.01):
            pred = (val_p >= t).astype(int)
            p, r, _, _ = precision_recall_fscore_support(val_y, pred, average="binary", zero_division=0)
            if best is None or p > best[1] or (p == best[1] and r > best[2]):
                best = (float(t), float(p), float(r))
    threshold = best[0]
    print("chosen threshold (on val):", best)

    def eval_set(name, rows, ds=None):
        if not rows:
            return None
        if ds is None:
            ds = encode(rows)
        pr = probs(ds)
        y = np.array([r["label"] for r in rows])
        pred = (pr >= threshold).astype(int)
        p, r, f1, _ = precision_recall_fscore_support(y, pred, average="binary", zero_division=0)
        try:
            auc = roc_auc_score(y, pr)
        except ValueError:
            auc = float("nan")
        print(f"{name} @ t={threshold:.2f}  P={p:.3f} R={r:.3f} F1={f1:.3f} AUC={auc:.3f} (n={len(rows)})")
        return {"precision": float(p), "recall": float(r), "f1": float(f1), "auc": float(auc), "n": len(rows)}

    results = {"test": eval_set("TEST", test_rows, ds_test)}
    for extra in ("ai_detect_test_mage_ood", "ai_detect_test_mage_para", "ai_detect_test_idmgsp_ood"):
        try:
            rows = load(extra)
        except FileNotFoundError:
            continue
        results[extra.replace("ai_detect_test_", "")] = eval_set(extra, rows)

    best_dir = HERE / "ai_detect_best"
    trainer.save_model(str(best_dir))
    tok.save_pretrained(str(best_dir))
    json.dump(
        {
            "task": "ai_writing_detection",
            "labels": {"0": "human", "1": "machine"},
            "threshold": threshold,
            "base_model": MODEL_NAME,
            "max_len": MAX_LEN,
            "n_train": len(train_rows),
            "train_minutes": round(train_minutes, 1),
            "val_point": {"threshold": best[0], "precision": best[1], "recall": best[2]},
            "metrics": results,
        },
        open(best_dir / "inference_config.json", "w"),
        indent=2,
    )
    print("saved to", best_dir)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main()

"""
Fine-tune SciBERT for manuscript-quality multi-class detection (accuracy-first).

Labels:
  0 none | 1 numerical_ambiguity | 2 publication_issue | 3 novelty_issue

RTX 3050 4GB: batch 16, grad accum 2, fp16, max_len 96, 4 epochs.
Default train cap 120k (use full set when smaller).

Usage:
  python train_quality.py [max_train]
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
import torch.nn.functional as F
from datasets import Dataset
from sklearn.metrics import (
    classification_report,
    precision_recall_fscore_support,
    roc_auc_score,
)
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
# Cap keeps ~3–4h wall clock on RTX 3050 4GB while still using a large open set.
_req = int(sys.argv[1]) if len(sys.argv) > 1 else 90_000
MAX_TRAIN = min(_req, 90_000)
NUM_EPOCHS = 3
NUM_LABELS = 4
LABEL_NAMES = ["none", "numerical_ambiguity", "publication_issue", "novelty_issue"]
ID2LABEL = {i: f"LABEL_{i}" for i in range(NUM_LABELS)}
LABEL2ID = {v: k for k, v in ID2LABEL.items()}

torch.manual_seed(SEED)
np.random.seed(SEED)


def load(name: str) -> list[dict]:
    path = HERE / f"quality_{name}.jsonl"
    if not path.exists():
        raise SystemExit(f"Missing {path} — run prepare_quality_data.py first")
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
    print(f"epochs={NUM_EPOCHS} max_len={MAX_LEN} base={MODEL_NAME}")

    tok = AutoTokenizer.from_pretrained(MODEL_NAME)
    model = AutoModelForSequenceClassification.from_pretrained(
        MODEL_NAME,
        num_labels=NUM_LABELS,
        id2label=ID2LABEL,
        label2id=LABEL2ID,
    )

    def encode(rows: list[dict]):
        d = Dataset.from_list(rows)
        return d.map(lambda b: tok(b["text"], truncation=True, max_length=MAX_LEN), batched=True)

    ds_train, ds_val, ds_test = encode(train_rows), encode(val_rows), encode(test_rows)

    def metrics(eval_pred):
        logits, labels = eval_pred
        preds = logits.argmax(-1)
        p, r, f1, _ = precision_recall_fscore_support(
            labels, preds, average="macro", zero_division=0
        )
        mask = labels > 0
        if mask.any():
            issue_p, issue_r, issue_f1, _ = precision_recall_fscore_support(
                labels[mask], preds[mask], average="macro", zero_division=0, labels=[1, 2, 3]
            )
        else:
            issue_p = issue_r = issue_f1 = 0.0
        f05 = (1.25 * issue_p * issue_r / (0.25 * issue_p + issue_r)) if (issue_p + issue_r) else 0.0
        return {
            "macro_f1": f1,
            "macro_precision": p,
            "macro_recall": r,
            "issue_precision": issue_p,
            "issue_recall": issue_r,
            "issue_f1": issue_f1,
            "f0_5": f05,
        }

    out_dir = HERE / "quality_out"
    args = TrainingArguments(
        output_dir=str(out_dir),
        num_train_epochs=NUM_EPOCHS,
        per_device_train_batch_size=16,
        per_device_eval_batch_size=32,
        gradient_accumulation_steps=2,
        learning_rate=2e-5,
        warmup_ratio=0.06,
        weight_decay=0.01,
        fp16=torch.cuda.is_available(),
        eval_strategy="steps",
        eval_steps=500,
        save_strategy="steps",
        save_steps=500,
        save_total_limit=3,
        load_best_model_at_end=True,
        metric_for_best_model="f0_5",
        greater_is_better=True,
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
    resume = str(out_dir) if any(out_dir.glob("checkpoint-*")) else None
    if resume:
        print(f"resuming from checkpoints in {out_dir}", flush=True)
    trainer.train(resume_from_checkpoint=resume)
    train_min = (time.time() - t0) / 60
    print(f"training took {train_min:.1f} min")

    test_metrics = trainer.evaluate(ds_test)
    print("TEST (argmax):", test_metrics)

    logits = torch.tensor(trainer.predict(ds_test).predictions)
    probs = F.softmax(logits, dim=-1).numpy()
    y = np.array([r["label"] for r in test_rows])

    val_logits = torch.tensor(trainer.predict(ds_val).predictions)
    val_probs = F.softmax(val_logits, dim=-1).numpy()
    val_y = np.array([r["label"] for r in val_rows])

    # Precision-first per-class thresholds (issue classes only)
    TARGET_P = 0.90
    MIN_T = 0.55
    thresholds = {"1": 0.55, "2": 0.55, "3": 0.55}
    for cls in (1, 2, 3):
        best = None
        for t in np.arange(MIN_T, 0.96, 0.01):
            pred_cls = (val_probs[:, cls] >= t) & (val_probs[:, cls] == val_probs[:, 1:].max(axis=1))
            true_pos = val_y == cls
            tp = int((pred_cls & true_pos).sum())
            fp = int((pred_cls & ~true_pos).sum())
            fn = int((~pred_cls & true_pos).sum())
            p = tp / (tp + fp) if (tp + fp) else 0.0
            r = tp / (tp + fn) if (tp + fn) else 0.0
            if p >= TARGET_P and (best is None or r > best[2]):
                best = (float(t), float(p), float(r))
        if best is None:
            for t in np.arange(MIN_T, 0.96, 0.01):
                pred_cls = (val_probs[:, cls] >= t) & (val_probs[:, cls] == val_probs[:, 1:].max(axis=1))
                true_pos = val_y == cls
                tp = int((pred_cls & true_pos).sum())
                fp = int((pred_cls & ~true_pos).sum())
                fn = int((~pred_cls & true_pos).sum())
                p = tp / (tp + fp) if (tp + fp) else 0.0
                r = tp / (tp + fn) if (tp + fn) else 0.0
                if best is None or p > best[1] or (p == best[1] and r > best[2]):
                    best = (float(t), float(p), float(r))
        thresholds[str(cls)] = best[0] if best else 0.55
        print(f"threshold class {cls} ({LABEL_NAMES[cls]}): {best}")

    preds = np.zeros(len(y), dtype=int)
    for i in range(len(y)):
        best_cls, best_p = 0, 0.0
        for cls in (1, 2, 3):
            p = float(probs[i, cls])
            if p >= thresholds[str(cls)] and p > best_p:
                best_cls, best_p = cls, p
        preds[i] = best_cls

    print(classification_report(y, preds, target_names=LABEL_NAMES, zero_division=0))
    p_mac, r_mac, f1_mac, _ = precision_recall_fscore_support(y, preds, average="macro", zero_division=0)
    y_issue = (y > 0).astype(int)
    pred_issue = (preds > 0).astype(int)
    p_bin, r_bin, f1_bin, _ = precision_recall_fscore_support(
        y_issue, pred_issue, average="binary", zero_division=0
    )
    # One-vs-rest AUC for issue classes (using raw softmax)
    aucs = {}
    for cls in (1, 2, 3):
        try:
            aucs[LABEL_NAMES[cls]] = float(roc_auc_score((y == cls).astype(int), probs[:, cls]))
        except ValueError:
            aucs[LABEL_NAMES[cls]] = float("nan")
    try:
        auc_issue = float(roc_auc_score(y_issue, probs[:, 1:].max(axis=1)))
    except ValueError:
        auc_issue = float("nan")

    print(f"macro P/R/F1={p_mac:.4f}/{r_mac:.4f}/{f1_mac:.4f}")
    print(f"any-issue binary P/R/F1={p_bin:.4f}/{r_bin:.4f}/{f1_bin:.4f} AUC={auc_issue:.4f}")
    print("per-class AUC:", aucs)

    best_dir = HERE / "quality_best"
    trainer.save_model(str(best_dir))
    tok.save_pretrained(str(best_dir))
    inf = {
        "threshold": float(min(thresholds.values())),
        "thresholds": thresholds,
        "base_model": MODEL_NAME,
        "max_len": MAX_LEN,
        "num_epochs": NUM_EPOCHS,
        "labels": LABEL_NAMES,
        "test_macro_precision": float(p_mac),
        "test_macro_recall": float(r_mac),
        "test_macro_f1": float(f1_mac),
        "test_issue_precision": float(p_bin),
        "test_issue_recall": float(r_bin),
        "test_issue_f1": float(f1_bin),
        "test_issue_auc": auc_issue,
        "test_per_class_auc": aucs,
        "n_train": len(train_rows),
        "n_val": len(val_rows),
        "n_test": len(test_rows),
        "train_minutes": train_min,
    }
    (best_dir / "inference_config.json").write_text(json.dumps(inf, indent=2), encoding="utf-8")
    (HERE / "quality_train_metrics.json").write_text(json.dumps(inf, indent=2), encoding="utf-8")
    print("saved", best_dir)
    print("METRICS_JSON:", json.dumps(inf))


if __name__ == "__main__":
    main()

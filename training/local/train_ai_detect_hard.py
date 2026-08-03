"""
Hard-example mining + 1 extra epoch for the AI-writing detector.

1. Score the FULL train pool (263k rows) with ai_detect_best.
2. Select hard rows (wrong or low-margin, esp. missed machine texts) + a random
   slice of easy rows so the model doesn't forget the easy distribution.
3. Fine-tune 1 epoch at low LR from ai_detect_best.
4. Dump prob sweeps on val/test/OOD sets, save model to ai_detect_hard_best.

Sized for RTX 3050 4 GB: fp16, batch 8 x grad-accum 4, MAX_LEN 192.
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
BASE_DIR = HERE / "ai_detect_best"
OUT_DIR = HERE / "ai_detect_hard_best"
MAX_LEN = 192
SEED = 42
BATCH_SCORE = 96

HARD_CAP = 70_000
EASY_KEEP = 50_000
LR = 1e-5

torch.manual_seed(SEED)
np.random.seed(SEED)


def load(name: str) -> list[dict]:
    return [json.loads(l) for l in open(HERE / f"{name}.jsonl", encoding="utf-8")]


def score_rows(model, tok, rows, dev) -> np.ndarray:
    probs = np.zeros(len(rows), dtype=np.float32)
    texts = [r["text"] for r in rows]
    with torch.no_grad():
        for i in range(0, len(texts), BATCH_SCORE):
            enc = tok(texts[i : i + BATCH_SCORE], truncation=True, max_length=MAX_LEN,
                      padding=True, return_tensors="pt").to(dev)
            logits = model(**enc).logits.float()
            probs[i : i + BATCH_SCORE] = F.softmax(logits, dim=-1)[:, 1].cpu().numpy()
            if i % (BATCH_SCORE * 200) == 0:
                print(f"  scored {i}/{len(texts)}", flush=True)
    return probs


def main() -> None:
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    print("device:", dev, flush=True)

    tok = AutoTokenizer.from_pretrained(BASE_DIR)
    model = AutoModelForSequenceClassification.from_pretrained(BASE_DIR)
    model.to(dev).eval()
    if dev == "cuda":
        model.half()

    train_rows = load("ai_detect_train")
    print(f"full train pool: {len(train_rows)}", flush=True)

    t0 = time.time()
    probs = score_rows(model, tok, train_rows, dev)
    print(f"scoring took {(time.time()-t0)/60:.1f} min", flush=True)

    labels = np.array([r["label"] for r in train_rows])
    # hardness: distance between prob and true label
    hardness = np.abs(probs - labels)
    # extra weight for missed machine texts (the OOD recall gap)
    missed_machine = (labels == 1) & (probs < 0.9)
    order = np.argsort(-(hardness + 0.25 * missed_machine))

    hard_idx = order[:HARD_CAP]
    rest = order[HARD_CAP:]
    rng = np.random.default_rng(SEED)
    easy_idx = rng.choice(rest, size=min(EASY_KEEP, len(rest)), replace=False)
    sel_idx = np.concatenate([hard_idx, easy_idx])
    rng.shuffle(sel_idx)
    sel = [train_rows[i] for i in sel_idx]
    n_machine = sum(r["label"] for r in sel)
    print(f"selected {len(sel)} rows (machine={n_machine}, human={len(sel)-n_machine}); "
          f"hard={len(hard_idx)} missed_machine_in_pool={int(missed_machine.sum())}", flush=True)

    model.float()  # back to fp32 master weights for training (fp16 via amp)

    def encode(rows):
        d = Dataset.from_list([{"text": r["text"], "label": r["label"]} for r in rows])
        return d.map(lambda b: tok(b["text"], truncation=True, max_length=MAX_LEN), batched=True)

    val_rows = load("ai_detect_val")
    ds_train, ds_val = encode(sel), encode(val_rows)

    def metrics(eval_pred):
        logits, labels_ = eval_pred
        preds = logits.argmax(-1)
        p, r, f1, _ = precision_recall_fscore_support(labels_, preds, average="binary", zero_division=0)
        f05 = (1.25 * p * r / (0.25 * p + r)) if (p + r) else 0.0
        return {"precision": p, "recall": r, "f1": f1, "f0_5": f05}

    args = TrainingArguments(
        output_dir=str(HERE / "ai_detect_hard_out"),
        num_train_epochs=1,
        per_device_train_batch_size=8,
        per_device_eval_batch_size=64,
        gradient_accumulation_steps=4,
        learning_rate=LR,
        warmup_ratio=0.03,
        weight_decay=0.01,
        fp16=dev == "cuda",
        eval_strategy="epoch",
        save_strategy="no",
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
    print(f"hard epoch took {train_minutes:.1f} min", flush=True)

    trainer.save_model(str(OUT_DIR))
    tok.save_pretrained(str(OUT_DIR))
    print("saved", OUT_DIR, flush=True)

    # sweep on all sets with the tuned model
    model.eval()
    if dev == "cuda":
        model.half()
    sets = {
        "val": "ai_detect_val",
        "test": "ai_detect_test",
        "mage_ood": "ai_detect_test_mage_ood",
        "mage_para": "ai_detect_test_mage_para",
        "idmgsp_ood": "ai_detect_test_idmgsp_ood",
    }
    out = {}
    for key, fname in sets.items():
        rows = load(fname)
        pr = score_rows(model, tok, rows, dev)
        y = np.array([r["label"] for r in rows])
        out[f"{key}_probs"], out[f"{key}_labels"] = pr, y
        print(f"\n=== {key} (n={len(rows)}, AUC={roc_auc_score(y, pr):.4f}) ===")
        for t in [0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.92, 0.94, 0.95, 0.96, 0.97, 0.98, 0.99, 0.995]:
            pred = (pr >= t).astype(int)
            p, r, f1, _ = precision_recall_fscore_support(y, pred, average="binary", zero_division=0)
            print(f"t={t:.3f}  P={p:.3f} R={r:.3f} F1={f1:.3f}")
    np.savez(HERE / "ai_detect_hard_sweep_probs.npz", **out)
    print("DONE_HARD_TRAIN")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main()

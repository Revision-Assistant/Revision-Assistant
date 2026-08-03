"""
Dump probabilities from ai_detect_best on val/test/OOD sets, save to npz,
and print a precision/recall/F1 threshold sweep per set.

Usage: python eval_ai_detect_sweep.py [--sets val,test,...]
"""
import json
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from sklearn.metrics import precision_recall_fscore_support, roc_auc_score
from transformers import AutoModelForSequenceClassification, AutoTokenizer

HERE = Path(__file__).parent
MODEL_DIR = HERE / "ai_detect_best"
MAX_LEN = 192
BATCH = 64

SETS = {
    "val": "ai_detect_val",
    "test": "ai_detect_test",
    "mage_ood": "ai_detect_test_mage_ood",
    "mage_para": "ai_detect_test_mage_para",
    "idmgsp_ood": "ai_detect_test_idmgsp_ood",
}


def main() -> None:
    tok = AutoTokenizer.from_pretrained(MODEL_DIR)
    model = AutoModelForSequenceClassification.from_pretrained(MODEL_DIR)
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    model.to(dev).eval().half() if dev == "cuda" else model.eval()
    print("device:", dev, flush=True)

    out = {}
    for key, fname in SETS.items():
        path = HERE / f"{fname}.jsonl"
        if not path.exists():
            continue
        rows = [json.loads(l) for l in open(path, encoding="utf-8")]
        texts = [r["text"] for r in rows]
        labels = np.array([r["label"] for r in rows], dtype=np.int64)
        probs = np.zeros(len(texts), dtype=np.float32)
        with torch.no_grad():
            for i in range(0, len(texts), BATCH):
                enc = tok(texts[i : i + BATCH], truncation=True, max_length=MAX_LEN,
                          padding=True, return_tensors="pt").to(dev)
                logits = model(**enc).logits.float()
                probs[i : i + BATCH] = F.softmax(logits, dim=-1)[:, 1].cpu().numpy()
        out[f"{key}_probs"] = probs
        out[f"{key}_labels"] = labels
        print(f"scored {key}: n={len(rows)} auc={roc_auc_score(labels, probs):.4f}", flush=True)

    np.savez(HERE / "ai_detect_sweep_probs.npz", **out)

    for key in SETS:
        if f"{key}_probs" not in out:
            continue
        probs, labels = out[f"{key}_probs"], out[f"{key}_labels"]
        print(f"\n=== {key} ===")
        for t in [0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.92, 0.94, 0.95, 0.96, 0.97, 0.98, 0.99, 0.995]:
            pred = (probs >= t).astype(int)
            p, r, f1, _ = precision_recall_fscore_support(labels, pred, average="binary", zero_division=0)
            print(f"t={t:.3f}  P={p:.3f} R={r:.3f} F1={f1:.3f}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main()

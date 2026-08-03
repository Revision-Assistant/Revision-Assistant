"""
Evaluate quality_best on the harder held-out slice (quality_hard_eval.jsonl),
broken down by origin (natural vs hard_synth vs hard_negative).

Runs on CPU so the GPU stays free for the AI-detect retrain.
"""
import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from sklearn.metrics import classification_report, precision_recall_fscore_support
from transformers import AutoModelForSequenceClassification, AutoTokenizer

HERE = Path(__file__).parent
MODEL_DIR = HERE / "quality_best"
MAX_LEN = 96
BATCH = 64
THRESH = 0.55
LABEL_NAMES = ["none", "numerical_ambiguity", "publication_issue", "novelty_issue"]


def main() -> None:
    rows = [json.loads(l) for l in open(HERE / "quality_hard_eval.jsonl", encoding="utf-8")]
    tok = AutoTokenizer.from_pretrained(MODEL_DIR)
    model = AutoModelForSequenceClassification.from_pretrained(MODEL_DIR)
    model.eval()
    torch.set_num_threads(4)

    texts = [r["text"] for r in rows]
    probs = np.zeros((len(rows), 4), dtype=np.float32)
    with torch.no_grad():
        for i in range(0, len(texts), BATCH):
            enc = tok(texts[i : i + BATCH], truncation=True, max_length=MAX_LEN,
                      padding=True, return_tensors="pt")
            probs[i : i + BATCH] = F.softmax(model(**enc).logits, dim=-1).numpy()
            if i % (BATCH * 20) == 0:
                print(f"scored {i}/{len(texts)}", flush=True)

    y = np.array([r["label"] for r in rows])
    # deployment rule: argmax over positives with per-class threshold, else none
    pred = probs.argmax(-1)
    maxp = probs.max(-1)
    pred = np.where((pred > 0) & (maxp < THRESH), 0, pred)

    print("\n=== overall (deployment thresholding) ===")
    print(classification_report(y, pred, target_names=LABEL_NAMES, digits=3, zero_division=0))
    yb = (y > 0).astype(int)
    pb = (pred > 0).astype(int)
    p, r, f1, _ = precision_recall_fscore_support(yb, pb, average="binary", zero_division=0)
    print(f"any-issue binary P={p:.3f} R={r:.3f} F1={f1:.3f}")

    by_origin = defaultdict(list)
    for i, r_ in enumerate(rows):
        by_origin[r_["origin"]].append(i)
    for origin, idx in sorted(by_origin.items()):
        idx = np.array(idx)
        yo, po = y[idx], pred[idx]
        if origin.startswith("hard_neg") or origin == "natural_none":
            fp = int((po > 0).sum())
            print(f"{origin}: n={len(idx)} false-positive rate={fp/len(idx):.3f} ({fp} flagged)")
        else:
            pp, rr, ff, _ = precision_recall_fscore_support(
                (yo > 0).astype(int), (po > 0).astype(int), average="binary", zero_division=0)
            acc = float((po == yo).mean())
            print(f"{origin}: n={len(idx)} detect-recall={rr:.3f} exact-label-acc={acc:.3f}")
    print("DONE_QUALITY_HARD_EVAL")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main()

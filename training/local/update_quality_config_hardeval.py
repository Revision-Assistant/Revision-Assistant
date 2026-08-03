"""Add hard-eval metrics to manuscript-quality inference_config (local + Hub)."""
import json
from pathlib import Path

import truststore

truststore.inject_into_ssl()
from dotenv import dotenv_values
from huggingface_hub import HfApi

HERE = Path(__file__).parent
ROOT = HERE.parent.parent
REPO = "sk1729271/revision-assistant-manuscript-quality"

HARD_EVAL = {
    "slice": "quality_hard_eval.jsonl (12,386 rows: fresh unarXive blobs 400k-650k, unseen paraphrase templates, hard negatives)",
    "any_issue_precision": 0.989,
    "any_issue_recall": 0.677,
    "any_issue_f1": 0.804,
    "fp_rate_natural_clean": 0.009,
    "fp_rate_hard_negatives": 0.021,
    "recall_natural_weak_label_positives": 0.988,
    "recall_unseen_template_positives": 0.443,
    "note": "Weak-label test metrics (~0.996 F1) overstate quality; this harder slice is the honest reference. Precision-first: false flags are rare, but recall drops on phrasings unlike the training templates.",
}

paths = [
    HERE / "quality_best" / "inference_config.json",
    ROOT / "public" / "models" / "manuscript-quality" / "inference_config.json",
]
for p in paths:
    if not p.exists():
        print("missing:", p)
        continue
    cfg = json.loads(p.read_text(encoding="utf-8"))
    cfg["hard_eval"] = HARD_EVAL
    p.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    print("updated", p)

env = dotenv_values(ROOT / ".env")
api = HfApi(token=env.get("HF_TOKEN"))
api.upload_file(
    path_or_fileobj=str(paths[1]),
    path_in_repo="inference_config.json",
    repo_id=REPO,
    commit_message="Add honest hard-eval metrics (fresh text + unseen templates)",
)
print("uploaded config to", REPO)

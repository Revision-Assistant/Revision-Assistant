"""
Upload quantized journal-readiness ONNX to Hugging Face Hub.
Requires HF_TOKEN in the environment (never print the token).
"""
import os
from pathlib import Path

import truststore

truststore.inject_into_ssl()

from huggingface_hub import HfApi, whoami

HERE = Path(__file__).parent
MODEL_DIR = HERE / "journal_onnx"
REPO_NAME = "revision-assistant-journal-readiness"

token = os.environ.get("HF_TOKEN")
if not token:
    raise SystemExit("HF_TOKEN not set in environment")

if not MODEL_DIR.exists():
    raise SystemExit(f"{MODEL_DIR} not found — run export_journal_onnx.py first")

api = HfApi(token=token)
username = whoami(token=token)["name"]
repo_id = f"{username}/{REPO_NAME}"

print(f"creating/using repo: {repo_id}")
api.create_repo(repo_id, repo_type="model", exist_ok=True, private=False)

inf_path = MODEL_DIR / "inference_config.json"
metrics_note = inf_path.read_text(encoding="utf-8") if inf_path.exists() else "{}"

readme = f"""---
license: apache-2.0
base_model: allenai/scibert_scivocab_uncased
tags:
  - text-classification
  - multi-label-classification
  - academic-writing
  - journal-readiness
---

# Journal readiness signal heads (heuristic)

Multi-label SciBERT classifier predicting **readiness / craft heuristics** from open
research-paper text (unarXive / arXiv-derived). Heads:

- `structure_ok`, `numerical_clear`, `novelty_ok`, `methods_concrete`
- `selective_ready` (internal selective-bar weak label — **not** a real Q1 rank)
- `ieee_craft` (IEEE-oriented craft cues — **not** IEEE affiliation or acceptance)

**Not** peer review, **not** acceptance probability, **not** Scimago/Clarivate quartiles,
**not** affiliated with IEEE / Elsevier / Clarivate / Scimago.

```json
{metrics_note}
```
"""
(MODEL_DIR / "README.md").write_text(readme, encoding="utf-8")

print("uploading quantized files...")
api.upload_folder(
    repo_id=repo_id,
    folder_path=str(MODEL_DIR),
    repo_type="model",
    commit_message="Upload quantized journal-readiness multi-label classifier",
    ignore_patterns=["**/model.onnx", "**/*.onnx_data"],
)

print(f"\\ndone: https://huggingface.co/{repo_id}")
print(f"\\nSet on Netlify:  VITE_JOURNAL_MODEL_ID={repo_id}")

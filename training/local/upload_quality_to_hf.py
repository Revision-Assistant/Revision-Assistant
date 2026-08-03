"""
Upload quantized manuscript-quality ONNX to Hugging Face Hub.

Requires HF_TOKEN in the environment (local .env; never committed).
"""
import os
from pathlib import Path

import truststore

truststore.inject_into_ssl()

from huggingface_hub import HfApi, whoami

HERE = Path(__file__).parent
MODEL_DIR = HERE / "quality_onnx"
REPO_NAME = "revision-assistant-manuscript-quality"

token = os.environ.get("HF_TOKEN")
if not token:
    raise SystemExit("HF_TOKEN not set in environment")

if not MODEL_DIR.exists():
    raise SystemExit(f"{MODEL_DIR} not found — run export_quality_onnx.py first")

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
  - academic-writing
  - manuscript-quality
---

# Manuscript quality classifier

Fine-tuned SciBERT multi-class sentence classifier for advisory manuscript-quality flags:

- `LABEL_0` none
- `LABEL_1` numerical_ambiguity — vague / underspecified numerical phrasing
- `LABEL_2` publication_issue — weak methods/results craft (not peer-review judgment)
- `LABEL_3` novelty_issue — generic/unsubstantiated novelty *claim* phrasing (not a literature search)

Trained on weakly labeled sentences derived from open unarXive citrec text. This is **not**
a formal statistical review, novelty search, or affiliation with any commercial detector.

See `inference_config.json` for calibrated thresholds and metrics:

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
    commit_message="Upload quantized manuscript-quality classifier",
    ignore_patterns=["**/model.onnx", "**/*.onnx_data"],
)

print(f"\ndone: https://huggingface.co/{repo_id}")
print(f"\nSet on Netlify:  VITE_QUALITY_MODEL_ID={repo_id}")

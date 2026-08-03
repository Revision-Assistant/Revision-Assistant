"""
Upload quantized AI-writing detector ONNX to Hugging Face Hub.

Requires HF_TOKEN in the environment (local .env; never committed).
"""
import json
import os
from pathlib import Path

import truststore

truststore.inject_into_ssl()

from huggingface_hub import HfApi, whoami

HERE = Path(__file__).parent
MODEL_DIR = HERE / "ai_detect_onnx"
REPO_NAME = "revision-assistant-ai-detect"

token = os.environ.get("HF_TOKEN")
if not token:
    raise SystemExit("HF_TOKEN not set in environment")

if not MODEL_DIR.exists():
    raise SystemExit(f"{MODEL_DIR} not found — run export_ai_detect_onnx.py first")

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
  - ai-text-detection
  - academic-writing
---

# Academic AI-writing detector

Fine-tuned SciBERT binary passage classifier: `LABEL_1` = machine-generated,
`LABEL_0` = human-written. Intended as an *advisory* writing-voice signal for the
Revision Assistant — never proof of misconduct. High-precision threshold is chosen
on validation; see `inference_config.json`.

Training data (all openly licensed): yaful/MAGE (Apache-2.0), tum-nlp/IDMGSP
(OpenRAIL++), Hello-SimpleAI/HC3 (CC-BY-SA-4.0), mithu-ngl/SciHRA-Detect (open),
unarXive human passages (CC-BY). Evaluated on an in-distribution holdout plus
cross-generator OOD sets (MAGE OOD GPT-4-era, MAGE paraphrase-attack, IDMGSP OOD).

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
    commit_message="Upload quantized academic AI-writing detector",
    ignore_patterns=["**/model.onnx", "**/*.onnx_data"],
)

print(f"\ndone: https://huggingface.co/{repo_id}")
print(f"\nSet on Netlify:  VITE_AI_MODEL_ID={repo_id}")

"""
Upload the quantized citation-need model to a public Hugging Face Hub repo — free CDN
hosting so the 110MB weights never ship inside the Netlify deploy.

Requires HF_TOKEN in the environment (local .env; never committed).
"""
import os
from pathlib import Path

import truststore

truststore.inject_into_ssl()

from huggingface_hub import HfApi, whoami

HERE = Path(__file__).parent
MODEL_DIR = HERE / "citation_need_onnx"
REPO_NAME = "revision-assistant-citation-need"

token = os.environ.get("HF_TOKEN")
if not token:
    raise SystemExit("HF_TOKEN not set in environment")

if not MODEL_DIR.exists():
    raise SystemExit(f"{MODEL_DIR} not found — run export_onnx.py first")

api = HfApi(token=token)
username = whoami(token=token)["name"]
repo_id = f"{username}/{REPO_NAME}"

print(f"creating/using repo: {repo_id}")
api.create_repo(repo_id, repo_type="model", exist_ok=True, private=False)

readme = f"""---
license: apache-2.0
base_model: allenai/scibert_scivocab_uncased
tags:
  - text-classification
  - citation-need-detection
  - academic-writing
---

# Citation-need detector

Fine-tuned SciBERT sentence classifier: does this sentence assert something about prior
work / external evidence without a nearby citation? Trained on {os.environ.get('N_TRAIN', '32000')}
sentence pairs derived from unarXive (a sentence carrying a citation marker is a positive
example; the marker is stripped for the model input).

Part of [Revision Assistant](https://github.com/) — a browser-based academic writing
revision tool. This model flags claims Turnitin structurally cannot see (it only reports
text overlapping an indexed source). It never proposes a citation or rewrites text — output
is a single probability that the app uses to surface a "consider citing this" prompt.

See `inference_config.json` for the calibrated decision threshold and validation metrics.
"""
(MODEL_DIR / "README.md").write_text(readme, encoding="utf-8")

print("uploading files...")
api.upload_folder(
    repo_id=repo_id,
    folder_path=str(MODEL_DIR),
    repo_type="model",
    commit_message="Upload quantized citation-need classifier",
)

print(f"\ndone: https://huggingface.co/{repo_id}")
print(f"\nSet on Netlify:  VITE_CITATION_MODEL_ID={repo_id}")

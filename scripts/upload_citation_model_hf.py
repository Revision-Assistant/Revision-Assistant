#!/usr/bin/env python3
"""
Upload citation-need ONNX folder to Hugging Face Hub (free public hosting).

Usage:
  pip install huggingface_hub
  huggingface-cli login
  python scripts/upload_citation_model_hf.py --repo YOUR_USER/revision-assistant-citation-need

Requires local weights at public/models/citation-need/ (including onnx/).
Never uploads test/ manuscripts.
"""
from __future__ import annotations

import argparse
from pathlib import Path

from huggingface_hub import HfApi


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True, help="HF model id, e.g. user/revision-assistant-citation-need")
    ap.add_argument(
        "--folder",
        default=str(Path(__file__).resolve().parents[1] / "public" / "models" / "citation-need"),
    )
    args = ap.parse_args()
    folder = Path(args.folder)
    if not folder.exists():
        raise SystemExit(f"Missing {folder} — export ONNX first (training/local/export_onnx.py)")
    onnx = folder / "onnx"
    if not onnx.exists():
        raise SystemExit(f"Missing {onnx} — quantized weights required for browser load")

    api = HfApi()
    api.create_repo(args.repo, repo_type="model", exist_ok=True, private=False)
    api.upload_folder(
        folder_path=str(folder),
        repo_id=args.repo,
        repo_type="model",
        commit_message="Upload citation-need ONNX for Revision Assistant MVP",
    )
    print("Uploaded. Set Netlify env:")
    print(f"  VITE_CITATION_MODEL_ID={args.repo}")


if __name__ == "__main__":
    main()

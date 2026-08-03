"""
Download a larger free citation-need corpus from Hugging Face (unarXive citrec)
into raw_train.jsonl, then run prepare_data.py.

Usage:
  python download_citation_data.py           # stream up to ~2GB / 400k blobs
  python download_citation_data.py --max-blobs 800000
  python prepare_data.py 200000             # build balanced train/val/test
  python train_scibert.py
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import truststore

truststore.inject_into_ssl()

from datasets import load_dataset

HERE = Path(__file__).parent
RAW = HERE / "raw_train.jsonl"
# Free HF datasets that expose scientific text with citation markers
CANDIDATES = (
    ("saier/unarxive_citrec", "train"),
    ("saier/unarXive_citrec", "train"),
)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-blobs", type=int, default=400_000)
    ap.add_argument("--append", action="store_true")
    args = ap.parse_args()

    mode = "a" if args.append and RAW.exists() else "w"
    written = 0
    ds = None
    for name, split in CANDIDATES:
        try:
            print(f"loading {name} ({split}) streaming…")
            ds = load_dataset(name, split=split, streaming=True)
            break
        except Exception as e:
            print(f"  skip {name}: {type(e).__name__}: {e}")
    if ds is None:
        raise SystemExit(
            "Could not load unarXive citrec from Hugging Face. "
            "Check internet / truststore, or place raw_train.jsonl manually."
        )

    with RAW.open(mode, encoding="utf-8") as out:
        for ex in ds:
            text = ex.get("text") if isinstance(ex, dict) else None
            if not isinstance(text, str) or len(text.strip()) < 40:
                # try common alternates
                for k in ("context", "sentence", "input", "query"):
                    v = ex.get(k) if isinstance(ex, dict) else None
                    if isinstance(v, str) and len(v.strip()) >= 40:
                        text = v
                        break
            if not isinstance(text, str) or len(text.strip()) < 40:
                continue
            out.write(json.dumps({"text": text}, ensure_ascii=False) + "\n")
            written += 1
            if written % 20000 == 0:
                print(f"  wrote {written} blobs…")
            if written >= args.max_blobs:
                break

    print(f"done: {written} blobs -> {RAW} ({RAW.stat().st_size / 1e6:.1f} MB)")
    print("Next: python prepare_data.py 200000")


if __name__ == "__main__":
    main()

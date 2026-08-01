"""
Build the balanced train/val/test split from unarXive_citrec's train.jsonl.

Actual schema (verified against the real file, not assumed): each row is a multi-sentence
`text` blob from one paper, built for a *different* task (predicting which specific paper
`[1]}` refers to — `label` is an OpenAlex ID). It is repurposed here: every row already
mixes cited and uncited sentences, so it's split per-sentence and relabelled —
- a sentence containing a citation marker -> positive, marker stripped
- a sentence with none -> negative

Two dataset-specific quirks that would otherwise poison the labels:
  - citation markers here are `[N]}`  (trailing brace is a scarecrow-style artifact),
    not the clean `{{cite:...}}` placeholder assumed in the Kaggle notebook
  - `Fig. REF`, `<FIGURE>`, `<TABLE>`, `Eq. REF` are internal cross-references,
    not citations — must be stripped as noise but never counted as a citation marker
"""
import json
import re
import random
import sys
from pathlib import Path

import truststore
truststore.inject_into_ssl()

SEED = 42
random.seed(SEED)

HERE = Path(__file__).parent
RAW_PATH = HERE / "raw_train.jsonl"
MAX_ROWS = int(sys.argv[1]) if len(sys.argv) > 1 else 60_000

# Real citation markers observed in this dataset, plus the generic styles the app itself
# looks for (kept for portability to other sources).
CITE_RE = re.compile(
    r"\[\d+(?:\s*[,–-]\s*\d+)*\]\}?"                                   # [1]}  [2, 3]}
    r"|\([A-Z][A-Za-z'-]+(?: et al\.)?,?\s*\d{4}[a-z]?\)"              # (Smith, 2020)
    r"|\{\{cite:[^}]*\}\}"
)
# Internal cross-references — strip as noise, never a citation
NOISE_RE = re.compile(
    r"<FIGURE>|<TABLE>|<EQUATION>"
    r"|\b(?:Fig(?:ure)?|Eq(?:uation)?|Table|Sec(?:tion)?)\.?\s*REF\b",
    re.IGNORECASE,
)
SENT_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z\[])")


def clean_sentence(text: str) -> str:
    text = NOISE_RE.sub("", text)
    text = CITE_RE.sub("", text)
    return re.sub(r"\s+", " ", text).strip()


def split_and_label(blob: str) -> list[dict]:
    out = []
    for sent in SENT_SPLIT_RE.split(blob):
        sent = sent.strip()
        if not sent:
            continue
        has_citation = bool(CITE_RE.search(sent))
        clean = clean_sentence(sent)
        wc = len(clean.split())
        if wc < 8 or wc > 60:
            continue
        # A sentence that is only figure/table noise once stripped is not useful either way
        if not clean or not re.search(r"[A-Za-z]{3,}", clean):
            continue
        out.append({"text": clean, "label": 1 if has_citation else 0})
    return out


def main() -> None:
    if not RAW_PATH.exists():
        print(f"Missing {RAW_PATH} — run the download step first.", file=sys.stderr)
        sys.exit(1)

    rows: list[dict] = []
    blobs_read = 0
    with open(RAW_PATH, encoding="utf-8") as f:
        for line in f:
            if len(rows) >= MAX_ROWS * 3:  # over-collect before balancing
                break
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            text = obj.get("text")
            if not isinstance(text, str) or not text.strip():
                continue
            blobs_read += 1
            rows.extend(split_and_label(text))

    print(f"read {blobs_read} paper blobs -> {len(rows)} labelled sentences")
    if len(rows) < 500:
        print("First raw line for debugging:")
        with open(RAW_PATH, encoding="utf-8") as f:
            print(f.readline()[:500])
        sys.exit(1)

    leaked = [r for r in rows if CITE_RE.search(r["text"])]
    assert not leaked, f"{len(leaked)} rows still contain citation markers — labelling bug"

    pos = [r for r in rows if r["label"] == 1]
    neg = [r for r in rows if r["label"] == 0]
    k = min(len(pos), len(neg), MAX_ROWS // 2)
    random.shuffle(pos)
    random.shuffle(neg)
    balanced = pos[:k] + neg[:k]
    random.shuffle(balanced)
    print(f"balanced: {len(balanced)} rows ({k} per class)")

    n = len(balanced)
    splits = {
        "train": balanced[: int(0.8 * n)],
        "val": balanced[int(0.8 * n) : int(0.9 * n)],
        "test": balanced[int(0.9 * n) :],
    }
    for name, split_rows in splits.items():
        out = HERE / f"{name}.jsonl"
        with open(out, "w", encoding="utf-8") as f:
            for r in split_rows:
                f.write(json.dumps(r) + "\n")
        print(f"  {name}: {len(split_rows)} -> {out}")


if __name__ == "__main__":
    main()

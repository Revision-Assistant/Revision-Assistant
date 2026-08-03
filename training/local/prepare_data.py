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
MAX_ROWS = int(sys.argv[1]) if len(sys.argv) > 1 else 200_000

# Real citation markers observed in this dataset, plus the generic styles the app itself
# looks for (kept for portability to other sources).
CITE_RE = re.compile(
    r"\[\d+(?:\s*[,–-]\s*\d+)*\]\}?"                                   # [1]}  [2, 3]}
    r"|\([A-Z][A-Za-z'-]+(?:\s+et\s+al\.?)?,?\s*\d{4}[a-z]?\)"         # (Smith, 2020) / (Liaudat et al. 2022)
    r"|\{\{cite:[^}]*\}\}"
)
# Internal cross-references — strip as noise, never a citation
NOISE_RE = re.compile(
    r"<FIGURE>|<TABLE>|<EQUATION>"
    r"|\b(?:Fig(?:ure)?|Eq(?:uation)?|Table|Sec(?:tion)?)\.?\s*REF\b",
    re.IGNORECASE,
)
SENT_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z\[])")

# Hard-example mining mirrors the live eligibility / attribution gates so the model
# spends capacity on the sentences that actually reach the UI, not easy boilerplate.
ATTRIBUTION_LIKE_RE = re.compile(
    r"\b(?:studies|research|works?|papers?|authors?|investigations?)\s+(?:have\s+)?"
    r"(?:shown|demonstrated|reported|found|indicated|suggested|revealed|established|confirmed)\b"
    r"|\bit\s+(?:has\s+been|was|is)\s+(?:shown|demonstrated|reported|found|observed|established|suggested|proposed)\b"
    r"|\b(?:previous|prior|earlier|recent|several|many|numerous)\s+"
    r"(?:studies|works?|reports?|investigations?|authors?|researchers?)\b"
    r"|\b(?:according\s+to|as\s+reported\s+by|as\s+shown\s+by|as\s+described\s+(?:by|in))\b"
    r"|\bhas\s+been\s+(?:widely|extensively|commonly|successfully)\s+"
    r"(?:used|studied|investigated|applied|reported)\b"
    r"|\b(?:is|are)\s+(?:widely|well|commonly|generally)\s+"
    r"(?:known|established|accepted|recognized|reported|documented)\b",
    re.IGNORECASE,
)
OWN_WORK_RE = re.compile(
    r"\b(?:we|our|us|I|my)\b"
    r"|\b(?:this|the\s+present|the\s+proposed|the\s+current)\s+"
    r"(?:work|study|paper|article|section|analysis|simulation|design|device|model)\b"
    r"|\b(?:fig(?:ure)?|table|eq(?:uation)?|section|appendix)\.?\s*\d",
    re.IGNORECASE,
)


def clean_sentence(text: str) -> str:
    text = NOISE_RE.sub("", text)
    # Nested markers like "(Smith et al. 2022[4]})" need multiple passes
    for _ in range(4):
        nxt = CITE_RE.sub("", text)
        if nxt == text:
            break
        text = nxt
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


def take(pool: list[dict], n: int) -> list[dict]:
    if n <= 0 or not pool:
        return []
    random.shuffle(pool)
    return pool[:n]


def main() -> None:
    if not RAW_PATH.exists():
        print(f"Missing {RAW_PATH} — run the download step first.", file=sys.stderr)
        sys.exit(1)

    rows: list[dict] = []
    blobs_read = 0
    # Over-collect so hard-example buckets can fill at 200k+ scale.
    collect_cap = max(MAX_ROWS * 5, 1_000_000)
    with open(RAW_PATH, encoding="utf-8") as f:
        for line in f:
            if len(rows) >= collect_cap:
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

    hard_pos, soft_pos, hard_neg, easy_neg = [], [], [], []
    for r in rows:
        hard = bool(ATTRIBUTION_LIKE_RE.search(r["text"]))
        own = bool(OWN_WORK_RE.search(r["text"]))
        if r["label"] == 1:
            # Drop first-person / figure-pointer positives — live path never surfaces them.
            if own:
                continue
            (hard_pos if hard else soft_pos).append(r)
        else:
            if own and not hard:
                continue  # trivial "we measured…" negatives waste capacity
            (hard_neg if hard else easy_neg).append(r)

    k = MAX_ROWS // 2
    # Bias toward attribution-shaped sentences (what the UI actually asks about).
    n_hard_pos = min(len(hard_pos), int(k * 0.7))
    n_soft_pos = min(len(soft_pos), k - n_hard_pos)
    # Top up from soft if hard pool is small
    if n_hard_pos + n_soft_pos < k:
        n_hard_pos = min(len(hard_pos), k - n_soft_pos)

    n_hard_neg = min(len(hard_neg), int(k * 0.55))
    n_easy_neg = min(len(easy_neg), k - n_hard_neg)
    if n_hard_neg + n_easy_neg < k:
        n_hard_neg = min(len(hard_neg), k - n_easy_neg)

    pos = take(hard_pos, n_hard_pos) + take(soft_pos, n_soft_pos)
    neg = take(hard_neg, n_hard_neg) + take(easy_neg, n_easy_neg)
    # Final balance: truncate to equal class sizes
    m = min(len(pos), len(neg), k)
    balanced = take(pos, m) + take(neg, m)
    random.shuffle(balanced)
    print(
        f"balanced: {len(balanced)} rows ({m} per class) | "
        f"pools hard_pos={len(hard_pos)} soft_pos={len(soft_pos)} "
        f"hard_neg={len(hard_neg)} easy_neg={len(easy_neg)}"
    )

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

"""
Build a HARDER held-out eval slice for manuscript-quality:

1. Natural weak-labeled sentences from unarXive blobs *beyond* the first 400k
   used to build train/val/test (fresh text, deduped against all splits).
2. Synthetic positives from paraphrase templates that were NOT in the training
   generator (tests generalization beyond memorized seed phrasings).
3. Hard negatives: substantiated-novelty and precise-numeric sentences.

Output: quality_hard_eval.jsonl  {"text","label","origin"}
"""
from __future__ import annotations

import json
import random
import re
from pathlib import Path

import prepare_quality_data as pq

SEED = 777
random.seed(SEED)
HERE = Path(__file__).parent
RAW_PATH = HERE / "raw_train.jsonl"
SKIP_BLOBS = 400_000
MAX_EXTRA_BLOBS = 250_000

PER_CLASS_NATURAL = 1500
PER_CLASS_SYNTH = 1500
N_NONE = 4500

# Paraphrase templates deliberately different from pq.SYNTH_* phrasings.
HARD_SYNTH = {
    3: [  # novelty_issue
        "As far as we are aware, {clause}.",
        "This represents the first attempt in the literature where {clause}.",
        "Ours is an entirely new framework under which {clause}.",
        "Prior studies have never considered the scenario in which {clause}.",
        "We break new ground by demonstrating that {clause}.",
        "The originality of this study lies in the fact that {clause}.",
        "Nothing comparable has appeared in earlier research showing that {clause}.",
    ],
    1: [  # numerical_ambiguity
        "A considerable fraction of the trials revealed that {clause}.",
        "The gains were sizeable once {clause}.",
        "Roughly a third of participants reported that {clause}.",
        "Outcomes rose markedly whenever {clause}.",
        "In the vast majority of runs, {clause}.",
        "Error dropped noticeably after {clause}.",
        "Close to ninety percent of subjects found that {clause}.",
    ],
    2: [  # publication_issue
        "The reader is referred to Table 4 for specifics; in short, {clause}.",
        "Conventional protocols were adopted throughout, and {clause}.",
        "Owing to page limits we defer the derivation, noting only that {clause}.",
        "Figure 7 depicts the outcome, namely that {clause}.",
        "All measurements were rigorously carried out and {clause}.",
        "The findings were encouraging in that {clause}.",
        "Full particulars appear in the supplementary material; briefly, {clause}.",
    ],
}


def load_existing_texts() -> set[str]:
    seen = set()
    for name in ("quality_train", "quality_val", "quality_test"):
        p = HERE / f"{name}.jsonl"
        if not p.exists():
            continue
        for line in open(p, encoding="utf-8"):
            try:
                seen.add(json.loads(line)["text"].lower())
            except (json.JSONDecodeError, KeyError):
                continue
    return seen


def main() -> None:
    # rebuild the fixed NUM_PRECISE_RE the same way train prep does
    pq.NUM_PRECISE_RE = re.compile(
        r"\b(?:p\s*[<=]\s*0?\.\d+|95\s*%\s*CI|confidence\s+interval|"
        r"n\s*=\s*\d+|N\s*=\s*\d+|mean\s*[+/-]\s*\d|"
        r"\d+(?:\.\d+)?\s*%\s*\(\s*\d+\s*/\s*\d+\s*\)|"
        r"\d+(?:\.\d+)?\s*\+/-\s*\d+(?:\.\d+)?)\b",
        re.IGNORECASE,
    )

    seen = load_existing_texts()
    print(f"existing split texts: {len(seen)}")

    nat: dict[int, list[str]] = {0: [], 1: [], 2: [], 3: []}
    hard_negs: list[str] = []
    clean_pool: list[str] = []

    n_blob = 0
    used = 0
    with open(RAW_PATH, encoding="utf-8") as f:
        for line in f:
            n_blob += 1
            if n_blob <= SKIP_BLOBS:
                continue
            if used >= MAX_EXTRA_BLOBS:
                break
            if (
                all(len(nat[i]) >= PER_CLASS_NATURAL for i in (1, 2, 3))
                and len(nat[0]) >= N_NONE
                and len(hard_negs) >= 1500
                and len(clean_pool) >= 20000
            ):
                break
            used += 1
            try:
                blob = json.loads(line).get("text") or ""
            except json.JSONDecodeError:
                continue
            for sent in pq.SENT_SPLIT_RE.split(blob):
                clean = pq.clean_sentence(sent)
                wc = len(clean.split())
                if wc < 8 or wc > 65 or not re.search(r"[A-Za-z]{3,}", clean):
                    continue
                key = clean.lower()
                if key in seen:
                    continue
                label = pq.weak_label(clean)
                if label is None:
                    continue
                seen.add(key)
                if label == 0:
                    if pq.NOVELTY_SUBSTANTIATED_RE.search(clean) or pq.NUM_PRECISE_RE.search(clean):
                        if len(hard_negs) < 3000:
                            hard_negs.append(clean)
                    elif len(nat[0]) < N_NONE * 2:
                        nat[0].append(clean)
                    if len(clean_pool) < 30000:
                        clean_pool.append(clean)
                elif len(nat[label]) < PER_CLASS_NATURAL * 2:
                    nat[label].append(clean)
            if used % 50_000 == 0:
                print(f"extra blobs={used} nat={[len(nat[i]) for i in range(4)]} "
                      f"hardneg={len(hard_negs)} clean={len(clean_pool)}")

    print(f"scanned {used} fresh blobs; nat counts:", {i: len(v) for i, v in nat.items()},
          "hard_negs:", len(hard_negs))

    rows: list[dict] = []
    for lab in (1, 2, 3):
        for t in random.sample(nat[lab], min(PER_CLASS_NATURAL, len(nat[lab]))):
            rows.append({"text": t, "label": lab, "origin": "natural"})

    random.shuffle(clean_pool)
    idx = 0
    for lab in (1, 2, 3):
        made = 0
        while made < PER_CLASS_SYNTH and idx < len(clean_pool):
            base = clean_pool[idx]
            idx += 1
            tmpl = random.choice(HARD_SYNTH[lab])
            text = tmpl.format(clause=pq.clause_from(base))
            key = text.lower()
            if key in seen:
                continue
            seen.add(key)
            rows.append({"text": text, "label": lab, "origin": "hard_synth"})
            made += 1
        print(f"hard synth label={lab}: +{made}")

    n_hard = min(len(hard_negs), 1500)
    for t in random.sample(hard_negs, n_hard):
        rows.append({"text": t, "label": 0, "origin": "hard_negative"})
    for t in random.sample(nat[0], min(N_NONE - n_hard, len(nat[0]))):
        rows.append({"text": t, "label": 0, "origin": "natural_none"})

    random.shuffle(rows)
    out = HERE / "quality_hard_eval.jsonl"
    with open(out, "w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    from collections import Counter
    print("wrote", out, len(rows), Counter((r["label"], r["origin"]) for r in rows))


if __name__ == "__main__":
    import sys
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main()

"""
Build weakly labeled journal-readiness multi-label data from open research text only.

Sources: unarXive citrec (raw_train.jsonl) — arXiv-derived open abstracts/blobs.
Optional: PeerRead open reviews (allenai/peer_read) if downloadable without paywall.

Labels (multi-hot, NOT real quartiles / acceptance):
  0 structure_ok     — IMRaD / methods-results cues
  1 numerical_clear  — precise stats / n= / CI
  2 novelty_ok       — no unsubstantiated novelty boilerplate
  3 methods_concrete — concrete method language (not "standard procedures")
  4 selective_ready  — composite "selective venue bar" weak positive
  5 ieee_craft       — IEEE-ish numbering / EE-CS craft cues

Usage: python prepare_journal_data.py [max_blobs]
"""
from __future__ import annotations

import json
import random
import re
import sys
from collections import Counter
from pathlib import Path

SEED = 42
random.seed(SEED)

HERE = Path(__file__).parent
RAW_PATH = HERE / "raw_train.jsonl"
MAX_BLOBS = int(sys.argv[1]) if len(sys.argv) > 1 else 250_000

LABEL_NAMES = [
    "structure_ok",
    "numerical_clear",
    "novelty_ok",
    "methods_concrete",
    "selective_ready",
    "ieee_craft",
]

SENT_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z\[\"'])")
NOISE_RE = re.compile(
    r"<FIGURE>|<TABLE>|<EQUATION>"
    r"|\b(?:Fig(?:ure)?|Eq(?:uation)?|Table|Sec(?:tion)?)\.?\s*REF\b",
    re.IGNORECASE,
)

STRUCTURE_RE = re.compile(
    r"\b(?:we\s+(?:propose|present|introduce|develop|evaluate|conduct)|"
    r"methods?|methodology|experimental\s+setup|results?\s+(?:show|indicate|demonstrate)|"
    r"in\s+this\s+(?:paper|work|study)|contribution(?:s)?\s+(?:are|is)|"
    r"dataset|benchmark|evaluation)\b",
    re.IGNORECASE,
)
NUM_CLEAR_RE = re.compile(
    r"\b(?:n\s*=\s*\d+|N\s*=\s*\d+|p\s*[<≈=]\s*0?\.\d+|95\s*%\s*CI|"
    r"\d+(?:\.\d+)?\s*%|±\s*\d|"
    r"accuracy|f1|auc|bleu|rouge|iou)\b",
    re.IGNORECASE,
)
NUM_AMBIG_RE = re.compile(
    r"\b(?:approximately|roughly|around|about|nearly|several|numerous|"
    r"significant(?:ly)?|substantial(?:ly)?)\b",
    re.IGNORECASE,
)
NOVELTY_BAD_RE = re.compile(
    r"\bto\s+the\s+best\s+of\s+our\s+knowledge\b|"
    r"\bfor\s+the\s+first\s+time\b|"
    r"\b(?:a\s+)?novel\s+(?:approach|method|framework|algorithm|technique|model)\b|"
    r"\bno\s+previous\s+(?:work|study)\s+has\b|"
    r"\bfills?\s+an?\s+important\s+gap\b",
    re.IGNORECASE,
)
NOVELTY_OK_RE = re.compile(
    r"\bcompared\s+(?:to|with|against)\b|"
    r"\bunlike\s+(?:prior|previous|earlier)\b|"
    r"\b(?:outperforms?|improves?\s+upon)\b.{0,40}\b(?:by|with)\s+\d",
    re.IGNORECASE,
)
METHODS_VAGUE_RE = re.compile(
    r"\b(?:standard|conventional|usual)\s+(?:methods?|procedures?|protocols?)\s+"
    r"(?:were|was)\s+(?:used|followed|applied)\b|"
    r"\b(?:carefully|properly|thoroughly)\s+(?:performed|conducted)\b",
    re.IGNORECASE,
)
METHODS_CONCRETE_RE = re.compile(
    r"\b(?:trained|fine[- ]tuned|optimized|implemented|sampled|annotated|"
    r"hyperparameter|batch\s+size|learning\s+rate|epochs?|"
    r"cross[- ]validation|ablation|baseline)\b",
    re.IGNORECASE,
)
IEEE_RE = re.compile(
    r"\[\d+(?:\s*[,;-]\s*\d+)*\]|"
    r"\b(?:IEEE|MIMO|OFDM|SNR|BER|FPGA|SoC|beamforming|wireless|"
    r"convolutional|transformer|neural\s+network)\b",
    re.IGNORECASE,
)
CITE_RE = re.compile(r"\[\d+(?:\s*[,;-]\s*\d+)*\]|\([A-Z][A-Za-z'-]+(?:\s+et\s+al\.?)?,?\s*\d{4}")


def clean(text: str) -> str:
    t = NOISE_RE.sub(" ", text)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def label_chunk(text: str) -> list[float]:
    structure = 1.0 if STRUCTURE_RE.search(text) else 0.0
    num_clear = 1.0 if NUM_CLEAR_RE.search(text) and not (
        NUM_AMBIG_RE.search(text) and not re.search(r"\d", text)
    ) else (0.0 if NUM_AMBIG_RE.search(text) and not NUM_CLEAR_RE.search(text) else (0.5 if NUM_CLEAR_RE.search(text) else 0.0))
    if NUM_CLEAR_RE.search(text):
        num_clear = 1.0
    novelty_ok = 0.0 if (NOVELTY_BAD_RE.search(text) and not NOVELTY_OK_RE.search(text)) else 1.0
    methods = 0.0 if METHODS_VAGUE_RE.search(text) else (1.0 if METHODS_CONCRETE_RE.search(text) else 0.0)
    ieee = 1.0 if IEEE_RE.search(text) else 0.0
    # selective_ready: weak composite — not acceptance / not real Q1
    score = structure + num_clear + novelty_ok + methods + (0.5 if CITE_RE.search(text) else 0.0)
    selective = 1.0 if score >= 3.5 and novelty_ok > 0.5 else 0.0
    return [structure, float(num_clear >= 1.0), novelty_ok, methods, selective, ieee]


def iter_blobs(max_blobs: int):
    if not RAW_PATH.exists():
        raise SystemExit(f"Missing {RAW_PATH}")
    n = 0
    with open(RAW_PATH, encoding="utf-8") as f:
        for line in f:
            if n >= max_blobs:
                break
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            text = obj.get("text") or obj.get("abstract") or ""
            if not text or len(text) < 80:
                continue
            yield clean(text)
            n += 1


def chunks_from_blob(blob: str) -> list[str]:
    # Prefer ~2–4 sentence windows (abstract-like)
    sents = [s.strip() for s in SENT_SPLIT_RE.split(blob) if len(s.strip()) > 40]
    if not sents:
        return [blob[:800]] if len(blob) > 80 else []
    out = []
    for i in range(0, len(sents), 3):
        chunk = " ".join(sents[i : i + 3])
        if 80 <= len(chunk) <= 1200:
            out.append(chunk[:1000])
    if not out and len(blob) > 80:
        out.append(blob[:800])
    return out[:4]


def main() -> None:
    rows: list[dict] = []
    seen = set()
    blob_n = 0
    for blob in iter_blobs(MAX_BLOBS):
        blob_n += 1
        if blob_n % 20000 == 0:
            print(f"scanned {blob_n} blobs, kept {len(rows)} chunks...", flush=True)
        for chunk in chunks_from_blob(blob):
            key = chunk[:120].lower()
            if key in seen:
                continue
            seen.add(key)
            labels = label_chunk(chunk)
            rows.append({"text": chunk, "labels": labels})
            if len(rows) >= 80_000:
                break
        if len(rows) >= 80_000:
            break
    print(f"finished scan: blobs={blob_n} chunks={len(rows)}", flush=True)

    random.shuffle(rows)
    # Balance a bit toward selective / non-selective
    pos = [r for r in rows if r["labels"][4] >= 1.0]
    neg = [r for r in rows if r["labels"][4] < 1.0]
    target = min(40_000, len(rows))
    half = target // 2
    selected = pos[:half] + neg[: half + (target % 2)]
    if len(selected) < target:
        selected_ids = {id(r) for r in selected}
        for r in rows:
            if id(r) not in selected_ids:
                selected.append(r)
                if len(selected) >= target:
                    break
    random.shuffle(selected)
    print(f"selected {len(selected)} rows for splits", flush=True)

    n = len(selected)
    n_train = int(n * 0.8)
    n_val = int(n * 0.1)
    splits = {
        "train": selected[:n_train],
        "val": selected[n_train : n_train + n_val],
        "test": selected[n_train + n_val :],
    }

    counts = Counter()
    for r in selected:
        for i, name in enumerate(LABEL_NAMES):
            if r["labels"][i] >= 0.5:
                counts[name] += 1

    meta = {
        "source": "unarXive citrec open arXiv-derived blobs only",
        "labels": LABEL_NAMES,
        "n_total": n,
        "label_positive_counts": dict(counts),
        "note": (
            "Weak labels for readiness *heuristics* only — not acceptance probability, "
            "not Scimago/Clarivate quartiles, not affiliated with IEEE/Elsevier."
        ),
    }
    (HERE / "journal_data_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    for name, data in splits.items():
        path = HERE / f"journal_{name}.jsonl"
        with open(path, "w", encoding="utf-8") as f:
            for r in data:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        print(f"wrote {path.name}: {len(data)}")
    print("meta:", meta)


if __name__ == "__main__":
    main()

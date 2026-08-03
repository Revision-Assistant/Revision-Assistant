"""
Build a large weakly-labeled manuscript-quality dataset from open scientific text.

Primary source: unarXive citrec (raw_train.jsonl — arXiv-derived).
Optional: rewrite_data/*.jsonl, HF armanc/scientific_papers arxiv abstracts.

When natural positives are rare, also synthesize positives by injecting known
boilerplate templates into clean open academic sentences (same corpora) — a
standard weak-supervision augmentation, not private papers.

Labels: 0 none | 1 numerical_ambiguity | 2 publication_issue | 3 novelty_issue
Target: 100k+ sentences. Precision-oriented seeds + hard negatives.

Usage: python prepare_quality_data.py [max_blobs]
"""
from __future__ import annotations

import json
import os
import random
import re
import sys
from collections import Counter
from pathlib import Path

SEED = 42
random.seed(SEED)

HERE = Path(__file__).parent
RAW_PATH = HERE / "raw_train.jsonl"
REWRITE_DIR = HERE / "rewrite_data"
MAX_BLOBS = int(sys.argv[1]) if len(sys.argv) > 1 else 400_000

CAP_NONE_POOL = 220_000
CAP_POS_POOL = 90_000
TARGET_NONE = 60_000
TARGET_PER_POS = 30_000  # ~150k total

SENT_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z\[\"'])")
CITE_RE = re.compile(
    r"\[\d+(?:\s*[,;-]\s*\d+)*\]\}?"
    r"|\([A-Z][A-Za-z'-]+(?:\s+et\s+al\.?)?,?\s*\d{4}[a-z]?\)"
    r"|\{\{cite:[^}]*\}\}"
)
NOISE_RE = re.compile(
    r"<FIGURE>|<TABLE>|<EQUATION>"
    r"|\b(?:Fig(?:ure)?|Eq(?:uation)?|Table|Sec(?:tion)?)\.?\s*REF\b",
    re.IGNORECASE,
)

NOVELTY_RE = re.compile(
    r"\bto\s+the\s+best\s+of\s+our\s+knowledge\b"
    r"|\bfor\s+the\s+first\s+time\b"
    r"|\b(?:this|the\s+present)\s+(?:paper|work|study)\s+(?:is\s+the\s+first|presents?\s+the\s+first)\b"
    r"|\b(?:a\s+)?novel\s+(?:approach|method|framework|algorithm|technique|model|architecture|contribution|idea)\b"
    r"|\b(?:unprecedented|ground[- ]breaking|brand[- ]new)\b"
    r"|\bwe\s+(?:are\s+the\s+first|propose\s+a\s+novel|introduce\s+a\s+novel|present\s+a\s+novel)\b"
    r"|\bno\s+previous\s+(?:work|study|research)\s+has\b"
    r"|\bfills?\s+an?\s+important\s+gap\b"
    r"|\bnever\s+before\s+(?:been\s+)?(?:studied|investigated|explored|proposed)\b"
    r"|\bunique\s+contribution\b"
    r"|\bour\s+main\s+contribution\s+is\b"
    r"|\bstate[- ]of[- ]the[- ]art\s+(?:results?|performance)\b(?![^.]{0,40}\b\d)",
    re.IGNORECASE,
)
NOVELTY_SUBSTANTIATED_RE = re.compile(
    r"\bcompared\s+(?:to|with|against)\b"
    r"|\bunlike\s+(?:prior|previous|earlier|existing)\b"
    r"|\bwhereas\s+(?:prior|previous|existing)\b"
    r"|\b(?:outperforms?|improves?\s+upon)\b.{0,60}\b(?:by|with)\s+\d",
    re.IGNORECASE,
)

NUM_AMBIG_RE = re.compile(
    r"\b(?:approximately|roughly|around|about|nearly|almost|close\s+to)\s+"
    r"(?:\d|half|a\s+third|a\s+quarter|one[- ]half|one[- ]third)\b"
    r"|\b(?:several|numerous|various|a\s+number\s+of|a\s+few|many|most)\s+"
    r"(?:%|percent|percentage|patients?|samples?|subjects?|cases?|trials?|experiments?|participants?)\b"
    r"|\b(?:significant(?:ly)?|substantial(?:ly)?|considerable(?:ly)?|marked(?:ly)?)\s+"
    r"(?:increase|decrease|improvement|reduction|difference|effect|change|gain|loss)\b"
    r"|\b(?:increased|decreased|improved|reduced|enhanced)\s+(?:significantly|substantially|considerably)\b"
    r"|\b(?:about|around|roughly|nearly)\s+\d+(?:\.\d+)?\s*%\b"
    r"|\ba\s+(?:large|small|high|low)\s+(?:number|amount|percentage|fraction)\s+of\b"
    r"|\b(?:high|low|large|small)\s+(?:accuracy|performance|error|rate|correlation)\b"
    r"(?![^.]{0,40}\b\d)"
    r"|\bmore\s+than\s+(?:half|enough|most)\b"
    r"|\b(?:almost|nearly)\s+all\b",
    re.IGNORECASE,
)
NUM_PRECISE_RE = re.compile(
    r"\b(?:p\s*[<=]\s*0?\.\d+|95\s*%\s*CI|confidence\s+interval|"
    r"n\s*=\s*\d+|N\s*=\s*\d+|mean\s*[+/-]\s*\d|"
    r"\d+(?:\.\d+)?\s*%\s*\(\s*\d+\s*/\s*\d+\s*\)|"
    r"\d+(?:\.\d+)?\s*\+/-\s*\d+(?:\.\d+)?)\\b",
    re.IGNORECASE,
)

PUB_ISSUE_RE = re.compile(
    r"\bas\s+(?:shown|seen|illustrated|depicted|presented|summarized|indicated)\s+in\s+"
    r"(?:Fig(?:ure)?|Table|Eq(?:uation)?)\.?\s*\d"
    r"|\b(?:see|refer\s+to|cf\.?)\s+(?:Fig(?:ure)?|Table)\.?\s*\d+"
    r"|\b(?:Fig(?:ure)?|Table)\.?\s*\d+\s+(?:shows?|presents?|illustrates?)\s+(?:the\s+)?results?\b"
    r"|\b(?:standard|conventional|usual|typical|well[- ]known|common)\s+"
    r"(?:methods?|procedures?|protocols?|techniques?|approaches?)\s+(?:were|was|are|is)\s+"
    r"(?:used|followed|applied|employed|adopted|taken)\b"
    r"|\b(?:was|were)\s+(?:carefully|properly|appropriately|thoroughly|successfully)\s+"
    r"(?:performed|conducted|carried\s+out|analyzed|analysed|implemented|measured)\b"
    r"|\bresults?\s+(?:were|was|are|is)\s+(?:significant|promising|encouraging|satisfactory|good|excellent|interesting|positive)\b"
    r"|\b(?:further|more)\s+(?:details?|information)\s+(?:are|is|can\s+be)\s+"
    r"(?:provided|found|given|available)\s+in\s+(?:the\s+)?(?:supplementary|appendix|SI)\b"
    r"|\b(?:it\s+can\s+be\s+seen\s+that|it\s+is\s+(?:clear|obvious)\s+that|obviously|clearly),\b"
    r"|\bthe\s+(?:proposed|present)\s+(?:method|approach|model)\s+(?:works?\s+well|is\s+effective|performs?\s+well)\b"
    r"(?![^.]{0,40}\b\d)"
    r"|\bwe\s+(?:omit|skip)\s+(?:the\s+)?(?:details?|derivation)\b"
    r"|\bdue\s+to\s+space\s+constraints\b"
    r"|\bexperimental\s+setup\s+is\s+(?:similar|identical)\s+to\b"
    r"|\bfor\s+brevity,?\s+we\b",
    re.IGNORECASE,
)

HARD_NEG_NUM_RE = re.compile(
    r"\b(?:approximately|about|around)\s+\d+(?:\.\d+)?\s*"
    r"\+/-\s*\d|\bn\s*=\s*\d+.{0,30}\b(?:approximately|about)\b",
    re.IGNORECASE,
)

LABEL_NAMES = {
    0: "none",
    1: "numerical_ambiguity",
    2: "publication_issue",
    3: "novelty_issue",
}

# Templates injected into clean open sentences to grow scarce positives.
SYNTH_NOVELTY = [
    "To the best of our knowledge, {clause}.",
    "For the first time, {clause}.",
    "We propose a novel approach whereby {clause}.",
    "This paper presents a novel method in which {clause}.",
    "No previous work has addressed the setting where {clause}.",
    "Our unique contribution is that {clause}.",
    "We are the first to show that {clause}.",
]
SYNTH_NUM = [
    "Accuracy increased significantly when {clause}.",
    "Performance improved substantially after {clause}.",
    "About half of the samples satisfied {clause}.",
    "Several patients showed that {clause}.",
    "A large number of cases indicated that {clause}.",
    "The error rate was approximately high after {clause}.",
    "Results improved nearly 20% although the base rate is unspecified when {clause}.",
]
SYNTH_PUB = [
    "As shown in Figure 3, {clause}.",
    "Standard procedures were used while {clause}.",
    "The analysis was carefully performed and {clause}.",
    "Results were promising when {clause}.",
    "Further details are provided in the appendix; briefly, {clause}.",
    "See Table 2. {clause}.",
    "Due to space constraints, we note that {clause}.",
    "The proposed method works well when {clause}.",
]


def clean_sentence(text: str) -> str:
    text = NOISE_RE.sub("", text)
    for _ in range(4):
        nxt = CITE_RE.sub("", text)
        if nxt == text:
            break
        text = nxt
    return re.sub(r"\s+", " ", text).strip()


def weak_label(text: str) -> int | None:
    if NOVELTY_RE.search(text):
        if NOVELTY_SUBSTANTIATED_RE.search(text):
            return 0
        return 3
    if PUB_ISSUE_RE.search(text):
        return 2
    if NUM_AMBIG_RE.search(text):
        if NUM_PRECISE_RE.search(text) or HARD_NEG_NUM_RE.search(text):
            return 0
        return 1
    if NUM_PRECISE_RE.search(text):
        return 0
    if re.search(
        r"\b(?:is|are|was|were|show|shows|showed|using|based|proposed|trained|evaluated)\b",
        text,
        re.I,
    ):
        return 0
    return None


def take(pool: list[dict], n: int) -> list[dict]:
    if n <= 0 or not pool:
        return []
    random.shuffle(pool)
    return pool[:n]


def add_row(
    buckets: dict[int, list[dict]],
    seen: set[str],
    text: str,
    hard_neg: dict[int, list[dict]] | None = None,
    force_label: int | None = None,
) -> bool:
    clean = clean_sentence(text)
    wc = len(clean.split())
    if wc < 8 or wc > 65:
        return False
    if not re.search(r"[A-Za-z]{3,}", clean):
        return False
    key = clean.lower()
    if key in seen:
        return False
    label = force_label if force_label is not None else weak_label(clean)
    if label is None:
        return False
    if label == 0 and len(buckets[0]) >= CAP_NONE_POOL:
        return False
    if label > 0 and len(buckets[label]) >= CAP_POS_POOL:
        return False
    seen.add(key)
    row = {"text": clean, "label": label}
    buckets[label].append(row)
    if hard_neg is not None and label == 0:
        if NOVELTY_SUBSTANTIATED_RE.search(clean) or NUM_PRECISE_RE.search(clean):
            hard_neg[0].append(row)
    return True


def clause_from(sent: str) -> str:
    s = sent.strip().rstrip(".")
    # Lowercase first letter for embedding in templates
    if s and s[0].isupper() and not s[:2].isupper():
        s = s[0].lower() + s[1:]
    # Keep short enough
    words = s.split()
    if len(words) > 28:
        s = " ".join(words[:28])
    return s


def synthesize_positives(
    clean_pool: list[str],
    buckets: dict[int, list[dict]],
    seen: set[str],
    need: dict[int, int],
) -> None:
    random.shuffle(clean_pool)
    idx = 0
    templates = {
        1: SYNTH_NUM,
        2: SYNTH_PUB,
        3: SYNTH_NOVELTY,
    }
    for label, n_need in need.items():
        made = 0
        while made < n_need and idx < len(clean_pool) * 3:
            base = clean_pool[idx % len(clean_pool)]
            idx += 1
            tmpl = random.choice(templates[label])
            text = tmpl.format(clause=clause_from(base))
            if add_row(buckets, seen, text, force_label=label):
                made += 1
        print(f"synthesized label={LABEL_NAMES[label]} +{made}")


def ingest_blob(
    blob: str,
    buckets: dict[int, list[dict]],
    seen: set[str],
    hard_neg: dict[int, list[dict]],
    clean_pool: list[str],
) -> None:
    for sent in SENT_SPLIT_RE.split(blob):
        before0 = len(buckets[0])
        ok = add_row(buckets, seen, sent, hard_neg)
        if ok and len(buckets[0]) > before0 and len(clean_pool) < 80_000:
            # keep clean none sentences for synthesis
            clean_pool.append(buckets[0][-1]["text"])


def ingest_rewrite(
    buckets: dict[int, list[dict]],
    seen: set[str],
    hard_neg: dict[int, list[dict]],
    clean_pool: list[str],
) -> int:
    if not REWRITE_DIR.exists():
        return 0
    n = 0
    for path in sorted(REWRITE_DIR.glob("*.jsonl")):
        try:
            with open(path, encoding="utf-8") as f:
                for line in f:
                    try:
                        row = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    for key in ("source", "target", "text", "sentence", "original"):
                        val = row.get(key)
                        if isinstance(val, str) and len(val) > 40:
                            b = sum(len(v) for v in buckets.values())
                            ingest_blob(val, buckets, seen, hard_neg, clean_pool)
                            n += sum(len(v) for v in buckets.values()) - b
        except OSError:
            continue
    return n


def ingest_hf_arxiv(
    buckets: dict[int, list[dict]],
    seen: set[str],
    hard_neg: dict[int, list[dict]],
    clean_pool: list[str],
    max_docs: int = 50_000,
) -> int:
    try:
        import truststore

        truststore.inject_into_ssl()
        from datasets import load_dataset
    except Exception as e:
        print(f"HF arxiv skipped (import): {e}")
        return 0
    try:
        ds = load_dataset(
            "armanc/scientific_papers",
            "arxiv",
            split="train",
            streaming=True,
            trust_remote_code=True,
        )
    except Exception as e:
        print(f"HF arxiv skipped (load): {e}")
        return 0
    n_docs = added = 0
    for row in ds:
        if n_docs >= max_docs:
            break
        n_docs += 1
        abstract = row.get("abstract") or ""
        b = sum(len(v) for v in buckets.values())
        ingest_blob(abstract, buckets, seen, hard_neg, clean_pool)
        added += sum(len(v) for v in buckets.values()) - b
        if n_docs % 10_000 == 0:
            print(f"  arxiv docs={n_docs} pools={{k: len(v) for k,v in buckets.items()}}".replace(
                "{k: len(v) for k,v in buckets.items()}",
                str({LABEL_NAMES[k]: len(v) for k, v in buckets.items()}),
            ))
    print(f"HF arxiv: docs={n_docs} added~{added}")
    return added


def main() -> None:
    # Fix accidental double-escape in NUM_PRECISE if present
    global NUM_PRECISE_RE
    NUM_PRECISE_RE = re.compile(
        r"\b(?:p\s*[<=]\s*0?\.\d+|95\s*%\s*CI|confidence\s+interval|"
        r"n\s*=\s*\d+|N\s*=\s*\d+|mean\s*[+/-]\s*\d|"
        r"\d+(?:\.\d+)?\s*%\s*\(\s*\d+\s*/\s*\d+\s*\)|"
        r"\d+(?:\.\d+)?\s*\+/-\s*\d+(?:\.\d+)?)\b",
        re.IGNORECASE,
    )

    if not RAW_PATH.exists():
        raise SystemExit(f"Missing {RAW_PATH}")

    buckets: dict[int, list[dict]] = {0: [], 1: [], 2: [], 3: []}
    hard_neg: dict[int, list[dict]] = {0: []}
    seen: set[str] = set()
    clean_pool: list[str] = []
    blobs = 0

    print(f"scanning unarXive up to {MAX_BLOBS} blobs...")
    with open(RAW_PATH, encoding="utf-8") as f:
        for line in f:
            if blobs >= MAX_BLOBS:
                break
            if len(buckets[0]) >= CAP_NONE_POOL and all(
                len(buckets[i]) >= CAP_POS_POOL for i in (1, 2, 3)
            ):
                print("all pools at cap")
                break
            blobs += 1
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            ingest_blob(row.get("text") or "", buckets, seen, hard_neg, clean_pool)
            if blobs % 25_000 == 0:
                print(
                    f"blobs={blobs} pools={[LABEL_NAMES[k]+'='+str(len(buckets[k])) for k in range(4)]} "
                    f"clean_pool={len(clean_pool)}"
                )

    print("after unarXive:", {LABEL_NAMES[k]: len(v) for k, v in buckets.items()})
    rw = ingest_rewrite(buckets, seen, hard_neg, clean_pool)
    print(f"rewrite extras~{rw}", {LABEL_NAMES[k]: len(v) for k, v in buckets.items()})

    # Optional HF abstracts (SKIP_HF=1 default — stream can hang on Windows)
    if os.environ.get("SKIP_HF", "1") != "1":
        print("ingesting HF arXiv abstracts...")
        ingest_hf_arxiv(buckets, seen, hard_neg, clean_pool, max_docs=50_000)
        print("after arxiv:", {LABEL_NAMES[k]: len(v) for k, v in buckets.items()})
    else:
        print("SKIP_HF=1 — unarXive + rewrite_data + template synthesis only")

    # Synthesize scarce positives from clean open sentences
    need = {
        i: max(0, TARGET_PER_POS - len(buckets[i])) for i in (1, 2, 3)
    }
    if any(need.values()) and clean_pool:
        print("synthesizing positives from open clean sentences:", need)
        synthesize_positives(clean_pool, buckets, seen, need)
    print("after synth:", {LABEL_NAMES[k]: len(v) for k, v in buckets.items()})

    selected: list[dict] = []
    hard_rows = take(hard_neg[0], min(len(hard_neg[0]), 18_000))
    hard_keys = {r["text"] for r in hard_rows}
    none_rest = [r for r in buckets[0] if r["text"] not in hard_keys]
    selected += hard_rows
    selected += take(none_rest, max(0, TARGET_NONE - len(hard_rows)))
    for i in (1, 2, 3):
        selected += take(buckets[i], min(TARGET_PER_POS, len(buckets[i])))

    random.shuffle(selected)
    n = len(selected)
    print(f"selected total={n}")
    if n < 100_000:
        print("WARNING: selected <100k")

    n_train = int(n * 0.8)
    n_val = int(n * 0.1)
    splits = {
        "train": selected[:n_train],
        "val": selected[n_train : n_train + n_val],
        "test": selected[n_train + n_val :],
    }
    for name, rows in splits.items():
        path = HERE / f"quality_{name}.jsonl"
        with open(path, "w", encoding="utf-8") as out:
            for r in rows:
                out.write(json.dumps(r, ensure_ascii=False) + "\n")
        c = Counter(r["label"] for r in rows)
        print(f"{name}: {len(rows)}  " + " ".join(f"{LABEL_NAMES[k]}={c[k]}" for k in range(4)))

    meta = {
        "source": "unarXive citrec + rewrite_data + armanc/scientific_papers arxiv + template synth on open sentences",
        "labeling": "weak seeds + hard negatives + template augmentation",
        "labels": LABEL_NAMES,
        "blobs_scanned": blobs,
        "selected_total": n,
        "pool_counts": {LABEL_NAMES[k]: len(v) for k, v in buckets.items()},
        "hard_neg_none": len(hard_neg[0]),
        "targets": {"none": TARGET_NONE, "per_pos": TARGET_PER_POS},
    }
    (HERE / "quality_data_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print("wrote quality_{train,val,test}.jsonl")


if __name__ == "__main__":
    main()

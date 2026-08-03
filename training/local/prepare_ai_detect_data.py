"""
Prepare passage-level data for the academic AI-writing detector.

Label: 1 = machine-generated, 0 = human-written.

Sources (all license-clear, documented in training/README.md):
  - yaful/MAGE            (Apache-2.0)   human + 27-LLM text, 10 domains; OOD/paraphrase test sets
  - tum-nlp/IDMGSP        (OpenRAIL++)   real vs machine-generated scientific papers
  - Hello-SimpleAI/HC3    (CC-BY-SA-4.0) human vs ChatGPT answers
  - mithu-ngl/SciHRA-Detect (open)       human vs AI scientific abstracts
  - local raw_train.jsonl (unarXive, CC-BY) extra human academic passages

Outputs in training/local/:
  ai_detect_train.jsonl / ai_detect_val.jsonl / ai_detect_test.jsonl   (in-distribution)
  ai_detect_test_mage_ood.jsonl        cross-generator OOD (GPT-4 etc.)
  ai_detect_test_mage_para.jsonl       paraphrase-attack OOD
  ai_detect_test_idmgsp_ood.jsonl      IDMGSP ood_gpt3 + ood_real + tecg (academic OOD)
  ai_detect_data_meta.json

Usage: python prepare_ai_detect_data.py
"""
from __future__ import annotations

import csv
import gzip
import io
import json
import random
import re
import sys
import zipfile
from collections import Counter
from pathlib import Path

import truststore

truststore.inject_into_ssl()

from huggingface_hub import hf_hub_download

HERE = Path(__file__).parent
SEED = 42
rng = random.Random(SEED)

# passage construction
MIN_CHARS = 180
MAX_CHARS = 900
TARGET_CHARS = 550

# per-source caps (passages)
CAP_MAGE_TRAIN = 110_000
CAP_IDMGSP = 70_000
CAP_HC3 = 45_000
CAP_SCIHRA = 20_000
CAP_UNARXIVE_HUMAN = 45_000

CITE_MARKER = re.compile(r"\s*\[[0-9,\s\-]+\]\}?|\s*\((?:[A-Z][A-Za-z\-]+(?: et al\.?)?,? \d{4}[a-z]?(?:; ?)?)+\)")
WS = re.compile(r"\s+")
SENT_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z(])")


def clean(text: str) -> str:
    text = CITE_MARKER.sub("", text)
    text = text.replace("\xa0", " ")
    return WS.sub(" ", text).strip()


def to_passages(text: str) -> list[str]:
    """Pack sentences into passages of roughly TARGET_CHARS."""
    text = clean(text)
    if len(text) < MIN_CHARS:
        return []
    sents = SENT_SPLIT.split(text)
    out, buf = [], ""
    for s in sents:
        s = s.strip()
        if not s:
            continue
        if buf and len(buf) + len(s) + 1 > TARGET_CHARS:
            if len(buf) >= MIN_CHARS:
                out.append(buf[:MAX_CHARS])
            buf = s
        else:
            buf = f"{buf} {s}".strip()
    if len(buf) >= MIN_CHARS:
        out.append(buf[:MAX_CHARS])
    return out


def looks_valid(p: str) -> bool:
    if len(p) < MIN_CHARS:
        return False
    letters = sum(c.isalpha() for c in p)
    if letters / max(len(p), 1) < 0.6:
        return False
    words = p.split()
    if len(words) < 25:
        return False
    return True


def rows_from(texts, label: int, source: str, cap: int) -> list[dict]:
    out = []
    for t in texts:
        for p in to_passages(t):
            if looks_valid(p):
                out.append({"text": p, "label": label, "source": source})
        if len(out) >= cap:
            break
    return out[:cap]


# ----------------------------------------------------------------- MAGE
def load_mage():
    print("=== MAGE (Apache-2.0) ===", flush=True)

    def read_csv(name):
        path = hf_hub_download("yaful/MAGE", name, repo_type="dataset")
        rows = []
        csv.field_size_limit(10_000_000)
        with open(path, encoding="utf-8-sig", errors="replace", newline="") as f:
            for r in csv.DictReader(f):
                txt = (r.get("text") or "").strip()
                lab = r.get("label")
                src = (r.get("src") or "").strip()
                if not txt or lab not in ("0", "1", 0, 1):
                    continue
                # MAGE: 1 = human, 0 = machine  ->  ours: 1 = machine
                rows.append({"text": txt, "label": 1 - int(lab), "source": f"mage:{src[:40]}"})
        return rows

    def passage_rows(raw, cap, name):
        human = [r for r in raw if r["label"] == 0]
        machine = [r for r in raw if r["label"] == 1]
        rng.shuffle(human)
        rng.shuffle(machine)
        out = []
        out += rows_from((r["text"] for r in machine), 1, f"mage_{name}", cap // 2)
        out += rows_from((r["text"] for r in human), 0, f"mage_{name}", cap // 2)
        return out

    train = passage_rows(read_csv("train.csv"), CAP_MAGE_TRAIN, "train")
    valid = passage_rows(read_csv("valid.csv"), 20_000, "valid")
    test = passage_rows(read_csv("test.csv"), 20_000, "test")
    ood = passage_rows(read_csv("test_ood_set_gpt.csv"), 10_000, "ood")
    para = passage_rows(read_csv("test_ood_set_gpt_para.csv"), 10_000, "para")
    print(f"  train={len(train)} valid={len(valid)} test={len(test)} ood={len(ood)} para={len(para)}")
    return train, valid, test, ood, para


# ----------------------------------------------------------------- IDMGSP
def load_idmgsp():
    print("=== IDMGSP (OpenRAIL++) ===", flush=True)

    def read_zip(name):
        path = hf_hub_download("tum-nlp/IDMGSP", name, repo_type="dataset")
        rows = []
        with zipfile.ZipFile(path) as z:
            for member in z.namelist():
                if not member.endswith(".csv"):
                    continue
                with z.open(member) as f:
                    reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8", errors="replace"))
                    for r in reader:
                        label = r.get("label")
                        if label not in ("0", "1"):
                            continue
                        sections = [r.get("abstract") or "", r.get("introduction") or "", r.get("conclusion") or ""]
                        src = (r.get("src") or member).strip()
                        rows.append({"sections": sections, "label": int(label), "src": src, "file": member})
        return rows

    def passage_rows(raw, cap, name):
        rng.shuffle(raw)
        out = []
        per_label_cap = cap // 2
        counts = Counter()
        for r in raw:
            lab = r["label"]
            if counts[lab] >= per_label_cap:
                continue
            for sec in r["sections"]:
                for p in to_passages(sec):
                    if looks_valid(p) and counts[lab] < per_label_cap:
                        out.append({"text": p, "label": lab, "source": f"idmgsp_{name}:{r['src'][:30]}"})
                        counts[lab] += 1
        return out

    train_raw = read_zip("classifier_input.zip")
    # classifier_input.zip holds both train and test CSVs; separate by filename
    train_part = [r for r in train_raw if "train" in r["file"].lower()]
    test_part = [r for r in train_raw if "test" in r["file"].lower()]
    if not test_part:  # fallback: carve a holdout
        rng.shuffle(train_raw)
        cut = int(0.85 * len(train_raw))
        train_part, test_part = train_raw[:cut], train_raw[cut:]

    ood_raw = []
    for zname in ("ood_gpt3.zip", "ood_real.zip", "tecg.zip"):
        try:
            ood_raw += read_zip(zname)
        except Exception as e:
            print(f"  skip {zname}: {e}")

    train = passage_rows(train_part, CAP_IDMGSP, "train")
    test = passage_rows(test_part, 24_000, "test")
    ood = passage_rows(ood_raw, 20_000, "ood")
    print(f"  train={len(train)} test={len(test)} ood={len(ood)}")
    return train, test, ood


# ----------------------------------------------------------------- HC3
def load_hc3():
    print("=== HC3 (CC-BY-SA-4.0) ===", flush=True)
    path = hf_hub_download("Hello-SimpleAI/HC3", "all.jsonl", repo_type="dataset")
    human_texts, ai_texts = [], []
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue
            human_texts += [a for a in (r.get("human_answers") or []) if a]
            ai_texts += [a for a in (r.get("chatgpt_answers") or []) if a]
    rng.shuffle(human_texts)
    rng.shuffle(ai_texts)
    out = rows_from(ai_texts, 1, "hc3", CAP_HC3 // 2) + rows_from(human_texts, 0, "hc3", CAP_HC3 // 2)
    print(f"  rows={len(out)}")
    return out


# ----------------------------------------------------------------- SciHRA
def load_scihra():
    print("=== SciHRA-Detect (open) ===", flush=True)
    path = hf_hub_download("mithu-ngl/SciHRA-Detect", "scihra_detect.csv", repo_type="dataset")
    human_texts, ai_texts = [], []
    with open(path, encoding="utf-8", errors="replace", newline="") as f:
        for r in csv.DictReader(f):
            h = (r.get("hgt") or "").strip()
            a = (r.get("agt") or "").strip()
            v = (r.get("art") or "").strip()  # AI-revised: still machine
            if h:
                human_texts.append(h)
            if a:
                ai_texts.append(a)
            if v:
                ai_texts.append(v)
    out = rows_from(ai_texts, 1, "scihra", CAP_SCIHRA // 2) + rows_from(human_texts, 0, "scihra", CAP_SCIHRA // 2)
    print(f"  rows={len(out)}")
    return out


# ----------------------------------------------------------------- unarXive human
def load_unarxive_human():
    print("=== unarXive human passages (CC-BY) ===", flush=True)
    path = HERE / "raw_train.jsonl"
    if not path.exists():
        print("  raw_train.jsonl missing, skipping")
        return []
    out = []
    with open(path, encoding="utf-8", errors="replace") as f:
        for i, line in enumerate(f):
            if len(out) >= CAP_UNARXIVE_HUMAN:
                break
            if i % 7:  # stride to diversify papers without reading 5.8 GB fully
                continue
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue
            for p in to_passages(r.get("text") or ""):
                if looks_valid(p):
                    out.append({"text": p, "label": 0, "source": "unarxive"})
                    break  # one passage per blob for diversity
    print(f"  rows={len(out)}")
    return out


# ----------------------------------------------------------------- assemble
def dedupe(rows):
    seen, out = set(), []
    for r in rows:
        key = r["text"][:160].lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out


def write_jsonl(rows, name):
    p = HERE / f"{name}.jsonl"
    with p.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    c = Counter(r["label"] for r in rows)
    print(f"  {p.name}: {len(rows)} (machine={c[1]} human={c[0]})")
    return {"n": len(rows), "machine": c[1], "human": c[0]}


def main():
    mage_train, mage_valid, mage_test, mage_ood, mage_para = load_mage()
    idm_train, idm_test, idm_ood = load_idmgsp()
    hc3 = load_hc3()
    scihra = load_scihra()
    unarx = load_unarxive_human()

    pool = dedupe(mage_train + idm_train + hc3 + scihra + unarx)
    rng.shuffle(pool)

    # in-distribution val/test from MAGE valid + IDMGSP test + a slice of the pool
    cut = int(0.97 * len(pool))
    train_rows = pool[:cut]
    extra_holdout = pool[cut:]
    val_pool = dedupe(mage_valid + extra_holdout[: len(extra_holdout) // 2])
    test_pool = dedupe(mage_test + idm_test + extra_holdout[len(extra_holdout) // 2 :])
    rng.shuffle(val_pool)
    rng.shuffle(test_pool)

    # guard: no leakage between train and eval sets
    train_keys = {r["text"][:160].lower() for r in train_rows}
    val_pool = [r for r in val_pool if r["text"][:160].lower() not in train_keys]
    test_pool = [r for r in test_pool if r["text"][:160].lower() not in train_keys]

    print("\n=== writing splits ===")
    meta = {
        "train": write_jsonl(train_rows, "ai_detect_train"),
        "val": write_jsonl(val_pool[:15_000], "ai_detect_val"),
        "test": write_jsonl(test_pool[:30_000], "ai_detect_test"),
        "test_mage_ood": write_jsonl(mage_ood, "ai_detect_test_mage_ood"),
        "test_mage_para": write_jsonl(mage_para, "ai_detect_test_mage_para"),
        "test_idmgsp_ood": write_jsonl(idm_ood, "ai_detect_test_idmgsp_ood"),
        "sources": dict(Counter(r["source"].split(":")[0] for r in train_rows)),
        "datasets": {
            "yaful/MAGE": "apache-2.0",
            "tum-nlp/IDMGSP": "openrail++",
            "Hello-SimpleAI/HC3": "cc-by-sa-4.0",
            "mithu-ngl/SciHRA-Detect": "open (research)",
            "unarXive (local raw_train.jsonl)": "cc-by",
        },
    }
    (HERE / "ai_detect_data_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print("\ndone; meta written to ai_detect_data_meta.json")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main()

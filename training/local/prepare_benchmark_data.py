"""
Prepare training data from open benchmark datasets for above-baseline model training.

Datasets used (all MIT/Apache/open research licenses):
1. JonathanZha/PADBen (MIT) - 487K AI text detection / paraphrase attack samples
2. taln-ls2n/pararev (Open) - 48K scientific paragraph revisions
3. linzw/PASTED (Open) - 83K fine-grained AI paraphrase span detection
4. google-research-datasets/paws (Open) - 108K paraphrase pairs

This creates combined multi-task training data for:
- Plagiarism/paraphrase detection and revision
- AI text detection and humanization
- Report-driven debugging assistance

Usage:
  python prepare_benchmark_data.py
  python prepare_benchmark_data.py --max-samples 50000
"""
from __future__ import annotations

import argparse
import json
import random
from pathlib import Path
from typing import Iterator

import truststore

truststore.inject_into_ssl()

from datasets import load_dataset, DownloadMode

HERE = Path(__file__).parent
OUT = HERE / "rewrite_data"
SEED = 42

TASK_PREFIXES = {
    "plag": "paraphrase scientific text: ",
    "ai": "humanize AI scientific writing: ",
    "report_plag": "revise similarity-flagged text: ",
    "report_ai": "revise AI-flagged text: ",
    "detect_ai": "classify if AI-written: ",
    "paraphrase": "paraphrase the following: ",
}


def _write_splits(rows: list[dict], prefix: str, seed: int = SEED) -> dict[str, int]:
    rng = random.Random(seed)
    rng.shuffle(rows)
    n = len(rows)
    splits = {
        "train": rows[: int(0.8 * n)],
        "val": rows[int(0.8 * n) : int(0.9 * n)],
        "test": rows[int(0.9 * n) :],
    }
    counts = {}
    for name, subset in splits.items():
        path = OUT / f"{prefix}_{name}.jsonl"
        with path.open("w", encoding="utf-8") as f:
            for r in subset:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        counts[name] = len(subset)
        print(f"  {path.name}: {len(subset)}")
    return counts


def prepare_padben(max_samples: int = 100_000) -> list[dict]:
    """
    PADBen: Paraphrase and AI-Generated Text Detection Benchmark
    MIT License - 487K samples across 10 task types
    
    We extract samples useful for:
    1. AI text classification (train detection)
    2. Paraphrase source attribution (train understanding)
    3. Original vs paraphrased (train revision)
    """
    print("\n=== Loading JonathanZha/PADBen (MIT License) ===")
    rows = []
    
    try:
        configs = [
            "sentence-pair-task1",  # Paraphrase source attribution
            "sentence-pair-task2",  # General text authorship
            "sentence-pair-task5",  # Original vs deep paraphrase
        ]
        
        for config in configs:
            try:
                print(f"  Loading config: {config}")
                ds = load_dataset("JonathanZha/PADBen", config, split="train")
                
                for ex in ds:
                    if len(rows) >= max_samples:
                        break
                    
                    text1 = (ex.get("sentence1") or ex.get("text1") or ex.get("original") or "").strip()
                    text2 = (ex.get("sentence2") or ex.get("text2") or "").strip()
                    label = ex.get("label", ex.get("is_ai", None))
                    
                    if len(text1) < 50 or len(text2) < 50:
                        continue
                    
                    if label in (0, "human", "original"):
                        rows.append({
                            "task": "ai_humanize",
                            "instruction": "rewrite AI-like text to sound more natural",
                            "input": text2,
                            "target": text1,
                        })
                    elif label in (1, "ai", "paraphrased"):
                        rows.append({
                            "task": "paraphrase",
                            "instruction": "paraphrase while preserving meaning",
                            "input": text1,
                            "target": text2,
                        })
                        
                if len(rows) >= max_samples:
                    break
                    
            except Exception as e:
                print(f"    Skip {config}: {type(e).__name__}: {str(e)[:80]}")
                continue
                
    except Exception as e:
        print(f"  PADBen loading failed: {e}")
    
    print(f"  PADBen: collected {len(rows)} pairs")
    return rows[:max_samples]


def prepare_pararev(max_samples: int = 40_000) -> list[dict]:
    """
    ParaRev: Scientific Paragraph Revision Dataset
    48K revised scientific paragraphs with revision instructions
    Open license (research use)
    """
    print("\n=== Loading taln-ls2n/pararev (Open License) ===")
    rows = []
    
    try:
        ds = load_dataset("taln-ls2n/pararev", "pararev_full", split="train")
        
        cols = set(ds.column_names)
        print(f"  Columns: {sorted(cols)}")
        
        # ParaRev uses parag_1 (original) -> parag_2 (revised)
        src_key = next((k for k in ("parag_1", "original", "source", "before", "paragraph", "text") if k in cols), None)
        tgt_key = next((k for k in ("parag_2", "revised", "target", "after", "revision") if k in cols), None)
        
        if not src_key or not tgt_key:
            str_cols = [c for c in ds.column_names if ds[0] and isinstance(ds[0].get(c), str)]
            if len(str_cols) >= 2:
                src_key, tgt_key = str_cols[0], str_cols[1]
        
        print(f"  Using: {src_key} -> {tgt_key}")
        
        for ex in ds:
            if len(rows) >= max_samples:
                break
                
            src = (ex.get(src_key) or "").strip()
            tgt = (ex.get(tgt_key) or "").strip()
            instruction = ex.get("instruction", ex.get("revision_instruction", ""))
            
            if len(src) < 80 or len(tgt) < 80:
                continue
            if src.lower() == tgt.lower():
                continue
                
            rows.append({
                "task": "scientific_revision",
                "instruction": instruction or "revise scientific paragraph for clarity",
                "input": src,
                "target": tgt,
            })
            
    except Exception as e:
        print(f"  ParaRev loading failed: {e}")
    
    print(f"  ParaRev: collected {len(rows)} pairs")
    return rows[:max_samples]


def prepare_pasted(max_samples: int = 50_000) -> list[dict]:
    """
    PASTED: Paraphrased Text Span Detection
    83K instances for fine-grained AI paraphrase detection
    """
    print("\n=== Loading linzw/PASTED (Open License) ===")
    rows = []
    
    try:
        for config in ["classification", "text-classification"]:
            try:
                ds = load_dataset("linzw/PASTED", config, split="train")
                print(f"  Loaded config: {config}, columns: {ds.column_names}")
                
                for ex in ds:
                    if len(rows) >= max_samples:
                        break
                    
                    original = (ex.get("original") or ex.get("original_text") or ex.get("text") or "").strip()
                    paraphrased = (ex.get("paraphrased") or ex.get("paraphrased_text") or ex.get("text_modified") or "").strip()
                    
                    if not paraphrased and "modified" in str(ds.column_names).lower():
                        for k in ds.column_names:
                            if "modif" in k.lower() or "para" in k.lower():
                                paraphrased = (ex.get(k) or "").strip()
                                if paraphrased:
                                    break
                    
                    if len(original) < 60:
                        continue
                    
                    if len(paraphrased) >= 60 and original.lower() != paraphrased.lower():
                        rows.append({
                            "task": "paraphrase_detection",
                            "instruction": "humanize AI-paraphrased text",
                            "input": paraphrased,
                            "target": original,
                        })
                    elif "label" in ex and ex.get("label") in (1, "paraphrased", True):
                        rows.append({
                            "task": "ai_detection",
                            "instruction": "identify if text contains AI paraphrasing",
                            "input": original,
                            "target": "This text shows AI paraphrasing patterns.",
                        })
                        
                if len(rows) >= max_samples:
                    break
                    
            except Exception as e:
                print(f"    Skip config {config}: {e}")
                continue
                
    except Exception as e:
        print(f"  PASTED loading failed: {e}")
    
    print(f"  PASTED: collected {len(rows)} pairs")
    return rows[:max_samples]


def prepare_paws_wiki(max_samples: int = 60_000) -> list[dict]:
    """
    PAWS-Wiki: Paraphrase Adversaries from Word Scrambling
    108K human-labeled paraphrase pairs from Wikipedia
    Google open license
    """
    print("\n=== Loading google-research-datasets/paws (Open License) ===")
    rows = []
    
    try:
        for config in ["labeled_final", "labeled_swap", None]:
            try:
                if config:
                    ds = load_dataset("google-research-datasets/paws", config, split="train")
                else:
                    ds = load_dataset("google-research-datasets/paws", split="train")
                print(f"  Loaded config: {config}, size: {len(ds)}")
                
                for ex in ds:
                    if len(rows) >= max_samples:
                        break
                    
                    s1 = (ex.get("sentence1") or "").strip()
                    s2 = (ex.get("sentence2") or "").strip()
                    label = ex.get("label", 1)
                    
                    if len(s1) < 40 or len(s2) < 40:
                        continue
                    
                    if label == 1 and s1.lower() != s2.lower():
                        rows.append({
                            "task": "paraphrase",
                            "instruction": "paraphrase the sentence",
                            "input": s1,
                            "target": s2,
                        })
                        rows.append({
                            "task": "paraphrase",
                            "instruction": "paraphrase the sentence",
                            "input": s2,
                            "target": s1,
                        })
                        
                if len(rows) >= max_samples:
                    break
                    
            except Exception as e:
                print(f"    Skip config {config}: {e}")
                continue
                
    except Exception as e:
        print(f"  PAWS loading failed: {e}")
    
    print(f"  PAWS-Wiki: collected {len(rows)} pairs")
    return rows[:max_samples]


def prepare_existing_sources(max_samples: int = 80_000) -> tuple[list[dict], list[dict]]:
    """Load existing ParaSCI and SciHRA data from prepare_rewrite_data.py sources."""
    print("\n=== Loading existing sources (HHousen/ParaSCI + mithu-ngl/SciHRA-Detect) ===")
    plag_rows = []
    ai_rows = []
    
    try:
        print("  Loading HHousen/ParaSCI...")
        for kwargs in (
            {"path": "HHousen/ParaSCI", "split": "train"},
            {"path": "HHousen/ParaSCI", "name": "arxiv", "split": "train"},
            {"path": "HHousen/ParaSCI", "name": "acl", "split": "train"}):
            try:
                ds = load_dataset(kwargs["path"], split=kwargs.get("split", "train"), name=kwargs.get("name"))
                print(f"    Loaded: {kwargs}")
                
                cols = set(ds.column_names)
                src_key = next((k for k in ("sentence1", "src", "source") if k in cols), None)
                tgt_key = next((k for k in ("sentence2", "tgt", "target") if k in cols), None)
                
                if not src_key or not tgt_key:
                    str_cols = [c for c in ds.column_names if isinstance(ds[0][c], str)]
                    if len(str_cols) >= 2:
                        src_key, tgt_key = str_cols[0], str_cols[1]
                
                for ex in ds:
                    if len(plag_rows) >= max_samples:
                        break
                    src = (ex.get(src_key) or "").strip()
                    tgt = (ex.get(tgt_key) or "").strip()
                    if len(src) < 40 or len(tgt) < 40:
                        continue
                    if src.lower() == tgt.lower():
                        continue
                    plag_rows.append({
                        "task": "plagiarism",
                        "instruction": "paraphrase scientific sentence",
                        "input": src,
                        "target": tgt,
                    })
                break
            except Exception as e:
                print(f"    Skip {kwargs}: {e}")
                continue
                
    except Exception as e:
        print(f"  ParaSCI failed: {e}")
    
    try:
        print("  Loading mithu-ngl/SciHRA-Detect...")
        ds = load_dataset("mithu-ngl/SciHRA-Detect", split="train")
        
        for ex in ds:
            if len(ai_rows) >= max_samples // 2:
                break
            human = (ex.get("hgt") or "").strip()
            ai_text = (ex.get("agt") or "").strip()
            revised = (ex.get("art") or "").strip()
            
            if len(human) < 80:
                continue
            if len(ai_text) >= 80:
                ai_rows.append({
                    "task": "ai_humanize",
                    "instruction": "rewrite AI scientific abstract as natural human prose",
                    "input": ai_text,
                    "target": human,
                })
            if len(revised) >= 80 and revised.lower() != human.lower():
                ai_rows.append({
                    "task": "ai_humanize",
                    "instruction": "rewrite AI-revised abstract toward original human voice",
                    "input": revised,
                    "target": human,
                })
                
    except Exception as e:
        print(f"  SciHRA failed: {e}")
    
    print(f"  ParaSCI: {len(plag_rows)}, SciHRA: {len(ai_rows)}")
    return plag_rows, ai_rows


def combine_and_deduplicate(all_rows: list[dict], max_total: int) -> list[dict]:
    """Deduplicate by input text and limit total size."""
    seen = set()
    unique = []
    for r in all_rows:
        key = (r.get("input") or "")[:200].lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(r)
    
    random.Random(SEED).shuffle(unique)
    return unique[:max_total]


def create_report_wrapped(rows: list[dict], task_type: str) -> list[dict]:
    """Create report-wrapped versions for report-driven training."""
    rng = random.Random(SEED)
    out = []
    
    plag_prefix = (
        "similarity report flagged this passage (~{pct}% match; source: {src}). "
        "Restate in your own words; keep technical terms and any citation markers: "
    )
    ai_prefix = (
        "AI writing report flagged this passage (high machine-like confidence). "
        "Revise for specificity, varied rhythm, and author voice; keep citation markers: "
    )
    
    for r in rows:
        inp = (r.get("input") or "").strip()
        tgt = (r.get("target") or "").strip()
        if len(inp) < 40 or len(tgt) < 40:
            continue
        
        if task_type == "plag":
            pct = rng.choice([2, 3, 4, 5, 6, 8, 12])
            src = rng.choice([
                "indexed publication",
                "internet source",
                "prior work in reference list",
                "unidentified repository match",
            ])
            out.append({
                "input": plag_prefix.format(pct=pct, src=src) + inp,
                "target": tgt,
                "meta": {"task": "report_plag", "match_pct": pct, "source_cue": src},
            })
        else:
            out.append({
                "input": ai_prefix + inp,
                "target": tgt,
                "meta": {"task": "report_ai"},
            })
    
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-samples", type=int, default=150_000, help="Max samples per dataset")
    ap.add_argument("--force", action="store_true", help="Rebuild even if data exists")
    args = ap.parse_args()
    
    OUT.mkdir(parents=True, exist_ok=True)
    
    existing_data = list(OUT.glob("*.jsonl"))
    if existing_data and not args.force:
        print(f"Data already exists ({len(existing_data)} files). Use --force to rebuild.")
        print("Files:", [f.name for f in existing_data[:10]])
        return
    
    print("=" * 60)
    print("BENCHMARK DATA PREPARATION")
    print("=" * 60)
    print(f"Max samples per dataset: {args.max_samples}")
    print()
    
    all_plag = []
    all_ai = []
    
    parasci, scihra = prepare_existing_sources(args.max_samples)
    all_plag.extend(parasci)
    all_ai.extend(scihra)
    
    padben = prepare_padben(args.max_samples)
    for r in padben:
        if r.get("task") == "paraphrase":
            all_plag.append(r)
        else:
            all_ai.append(r)
    
    pararev = prepare_pararev(args.max_samples)
    for r in pararev:
        all_plag.append(r)
    
    pasted = prepare_pasted(args.max_samples)
    for r in pasted:
        if "ai" in r.get("task", "").lower() or "detection" in r.get("task", "").lower():
            all_ai.append(r)
        else:
            all_plag.append(r)
    
    paws = prepare_paws_wiki(args.max_samples)
    all_plag.extend(paws)
    
    print("\n" + "=" * 60)
    print("COMBINING AND DEDUPLICATING")
    print("=" * 60)
    
    all_plag = combine_and_deduplicate(all_plag, args.max_samples)
    all_ai = combine_and_deduplicate(all_ai, args.max_samples // 2)
    
    print(f"  Plagiarism/paraphrase pairs: {len(all_plag)}")
    print(f"  AI humanization pairs: {len(all_ai)}")
    
    print("\n--- Writing plag splits ---")
    plag_counts = _write_splits(all_plag, "plag")
    
    print("\n--- Writing ai splits ---")
    ai_counts = _write_splits(all_ai, "ai")
    
    print("\n--- Creating report-wrapped data ---")
    report_plag = create_report_wrapped(all_plag, "plag")
    report_ai = create_report_wrapped(all_ai, "ai")
    
    print("\n--- Writing report_plag splits ---")
    _write_splits(report_plag, "report_plag")
    
    print("\n--- Writing report_ai splits ---")
    _write_splits(report_ai, "report_ai")
    
    summary = {
        "datasets_used": [
            {"name": "JonathanZha/PADBen", "license": "MIT", "type": "AI detection / paraphrase"},
            {"name": "taln-ls2n/pararev", "license": "Open (research)", "type": "Scientific revision"},
            {"name": "linzw/PASTED", "license": "Open (research)", "type": "Paraphrase span detection"},
            {"name": "google-research-datasets/paws", "license": "Google Open", "type": "Paraphrase pairs"},
            {"name": "HHousen/ParaSCI", "license": "Open (research)", "type": "Scientific paraphrase"},
            {"name": "mithu-ngl/SciHRA-Detect", "license": "Open (research)", "type": "AI abstract humanization"},
        ],
        "splits": {
            "plag": plag_counts,
            "ai": ai_counts,
            "report_plag": {"train": len(report_plag) * 8 // 10, "val": len(report_plag) // 10},
            "report_ai": {"train": len(report_ai) * 8 // 10, "val": len(report_ai) // 10},
        },
        "total_pairs": len(all_plag) + len(all_ai),
    }
    
    summary_path = OUT / "benchmark_summary.json"
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    
    print("\n" + "=" * 60)
    print("PREPARATION COMPLETE")
    print("=" * 60)
    print(f"Total pairs: {summary['total_pairs']}")
    print(f"Summary: {summary_path}")
    print("\nNext steps:")
    print("  python filter_rewrite_data.py  # Optional: entity filtering")
    print("  python train_rewrite.py --task plag --epochs 3")
    print("  python train_rewrite.py --task ai --epochs 3")
    print("  python train_rewrite.py --task report_plag --epochs 2")
    print("  python train_rewrite.py --task report_ai --epochs 2")


if __name__ == "__main__":
    main()

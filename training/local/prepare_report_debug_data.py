"""
Prepare report-driven revision jsonl from existing rewrite pairs (ParaSCI / SciHRA).

Does NOT download closed corpora. Reads filtered plag_*/ai_*.jsonl already produced by
prepare_rewrite_data.py + filter_rewrite_data.py and wraps each pair with synthetic
report-debug context (match %, source cue, AI flag cue) so offline Flan-T5 can learn
to restate/humanize *given report-style framing*.

Live app debug UX uses Netlify explain with real report fields; this path trains the
offline rewrite_best models for local eval / optional future wiring.

Usage:
  python prepare_rewrite_data.py --force   # if jsonl missing
  python filter_rewrite_data.py
  python prepare_report_debug_data.py
  python train_rewrite.py --task report_plag --epochs 2 --max-train 12000
  python train_rewrite.py --task report_ai --epochs 2 --max-train 2000
"""
from __future__ import annotations

import json
import random
from pathlib import Path

HERE = Path(__file__).parent
DATA = HERE / "rewrite_data"
SEED = 42

PLAG_PREFIX = (
    "similarity report flagged this passage (~{pct}% match; source: {src}). "
    "Restate in your own words; keep technical terms and any citation markers: "
)
AI_PREFIX = (
    "AI writing report flagged this passage (high machine-like confidence). "
    "Revise for specificity, varied rhythm, and author voice; keep citation markers: "
)


def _load(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]


def _write(rows: list[dict], name: str) -> None:
    path = DATA / name
    with path.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"  {path.name}: {len(rows)}")


def wrap_plag(rows: list[dict], rng: random.Random) -> list[dict]:
    out = []
    for r in rows:
        inp = (r.get("input") or "").strip()
        tgt = (r.get("target") or "").strip()
        if len(inp) < 40 or len(tgt) < 40:
            continue
        pct = rng.choice([2, 3, 4, 5, 6, 8, 12])
        src = rng.choice(
            [
                "indexed publication",
                "internet source",
                "prior work in reference list",
                "unidentified repository match",
            ]
        )
        out.append(
            {
                "input": PLAG_PREFIX.format(pct=pct, src=src) + inp,
                "target": tgt,
                "meta": {"task": "report_plag", "match_pct": pct, "source_cue": src},
            }
        )
    return out


def wrap_ai(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        inp = (r.get("input") or "").strip()
        tgt = (r.get("target") or "").strip()
        if len(inp) < 40 or len(tgt) < 40:
            continue
        out.append(
            {
                "input": AI_PREFIX + inp,
                "target": tgt,
                "meta": {"task": "report_ai"},
            }
        )
    return out


def main() -> None:
    rng = random.Random(SEED)
    DATA.mkdir(parents=True, exist_ok=True)

    print("wrapping plagiarism pairs -> report_plag_*.jsonl")
    for split in ("train", "val", "test"):
        src = _load(DATA / f"plag_{split}.jsonl")
        if not src:
            print(f"  skip plag_{split}.jsonl (missing) — run prepare_rewrite_data + filter first")
            continue
        _write(wrap_plag(src, rng), f"report_plag_{split}.jsonl")

    print("wrapping AI pairs -> report_ai_*.jsonl")
    for split in ("train", "val", "test"):
        src = _load(DATA / f"ai_{split}.jsonl")
        if not src:
            print(f"  skip ai_{split}.jsonl (missing)")
            continue
        _write(wrap_ai(src), f"report_ai_{split}.jsonl")

    print("done. Train with: python train_rewrite.py --task report_plag")
    print("              and: python train_rewrite.py --task report_ai")


if __name__ == "__main__":
    main()

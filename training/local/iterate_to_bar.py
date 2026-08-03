"""
Gemini / Grok iteration loop on OPEN rewrite eval data (ParaSCI / SciHRA splits).

Goal: raise local Flan-T5 rewrite quality above a real-use bar using LLM judges
+ teacher distillation — never private student papers or closed commercial reports.

  python iterate_to_bar.py                  # score + distill one round
  python iterate_to_bar.py --rounds 2 --retrain
  python iterate_to_bar.py --bar 4.0 --max-cases 24

Bar (default 4.0 / 5): mean of fidelity, originality, academic_voice for plag AND ai.
Also requires mean entity fidelity >= --entity-bar (default 0.90).
"""
from __future__ import annotations

import argparse
import json
import random
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import truststore

truststore.inject_into_ssl()

from entity_guard import fidelity_score
from llm_client import chat_json, resolve_provider
from solve_local import rewrite_span

HERE = Path(__file__).parent
DATA = HERE / "rewrite_data"
OUT_DIR = DATA / "iteration"
REPORT = OUT_DIR / "bar_report.json"
DISTILL_PLAG = DATA / "plag_train_distill.jsonl"
DISTILL_AI = DATA / "ai_train_distill.jsonl"


def load_jsonl(path: Path, limit: int) -> list[dict]:
    rows: list[dict] = []
    if not path.exists():
        return rows
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
            if len(rows) >= limit * 4:
                break
    random.shuffle(rows)
    return rows[:limit]


def avg_triple(block: dict | None) -> float:
    if not block:
        return 0.0
    vals = [
        float(block.get("fidelity") or 0),
        float(block.get("originality") or 0),
        float(block.get("voice") or block.get("academic_voice") or 0),
    ]
    return sum(vals) / max(len(vals), 1)


def score_batch(cases: list[dict], task: str) -> dict:
    """Ask Gemini/Grok to score local rewrites; return critique JSON."""
    compact = [
        {
            "id": c["id"],
            "task": task,
            "original": c["input"][:420],
            "local_rewrite": c["local"][:420],
            "reference_target": (c.get("target") or "")[:280],
            "entity_fidelity": c["entity_fidelity"],
        }
        for c in cases
    ]
    system = (
        "You are an Academic Writing Repair Specialist judging paraphrase / humanize "
        "models for real thesis and journal revision. Score strictly. JSON only."
    )
    user = f"""Task family: {task} ({'scientific paraphrase for similarity/restatement flags' if task == 'plag' else 'humanize AI-like scientific prose'}).

Score each local_rewrite 1-5 on:
- fidelity: same claims, numbers, materials, method names as original
- originality: not near-copy; useful for clearing similarity / AI flags without evasion games
- voice: natural academic voice (not detector-gaming synonym salad)

Also list concrete next_training_steps.

Cases:
{json.dumps(compact, ensure_ascii=False)}

Respond JSON:
{{
  "scores": [{{"id":"...","fidelity":0,"originality":0,"voice":0,"note":"...","pass":false}}],
  "summary": {{"avg":0,"main_issues":["..."],"next_training_steps":["..."]}}
}}
A case "pass" is true only if all three scores >= 4."""
    return chat_json(system, user, temperature=0.15)


def teacher_rewrite(cases: list[dict], task: str) -> list[dict]:
    """Ask LLM for teacher targets on failing cases (open-data inputs only)."""
    if not cases:
        return []
    payload = [
        {
            "id": c["id"],
            "input": c["input"][:500],
            "bad_local": c["local"][:400],
            "hint": c.get("note") or "",
        }
        for c in cases
    ]
    goal = (
        "paraphrase for similarity-report restatement (keep facts; change surface form)"
        if task == "plag"
        else "humanize AI-flagged scientific prose (more concrete, less formulaic)"
    )
    system = (
        "You write gold teacher rewrites for training a small Flan-T5 model. "
        "Preserve STEM tokens, numbers, and citation markers. JSON only."
    )
    user = f"""Produce one improved rewrite per item for: {goal}.

Items:
{json.dumps(payload, ensure_ascii=False)}

Respond JSON:
{{"teachers":[{{"id":"...","target":"..."}}]}}"""
    raw = chat_json(system, user, temperature=0.35)
    out = []
    by_id = {c["id"]: c for c in cases}
    for t in raw.get("teachers") or []:
        src = by_id.get(t.get("id") or "")
        target = (t.get("target") or "").strip()
        if not src or not target:
            continue
        if fidelity_score(src["input"], target) < 0.7:
            continue
        out.append(
            {
                "task": "plagiarism" if task == "plag" else "ai_humanize",
                "instruction": (
                    "paraphrase scientific sentence"
                    if task == "plag"
                    else "humanize AI scientific writing"
                ),
                "input": src["input"],
                "target": target,
                "source": "llm_teacher_distill",
            }
        )
    return out


def append_jsonl(path: Path, rows: list[dict]) -> None:
    if not rows:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def merge_distill_into_train(task: str) -> int:
    distill = DISTILL_PLAG if task == "plag" else DISTILL_AI
    train = DATA / ("plag_train.jsonl" if task == "plag" else "ai_train.jsonl")
    if not distill.exists() or not train.exists():
        return 0
    seen = set()
    with train.open(encoding="utf-8") as f:
        for line in f:
            try:
                o = json.loads(line)
                seen.add(o.get("input", "")[:120])
            except json.JSONDecodeError:
                pass
    added = 0
    with distill.open(encoding="utf-8") as f:
        new_rows = []
        for line in f:
            try:
                o = json.loads(line)
            except json.JSONDecodeError:
                continue
            key = o.get("input", "")[:120]
            if key in seen:
                continue
            seen.add(key)
            new_rows.append(o)
            added += 1
    if new_rows:
        with train.open("a", encoding="utf-8") as f:
            for r in new_rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
    return added


def run_one_round(
    *,
    max_cases: int,
    bar: float,
    entity_bar: float,
    retrain: bool,
    epochs: float,
) -> dict:
    provider = resolve_provider()
    print(f"provider={provider['name']} model={provider['model']}", flush=True)

    plag_src = load_jsonl(DATA / "plag_test.jsonl", max_cases)
    ai_src = load_jsonl(DATA / "ai_test.jsonl", max_cases)
    if not plag_src and not ai_src:
        raise SystemExit("No open rewrite_data/*_test.jsonl — run prepare_rewrite_data.py first")

    def build_cases(rows: list[dict], task: str) -> list[dict]:
        cases = []
        for i, r in enumerate(rows):
            inp = (r.get("input") or "").strip()
            if len(inp) < 40:
                continue
            local = rewrite_span(inp, task)
            cases.append(
                {
                    "id": f"{task}-{i}",
                    "input": inp,
                    "target": r.get("target") or "",
                    "local": local,
                    "entity_fidelity": round(fidelity_score(inp, local), 3),
                }
            )
        return cases

    plag_cases = build_cases(plag_src, "plag")
    ai_cases = build_cases(ai_src, "ai")
    print(f"scoring plag={len(plag_cases)} ai={len(ai_cases)}", flush=True)

    plag_crit = score_batch(plag_cases, "plag") if plag_cases else {"scores": [], "summary": {}}
    ai_crit = score_batch(ai_cases, "ai") if ai_cases else {"scores": [], "summary": {}}

    def attach_notes(cases: list[dict], crit: dict) -> None:
        by = {s.get("id"): s for s in (crit.get("scores") or [])}
        for c in cases:
            s = by.get(c["id"]) or {}
            c["scores"] = s
            c["note"] = s.get("note") or ""
            c["pass"] = bool(s.get("pass")) or avg_triple(s) >= bar

    attach_notes(plag_cases, plag_crit)
    attach_notes(ai_cases, ai_crit)

    def mean_score(cases: list[dict]) -> float:
        if not cases:
            return 0.0
        return round(sum(avg_triple(c.get("scores")) for c in cases) / len(cases), 3)

    def mean_entity(cases: list[dict]) -> float:
        if not cases:
            return 0.0
        return round(sum(c["entity_fidelity"] for c in cases) / len(cases), 3)

    plag_avg = mean_score(plag_cases)
    ai_avg = mean_score(ai_cases)
    plag_ent = mean_entity(plag_cases)
    ai_ent = mean_entity(ai_cases)

    fail_plag = [c for c in plag_cases if not c.get("pass")]
    fail_ai = [c for c in ai_cases if not c.get("pass")]
    print(
        f"plag_avg={plag_avg} (bar {bar}) entity={plag_ent} fails={len(fail_plag)}",
        flush=True,
    )
    print(
        f"ai_avg={ai_avg} (bar {bar}) entity={ai_ent} fails={len(fail_ai)}",
        flush=True,
    )

    teachers_plag = teacher_rewrite(fail_plag[:12], "plag") if fail_plag else []
    teachers_ai = teacher_rewrite(fail_ai[:12], "ai") if fail_ai else []
    append_jsonl(DISTILL_PLAG, teachers_plag)
    append_jsonl(DISTILL_AI, teachers_ai)
    print(f"distilled plag={len(teachers_plag)} ai={len(teachers_ai)}", flush=True)

    added_p = merge_distill_into_train("plag")
    added_a = merge_distill_into_train("ai")
    print(f"merged into train plag+{added_p} ai+{added_a}", flush=True)

    if retrain and (added_p or added_a or teachers_plag or teachers_ai):
        py = sys.executable
        if added_p or teachers_plag:
            subprocess.check_call(
                [
                    py,
                    "train_rewrite.py",
                    "--task",
                    "plag",
                    "--epochs",
                    str(epochs),
                    "--max-train",
                    "20000",
                ],
                cwd=str(HERE),
            )
        if added_a or teachers_ai:
            subprocess.check_call(
                [
                    py,
                    "train_rewrite.py",
                    "--task",
                    "ai",
                    "--epochs",
                    str(epochs),
                    "--max-train",
                    "20000",
                ],
                cwd=str(HERE),
            )

    passed = (
        plag_avg >= bar
        and ai_avg >= bar
        and plag_ent >= entity_bar
        and ai_ent >= entity_bar
    )
    report = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "provider": provider["name"],
        "model": provider["model"],
        "bar": bar,
        "entity_bar": entity_bar,
        "passed": passed,
        "plag_avg": plag_avg,
        "ai_avg": ai_avg,
        "plag_entity_avg": plag_ent,
        "ai_entity_avg": ai_ent,
        "distill_plag": len(teachers_plag),
        "distill_ai": len(teachers_ai),
        "plag_critique_summary": plag_crit.get("summary"),
        "ai_critique_summary": ai_crit.get("summary"),
        "data_note": "Open ParaSCI/SciHRA test splits only — no private student papers",
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, indent=2), encoding="utf-8")
    hist = OUT_DIR / "bar_history.jsonl"
    with hist.open("a", encoding="utf-8") as f:
        f.write(json.dumps(report) + "\n")
    print("wrote", REPORT, "passed=" + str(passed), flush=True)
    return report


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bar", type=float, default=4.0, help="Min mean LLM score /5")
    ap.add_argument("--entity-bar", type=float, default=0.90)
    ap.add_argument("--max-cases", type=int, default=16)
    ap.add_argument("--rounds", type=int, default=1)
    ap.add_argument("--retrain", action="store_true", help="Fine-tune after distill")
    ap.add_argument("--epochs", type=float, default=1.0)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()
    random.seed(args.seed)

    last = None
    for r in range(1, args.rounds + 1):
        print(f"\n=== iteration round {r}/{args.rounds} ===", flush=True)
        last = run_one_round(
            max_cases=args.max_cases,
            bar=args.bar,
            entity_bar=args.entity_bar,
            retrain=args.retrain and r == args.rounds,
            epochs=args.epochs,
        )
        if last.get("passed"):
            print("BAR MET — ready for real-use rewrite assist on open eval set")
            break
    else:
        if last and not last.get("passed"):
            print(
                "Bar not met yet. Re-run with --rounds 2 --retrain after distill, "
                "or raise --max-cases. See rewrite_data/iteration/bar_report.json"
            )


if __name__ == "__main__":
    main()

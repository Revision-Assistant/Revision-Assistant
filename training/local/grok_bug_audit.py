#!/usr/bin/env python3
"""
Iterative Grok (xAI) bug audit for Revision Assistant.
Reads XAI_API_KEY from .env — never prints the key.
Usage:
  python training/local/grok_bug_audit.py --round 1
  python training/local/grok_bug_audit.py --round 2 --fixed-summary "..."
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ENV_PATH = ROOT / ".env"
API_URL = "https://api.x.ai/v1/chat/completions"
OUT_DIR = Path(__file__).resolve().parent / "grok_audit_rounds"


def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.exists():
        return env
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


# Priority audit targets (relative to repo root)
ROUND_FILES: dict[int, list[str]] = {
    1: [
        "src/lib/pipeline.ts",
        "src/lib/export/exportPdf.ts",
        "src/lib/export/changeLog.ts",
        "src/lib/grammar/languageTool.ts",
        "src/lib/ai/localScan.ts",
        "src/lib/citation/guard.ts",
        "src/lib/citation/citationNeed.ts",
        "src/lib/files/limits.ts",
        "src/hooks/usePrivacySession.ts",
    ],
    2: [
        "src/App.tsx",
        "src/components/FindingsQueue.tsx",
        "src/components/PaperView.tsx",
        "src/components/UploadZone.tsx",
        "src/lib/rewrite/humanizeClient.ts",
        "src/lib/rewrite/entityGuard.ts",
        "src/lib/alignment/fuzzyMatch.ts",
        "src/lib/quality/manuscriptQuality.ts",
        "src/lib/citation/crossref.ts",
    ],
    3: [
        "src/lib/pipeline.ts",
        "src/lib/export/exportPdf.ts",
        "src/lib/export/changeLog.ts",
        "src/App.tsx",
        "src/components/FindingsQueue.tsx",
        "src/lib/grammar/languageTool.ts",
        "src/lib/ai/localScan.ts",
        "src/lib/citation/guard.ts",
        "src/lib/pdf/extractText.ts",
        "src/lib/pdf/textUtils.ts",
    ],
}

SYSTEM = """You are a senior TypeScript/React engineer doing a defect-first code review of a browser-side academic Revision Assistant.

Focus ONLY on real bugs: incorrect logic, race conditions, wrong offsets/spans, silent data loss, citation integrity failures, apply-edit errors, privacy wipe races, upload/path bugs, false-positive generators that clearly misuse offsets, PDF export overlay bugs.

Ignore style nits, naming, comments, and "nice to have" refactors unless they hide a defect.

Return STRICT JSON (no markdown fences) with this shape:
{
  "round_notes": "one sentence",
  "bugs": [
    {
      "id": "R{round}-{n}",
      "file": "path",
      "severity": "what user sees",
      "root_cause": "why",
      "severity": "high|medium|low",
      "suggested_fix": "concrete change",
      "confidence": 0.0
    }
  ]
}

Prefer fewer high-confidence real defects over a long speculative list. Cap at 8 bugs. severity high/medium first."""


def read_files(rel_paths: list[str], max_chars_each: int = 28000) -> str:
    parts: list[str] = []
    total = 0
    budget = 110_000
    for rel in rel_paths:
        path = ROOT / rel
        if not path.exists():
            parts.append(f"\n===== MISSING: {rel} =====\n")
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        if len(text) > max_chars_each:
            text = text[:max_chars_each] + f"\n…[truncated at {max_chars_each} chars]…"
        block = f"\n===== FILE: {rel} =====\n{text}\n"
        if total + len(block) > budget:
            parts.append(f"\n===== SKIPPED (budget): {rel} =====\n")
            continue
        parts.append(block)
        total += len(block)
    return "".join(parts)


def chat(api_key: str, model: str, messages: list[dict], timeout: int = 180) -> str:
    body = json.dumps(
        {
            "model": model,
            "temperature": 0.2,
            "messages": messages,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        API_URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data["choices"][0]["message"]["content"]


def parse_json_content(content: str) -> dict:
    content = content.strip()
    if content.startswith("```"):
        content = content.strip("`")
        if content.startswith("json"):
            content = content[4:]
        content = content.strip()
    # find outermost object
    start = content.find("{")
    end = content.rfind("}")
    if start >= 0 and end > start:
        content = content[start : end + 1]
    return json.loads(content)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--round", type=int, required=True)
    ap.add_argument("--fixed-summary", default="")
    ap.add_argument("--extra-files", nargs="*", default=[])
    args = ap.parse_args()

    env = load_env(ENV_PATH)
    # also allow process env
    api_key = os.environ.get("XAI_API_KEY") or env.get("XAI_API_KEY")
    model = os.environ.get("XAI_MODEL") or env.get("XAI_MODEL") or "grok-3-mini"
    fallback = (
        os.environ.get("XAI_MODEL_FALLBACK")
        or env.get("XAI_MODEL_FALLBACK")
        or "grok-3-mini"
    )
    if not api_key:
        print("ERROR: XAI_API_KEY not found in .env or environment", file=sys.stderr)
        return 2

    files = list(ROUND_FILES.get(args.round, ROUND_FILES[3]))
    for f in args.extra_files:
        if f not in files:
            files.append(f)

    code_blob = read_files(files)
    user = f"""Round {args.round} defect review of Revision Assistant.

Product context:
- Client-side pipeline parses PDF/DOCX, aligns Turnitin reports, grammar, citation-need, quality, then optional LLM explain/humanize.
- Authors accept/edit/dismiss findings; export watermarked PDF preserving layout when possible; change log with citation integrity.
- Privacy wipe after idle; apply-all must not drop citations.

{"Previously fixed in earlier rounds:" + chr(10) + args.fixed_summary if args.fixed_summary else "This is the first audit round — find concrete bugs."}

Code excerpts:
{code_blob}

Return STRICT JSON only as specified.
"""

    messages = [
        {"role": "system", "content": SYSTEM.replace("{round}", str(args.round))},
        {"role": "user", "content": user},
    ]

    content = None
    last_err = None
    for m in [model, fallback]:
        try:
            print(f"Calling Grok model={m} round={args.round} files={len(files)}…", flush=True)
            content = chat(api_key, m, messages)
            break
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")[:500]
            last_err = f"HTTP {e.code}: {err_body}"
            print(f"Model {m} failed: {last_err}", file=sys.stderr)
        except Exception as e:
            last_err = str(e)
            print(f"Model {m} failed: {last_err}", file=sys.stderr)

    if content is None:
        print(f"ERROR: all models failed: {last_err}", file=sys.stderr)
        return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    raw_path = OUT_DIR / f"round{args.round}_raw.txt"
    raw_path.write_text(content, encoding="utf-8")

    try:
        parsed = parse_json_content(content)
    except Exception as e:
        print(f"WARN: could not parse JSON ({e}); raw saved to {raw_path}", file=sys.stderr)
        print(content[:2000])
        return 1

    out_path = OUT_DIR / f"round{args.round}.json"
    out_path.write_text(json.dumps(parsed, indent=2), encoding="utf-8")
    print(json.dumps(parsed, indent=2))
    print(f"\nSaved: {out_path}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

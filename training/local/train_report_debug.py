"""
Train offline Flan-T5 on report-framed rewrite pairs.

Requires:
  python prepare_report_debug_data.py   # builds report_{plag,ai}_*.jsonl from ParaSCI/SciHRA pairs
  python train_report_debug.py --task report_plag
  python train_report_debug.py --task report_ai

Delegates to train_rewrite.py (same hyperparams / entity guard / rewrite_best layout).
Live product debug UX does not require this train — it uses report fields + Netlify explain.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
TRAINER = HERE / "train_rewrite.py"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--task", choices=["report_plag", "report_ai"], required=True)
    ap.add_argument("--epochs", type=float, default=2.0)
    ap.add_argument("--max-train", type=int, default=12000)
    ap.add_argument("--steps", type=int, default=0)
    ap.add_argument("--lr", type=float, default=1.5e-4)
    args = ap.parse_args()

    if not TRAINER.exists():
        raise SystemExit(f"Missing {TRAINER.name} — keep it next to this script under training/local/")

    data = HERE / "rewrite_data" / f"{args.task}_train.jsonl"
    if not data.exists():
        raise SystemExit(f"Missing {data.name} — run prepare_report_debug_data.py first")

    cmd = [
        sys.executable,
        str(TRAINER),
        "--task",
        args.task,
        "--epochs",
        str(args.epochs),
        "--max-train",
        str(args.max_train),
        "--lr",
        str(args.lr),
    ]
    if args.steps > 0:
        cmd.extend(["--steps", str(args.steps)])
    print("running:", " ".join(cmd))
    subprocess.check_call(cmd)


if __name__ == "__main__":
    main()

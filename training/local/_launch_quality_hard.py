"""Launch quality hard pipeline with HF_TOKEN from repo .env (never prints token)."""
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parent.parent
env = os.environ.copy()
env["PYTHONUNBUFFERED"] = "1"
env["PYTHONIOENCODING"] = "utf-8"

env_path = ROOT / ".env"
if env_path.exists():
    for line in env_path.read_text(encoding="utf-8").splitlines():
        if line.startswith("HF_TOKEN="):
            env["HF_TOKEN"] = line.split("=", 1)[1].strip().strip('"').strip("'")
            break

log_out = open(HERE / "quality_hard_stdout.log", "w", encoding="utf-8")
log_err = open(HERE / "quality_hard_stderr.log", "w", encoding="utf-8")
subprocess.Popen(
    [sys.executable, "-u", str(HERE / "_orch_quality_hard.py")],
    cwd=str(HERE),
    env=env,
    stdout=log_out,
    stderr=log_err,
    creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0,
)
print("launched _orch_quality_hard.py", flush=True)

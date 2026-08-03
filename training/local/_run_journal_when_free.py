"""Wait until GPU util/memory is free enough, then train+export+upload journal readiness."""
from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).parent


def gpu_busy() -> bool:
    """True if another training job is occupying the GPU."""
    try:
        util_line = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=utilization.gpu,memory.used", "--format=csv,noheader,nounits"],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
        u_s, mem_s = [x.strip() for x in util_line.split(",")]
        util, mem = int(u_s), int(mem_s)
    except Exception:
        util, mem = 0, 0

    # Ignore keepalive / our waiter — only block on real trainers
    blockers = ("train_", "prepare_", "export_", "fit_seq2seq")
    try:
        out = subprocess.check_output(
            ["nvidia-smi", "--query-compute-apps=pid", "--format=csv,noheader"],
            text=True,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        out = ""

    for line in out.strip().splitlines():
        pid_s = line.strip()
        if not pid_s or pid_s == "[N/A]":
            continue
        try:
            pid = int(pid_s)
        except ValueError:
            continue
        try:
            # Avoid psutil dependency — use wmic/powershell on Windows via ctypes-free check
            import subprocess as sp

            cmd = sp.check_output(
                ["powershell", "-NoProfile", "-Command", f"(Get-CimInstance Win32_Process -Filter \"ProcessId={pid}\").CommandLine"],
                text=True,
                stderr=subprocess.DEVNULL,
            ).lower()
        except Exception:
            cmd = ""
        if "keepalive" in cmd or "_run_journal_when_free" in cmd:
            continue
        if any(b in cmd for b in blockers):
            return True
        if "python" in cmd and (util > 20 or mem > 1200):
            return True

    # High util with substantial VRAM even if cmdline opaque
    if util > 25 and mem > 1800:
        return True
    return False


def run(cmd: list[str]) -> None:
    print("+", " ".join(cmd), flush=True)
    subprocess.check_call(cmd, cwd=str(HERE))


def main() -> None:
    print("waiting for GPU to free for journal readiness train...", flush=True)
    while gpu_busy():
        print(f"  still busy @ {time.strftime('%H:%M:%S')}", flush=True)
        time.sleep(45)
    print("GPU looks free — starting train", flush=True)
    run([sys.executable, "-u", "train_journal_readiness.py", "20000"])
    run([sys.executable, "-u", "export_journal_onnx.py"])
    # Load HF_TOKEN from repo .env without printing
    env_path = HERE.parent.parent / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            if line.startswith("HF_TOKEN=") and "HF_TOKEN" not in os.environ:
                os.environ["HF_TOKEN"] = line.split("=", 1)[1].strip().strip('"').strip("'")
    if os.environ.get("HF_TOKEN"):
        run([sys.executable, "-u", "upload_journal_to_hf.py"])
    else:
        print("HF_TOKEN not set — skip upload (onnx still in journal_onnx/)", flush=True)
    print("JOURNAL_PIPELINE_DONE", flush=True)
    (HERE / "JOURNAL_TRAIN_DONE.flag").write_text(time.strftime("%Y-%m-%d %H:%M:%S"), encoding="utf-8")


if __name__ == "__main__":
    main()

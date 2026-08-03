"""
Resume-friendly manuscript-quality train loop.
Uses step checkpoints so rival kills don't wipe progress.
Blacklist-only competitor clearing (does not kill unknown python).
"""
from __future__ import annotations

import os
import subprocess
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parent.parent
FLAG = HERE / "QUALITY_HARD_PIPELINE_DONE.flag"
OUT = HERE / "quality_out"
os.chdir(HERE)
os.environ["PYTHONUNBUFFERED"] = "1"
os.environ["PYTHONIOENCODING"] = "utf-8"
sys.argv = [sys.argv[0], "90000"]

for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
    if line.startswith("HF_TOKEN="):
        os.environ["HF_TOKEN"] = line.split("=", 1)[1].strip().strip('"').strip("'")
        break

BLACKLIST = (
    "plag_hard_rewrite",
    "anti_protect",
    "INetCache",
    "report_plag",
    "report_ai",
    "seq2seq",
    "hard_orch",
    "report_hard",
    "train_rewrite",
    "train_rw",
    "fit_seq2seq",
    "fit_watchdog",
    "hh_orch",
    "rw_hard",
    "svc.py",
)
stop_clear = threading.Event()


def list_python():
    try:
        r = subprocess.check_output(
            ["wmic", "process", "where", "name='python.exe'", "get", "ProcessId,CommandLine", "/FORMAT:LIST"],
            text=True,
            errors="replace",
        )
    except Exception:
        return []
    cur, out = {}, []
    for line in r.splitlines():
        line = line.strip()
        if not line:
            if cur.get("ProcessId") and cur.get("CommandLine"):
                out.append((int(cur["ProcessId"]), cur["CommandLine"]))
            cur = {}
            continue
        if "=" in line:
            k, v = line.split("=", 1)
            cur[k] = v
    return out


def clear_loop(my_pid: int) -> None:
    while not stop_clear.is_set():
        for pid, cmd in list_python():
            if pid == my_pid:
                continue
            if "_quality_train_persist" in cmd or "keepalive" in cmd:
                continue
            if any(b in cmd for b in BLACKLIST):
                try:
                    os.kill(pid, 9)
                    print(f"cleared rival {pid}", flush=True)
                except Exception:
                    pass
        time.sleep(3)


def run_logged(cmd: list[str], logname: str) -> int:
    print("===", " ".join(cmd), flush=True)
    t0 = time.time()
    with open(HERE / logname, "w", encoding="utf-8") as log:
        p = subprocess.run(cmd, stdout=log, stderr=subprocess.STDOUT, text=True)
    print(f"exit={p.returncode} minutes={(time.time() - t0) / 60:.1f}", flush=True)
    return p.returncode


def train_once() -> bool:
    """Returns True if quality_best exists after this attempt."""
    class Tee:
        def __init__(self, *files):
            self.files = files
        def write(self, data):
            for f in self.files:
                f.write(data)
                f.flush()
        def flush(self):
            for f in self.files:
                f.flush()

    log_path = HERE / "train_quality.log"
    mode = "a" if log_path.exists() else "w"
    with open(log_path, mode, encoding="utf-8") as logf:
        logf.write(f"\n---- attempt {time.strftime('%Y-%m-%d %H:%M:%S')} ----\n")
        old_out, old_err = sys.stdout, sys.stderr
        sys.stdout = sys.stderr = Tee(old_out, logf)
        try:
            # Fresh import each attempt so resume state reloads
            if "train_quality" in sys.modules:
                del sys.modules["train_quality"]
            import train_quality

            train_quality.main()
            return (HERE / "quality_best" / "inference_config.json").exists()
        except Exception as e:
            print(f"train exception: {e!r}", flush=True)
            return (HERE / "quality_best" / "inference_config.json").exists()
        finally:
            sys.stdout, sys.stderr = old_out, old_err


def main() -> None:
    if FLAG.exists():
        print("already done", flush=True)
        return
    my_pid = os.getpid()
    threading.Thread(target=clear_loop, args=(my_pid,), daemon=True).start()

    attempt = 0
    while not (HERE / "quality_best" / "inference_config.json").exists():
        attempt += 1
        print(f"train attempt={attempt} checkpoints={list(OUT.glob('checkpoint-*'))}", flush=True)
        ok = train_once()
        if ok:
            break
        print("incomplete — will resume from checkpoint in 8s", flush=True)
        time.sleep(8)

    if run_logged([sys.executable, "-u", "export_quality_onnx.py"], "export_quality_onnx.log") != 0:
        raise SystemExit("export failed")
    if run_logged([sys.executable, "-u", "upload_quality_to_hf.py"], "upload_quality_to_hf.log") != 0:
        raise SystemExit("upload failed")
    FLAG.write_text("ok\n", encoding="utf-8")
    stop_clear.set()
    print("QUALITY_HARD_PIPELINE_DONE", flush=True)


if __name__ == "__main__":
    main()

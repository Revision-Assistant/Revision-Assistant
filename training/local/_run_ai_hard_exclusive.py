import os, sys, time, subprocess, ctypes, json
from pathlib import Path
HERE = Path(r"c:\Users\subha\Desktop\plag and AI\training\local")
os.chdir(HERE)
RESULTS = HERE / "HARD_TRAIN_RESULTS.txt"
LOG = HERE / "train_report_ai_hard.log"

def keep_awake():
    try: ctypes.windll.kernel32.SetThreadExecutionState(0x80000000|0x00000001)
    except Exception: pass

def procs():
    try:
        r=subprocess.check_output(["powershell","-NoProfile","-Command","Get-CimInstance Win32_Process -Filter \"name='python.exe'\" | Select ProcessId,CommandLine | ConvertTo-Json -Compress"], text=True, errors="replace")
        data=json.loads(r) if r.strip() else []
        if isinstance(data, dict): data=[data]
        return [(int(x["ProcessId"]), x.get("CommandLine") or "") for x in data]
    except Exception:
        return []

def sanitize(protect):
    for pid, cmd in procs():
        if pid in protect: continue
        if "run_report_ai_exclusive" in cmd: continue
        if "keepalive" in cmd: continue
        if any(x in cmd for x in ("train_quality","_quality_train","_orch_quality","_gpu_protect","train_rewrite.py","train_rw_job","run_report_plag","hw7f3a9c")):
            try: os.kill(pid, 9)
            except Exception: pass

def main():
    keep_awake()
    protect={os.getpid()}
    sanitize(protect)
    env=os.environ.copy(); env["PYTHONUNBUFFERED"]="1"; env["TF_CPP_MIN_LOG_LEVEL"]="3"
    with RESULTS.open("a", encoding="utf-8") as f:
        f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} START report_ai exclusive epochs=3 max-train=10000\n")
    t0=time.time()
    with LOG.open("w", encoding="utf-8", errors="replace") as out:
        p=subprocess.Popen([sys.executable,"-u","run_report_ai_exclusive.py","--task","report_ai","--epochs","3","--max-train","10000"],
            stdout=out, stderr=subprocess.STDOUT, env=env, cwd=str(HERE))
        protect.add(p.pid)
        while p.poll() is None:
            keep_awake(); sanitize(protect); time.sleep(4)
        rc=p.returncode
    mins=(time.time()-t0)/60
    with RESULTS.open("a", encoding="utf-8") as f:
        f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} END report_ai exclusive exit={rc} elapsed_min={mins:.1f}\n")
    sys.exit(rc if rc is not None else 1)

if __name__=="__main__":
    main()

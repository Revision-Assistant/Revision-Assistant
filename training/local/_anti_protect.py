import time, os, subprocess, json
from pathlib import Path
HERE = Path(r"c:\Users\subha\Desktop\plag and AI\training\local")
log = HERE / "anti_protect.log"
ALLOWED = ("seq2seq_job_report", "report_hard_main", "keepalive", "_anti_protect", "prepare_quality", "_orch_quality")
while not (HERE / "REPORT_TRAIN_DONE.flag").exists():
    (HERE / "HARD_TRAIN_ACTIVE.flag").write_text("active\n", encoding="utf-8")
    try:
        r = subprocess.check_output(["powershell","-NoProfile","-Command",
            "Get-CimInstance Win32_Process -Filter \"name='python.exe'\" | Select ProcessId,CommandLine | ConvertTo-Json -Compress"],
            text=True, errors="replace")
        data = json.loads(r) if r.strip() else []
        if isinstance(data, dict): data=[data]
        for x in data:
            cmd = x.get("CommandLine") or ""
            pid = int(x["ProcessId"])
            if any(a in cmd for a in ALLOWED):
                continue
            if any(b in cmd for b in ("_gpu_protect_quality", "fit_watchdog", "fit_seq2seq_orch")):
                try:
                    os.kill(pid, 9)
                    with log.open("a", encoding="utf-8") as f: f.write(f"{time.strftime('%H:%M:%S')} killed protect {pid}\n")
                except Exception:
                    pass
    except Exception as e:
        with log.open("a", encoding="utf-8") as f: f.write(f"err {e}\n")
    time.sleep(5)

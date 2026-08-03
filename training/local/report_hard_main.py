import os, sys, time, subprocess
from pathlib import Path
HERE = Path(r"c:\Users\subha\Desktop\plag and AI\training\local")
os.chdir(HERE)
env = os.environ.copy(); env["TF_CPP_MIN_LOG_LEVEL"]="3"; env["PYTHONUNBUFFERED"]="1"
stat = HERE / "train_report_plag.status"
STEPS = 120
# 5 more chunks (~600 steps) on top of chunk1's 150
START, END = 2, 6

def run_chunk(task, steps, chunk_i):
    log = HERE / f"train_{task}.log"
    err = HERE / f"train_{task}.err"
    with stat.open("a", encoding="utf-8") as f:
        f.write(f"chunk {chunk_i} {task} steps={steps} start={time.strftime('%H:%M:%S')}\n")
    t0 = time.time()
    with open(log, "a", encoding="utf-8", errors="replace") as out, open(err, "a", encoding="utf-8", errors="replace") as errf:
        out.write(f"\n===== CHUNK {chunk_i} =====\n"); out.flush()
        p = subprocess.Popen([sys.executable, "-u", "seq2seq_job_report.py", "--task", task, "--epochs", "2", "--steps", str(steps)],
                             stdout=out, stderr=errf, env=env, cwd=str(HERE))
        rc = p.wait()
    with stat.open("a", encoding="utf-8") as f:
        f.write(f"chunk {chunk_i} exit={rc} elapsed_min={(time.time()-t0)/60:.2f} ended={time.strftime('%H:%M:%S')}\n")
    return rc

with stat.open("a", encoding="utf-8") as f:
    f.write(f"resume chunks {START}-{END} steps={STEPS} at {time.strftime('%H:%M:%S')}\n")
ok = 0
for i in range(START, END + 1):
    rc = run_chunk("report_plag", STEPS, i)
    if rc != 0:
        time.sleep(10)
        rc = run_chunk("report_plag", STEPS, i)
    if rc != 0:
        with stat.open("a", encoding="utf-8") as f: f.write(f"fatal plag chunk {i}\n")
        break
    ok += 1
else:
    with open(HERE/"train_report_ai.log","w",encoding="utf-8",errors="replace") as out, open(HERE/"train_report_ai.err","w",encoding="utf-8",errors="replace") as errf:
        with stat.open("a",encoding="utf-8") as f: f.write(f"start report_ai {time.strftime('%H:%M:%S')}\n")
        t0=time.time()
        p=subprocess.Popen([sys.executable,"-u","seq2seq_job_report.py","--task","report_ai","--epochs","2"], stdout=out, stderr=errf, env=env, cwd=str(HERE))
        rc=p.wait()
        with stat.open("a",encoding="utf-8") as f: f.write(f"exit={rc} report_ai elapsed_min={(time.time()-t0)/60:.2f}\n")
(HERE/"REPORT_TRAIN_DONE.flag").write_text(f"resume_ok={ok}\n", encoding="utf-8")

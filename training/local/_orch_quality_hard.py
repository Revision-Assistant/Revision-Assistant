import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parent.parent
os.chdir(HERE)
os.environ["PYTHONUNBUFFERED"] = "1"
os.environ["PYTHONIOENCODING"] = "utf-8"
os.environ["SKIP_HF"] = "1"

env_path = ROOT / ".env"
if env_path.exists():
    for line in env_path.read_text(encoding="utf-8").splitlines():
        if line.startswith("HF_TOKEN="):
            os.environ["HF_TOKEN"] = line.split("=", 1)[1].strip().strip('"').strip("'")
            break

steps = [
    ([sys.executable, "-u", "prepare_quality_data.py", "400000"], "prepare_quality_data.log"),
    ([sys.executable, "-u", "train_quality.py", "90000"], "train_quality.log"),
    ([sys.executable, "-u", "export_quality_onnx.py"], "export_quality_onnx.log"),
    ([sys.executable, "-u", "upload_quality_to_hf.py"], "upload_quality_to_hf.log"),
]

for cmd, logname in steps:
    print("===", " ".join(cmd), flush=True)
    t0 = time.time()
    with open(logname, "w", encoding="utf-8") as log:
        p = subprocess.run(cmd, stdout=log, stderr=subprocess.STDOUT, text=True)
    print(f"exit={p.returncode} minutes={(time.time()-t0)/60:.1f} log={logname}", flush=True)
    if p.returncode != 0:
        sys.exit(p.returncode)

print("QUALITY_HARD_PIPELINE_DONE", flush=True)
(HERE / "QUALITY_HARD_PIPELINE_DONE.flag").write_text("ok\n", encoding="utf-8")

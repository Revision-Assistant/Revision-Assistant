"""
Export the AI-writing detector SciBERT to quantized ONNX for Transformers.js.

Writes:
  training/local/ai_detect_onnx/
  public/models/ai-detect/  (quantized only)
"""
import json
import shutil
from pathlib import Path

import truststore

truststore.inject_into_ssl()

from optimum.onnxruntime import ORTModelForSequenceClassification, ORTQuantizer
from optimum.onnxruntime.configuration import AutoQuantizationConfig
from transformers import AutoTokenizer

HERE = Path(__file__).parent
BEST = HERE / "ai_detect_best"
OUT = HERE / "ai_detect_onnx"
APP_DEST = HERE.parent.parent / "public" / "models" / "ai-detect"

if not BEST.exists():
    raise SystemExit(f"{BEST} not found — run train_ai_detect.py first")

if OUT.exists():
    shutil.rmtree(OUT)
OUT.mkdir(parents=True)

print("exporting to ONNX...")
ort_model = ORTModelForSequenceClassification.from_pretrained(str(BEST), export=True)
ort_model.save_pretrained(str(OUT))
AutoTokenizer.from_pretrained(str(BEST)).save_pretrained(str(OUT))

print("quantizing (dynamic, avx2)...")
qconfig = AutoQuantizationConfig.avx2(is_static=False, per_channel=False)
ORTQuantizer.from_pretrained(OUT).quantize(save_dir=str(OUT), quantization_config=qconfig)

cfg_path = OUT / "config.json"
cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
cfg["id2label"] = {"0": "LABEL_0", "1": "LABEL_1"}
cfg["label2id"] = {"LABEL_0": 0, "LABEL_1": 1}
cfg_path.write_text(json.dumps(cfg, indent=2), encoding="utf-8")

inf = json.loads((BEST / "inference_config.json").read_text(encoding="utf-8"))
(OUT / "inference_config.json").write_text(json.dumps(inf, indent=2), encoding="utf-8")

onnx_dir = OUT / "onnx"
onnx_dir.mkdir(exist_ok=True)
for f in list(OUT.glob("*.onnx")) + list(OUT.glob("*.onnx_data")):
    f.rename(onnx_dir / f.name)

print("export contents:")
for f in sorted(OUT.rglob("*")):
    if f.is_file():
        print(f"  {f.relative_to(OUT)}  {round(f.stat().st_size / 1e6, 1)} MB")

if APP_DEST.exists():
    shutil.rmtree(APP_DEST)
APP_DEST.mkdir(parents=True)
for f in OUT.rglob("*"):
    if not f.is_file():
        continue
    if f.name == "model.onnx" or f.name.endswith(".onnx_data"):
        continue
    dest = APP_DEST / f.relative_to(OUT)
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(f, dest)
print("copied into", APP_DEST)

"""
Quantize the fine-tuned model to ONNX for in-browser inference via transformers.js.
Run after train_scibert.py has written training/local/best/.

Layout written to public/models/citation-need/ (what @huggingface/transformers expects):

  citation-need/
    config.json
    tokenizer.json / tokenizer_config.json / vocab.txt / …
    inference_config.json
    onnx/
      model.onnx            # fp32
      model_quantized.onnx  # int8 — default for wasm
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
BEST = HERE / "best"
OUT = HERE / "citation_need_onnx"
APP_DEST = HERE.parent.parent / "public" / "models" / "citation-need"

if not BEST.exists():
    raise SystemExit(f"{BEST} not found — run train_scibert.py first")

if OUT.exists():
    shutil.rmtree(OUT)
OUT.mkdir(parents=True)

print("exporting to ONNX...")
ort_model = ORTModelForSequenceClassification.from_pretrained(str(BEST), export=True)
ort_model.save_pretrained(str(OUT))
AutoTokenizer.from_pretrained(str(BEST)).save_pretrained(str(OUT))

print("quantizing (dynamic, avx2 — broad CPU/WASM compatibility)...")
qconfig = AutoQuantizationConfig.avx2(is_static=False, per_channel=False)
ORTQuantizer.from_pretrained(OUT).quantize(save_dir=str(OUT), quantization_config=qconfig)

# Labels + threshold after quantize (ORTQuantizer may rewrite config.json)
cfg_path = OUT / "config.json"
cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
cfg["id2label"] = {"0": "LABEL_0", "1": "LABEL_1"}
cfg["label2id"] = {"LABEL_0": 0, "LABEL_1": 1}
cfg_path.write_text(json.dumps(cfg, indent=2), encoding="utf-8")

inf = json.loads((BEST / "inference_config.json").read_text(encoding="utf-8"))
(OUT / "inference_config.json").write_text(json.dumps(inf, indent=2), encoding="utf-8")

# transformers.js loads ONNX from an `onnx/` subfolder by default
onnx_dir = OUT / "onnx"
onnx_dir.mkdir(exist_ok=True)
for f in list(OUT.glob("*.onnx")) + list(OUT.glob("*.onnx_data")):
    f.rename(onnx_dir / f.name)

# Browser only needs the quantized weights (~110 MB); keep fp32 in the training
# export dir for offline debugging but don't ship it into public/.
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
    # Skip the fp32 ONNX — wasm defaults to model_quantized.onnx (q8)
    if f.name == "model.onnx" or f.name.endswith(".onnx_data"):
        continue
    dest = APP_DEST / f.relative_to(OUT)
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(f, dest)
print("copied into", APP_DEST)

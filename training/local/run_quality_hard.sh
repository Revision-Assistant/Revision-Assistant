#!/usr/bin/env bash
# Not used on Windows — see run_quality_hard.ps1
set -euo pipefail
cd "$(dirname "$0")"
python prepare_quality_data.py 400000
python train_quality.py 120000
python export_quality_onnx.py
echo "quality hard pipeline done"

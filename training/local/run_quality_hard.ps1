$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$env:PYTHONUNBUFFERED = "1"
# Load HF_TOKEN from repo .env without printing it
$envFile = Join-Path (Resolve-Path ..\..).Path ".env"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*HF_TOKEN=(.+)$') {
      $env:HF_TOKEN = $Matches[1].Trim().Trim('"').Trim("'")
    }
  }
}
Write-Output "=== prepare_quality_data 400000 blobs ==="
python -u prepare_quality_data.py 400000 2>&1 | Tee-Object -FilePath prepare_quality_data.log
if ($LASTEXITCODE -ne 0) { throw "prepare failed" }
Write-Output "=== train_quality 120000 / 4 epochs ==="
python -u train_quality.py 120000 2>&1 | Tee-Object -FilePath train_quality.log
if ($LASTEXITCODE -ne 0) { throw "train failed" }
Write-Output "=== export_quality_onnx ==="
python -u export_quality_onnx.py 2>&1 | Tee-Object -FilePath export_quality_onnx.log
if ($LASTEXITCODE -ne 0) { throw "export failed" }
Write-Output "=== upload_quality_to_hf ==="
python -u upload_quality_to_hf.py 2>&1 | Tee-Object -FilePath upload_quality_to_hf.log
if ($LASTEXITCODE -ne 0) { throw "upload failed" }
Write-Output "QUALITY_HARD_PIPELINE_DONE"

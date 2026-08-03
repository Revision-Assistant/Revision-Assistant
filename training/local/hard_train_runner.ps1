$ErrorActionPreference = "Continue"
Set-Location "c:\Users\subha\Desktop\plag and AI\training\local"
$results = "HARD_TRAIN_RESULTS.txt"
function Log($m) { $line = "$(Get-Date -Format o) $m"; Add-Content -Path $results -Value $line; Write-Host $line }

Log "HARD TRAIN RUNNER START"
# report_plag
$t0 = Get-Date
Log "START report_plag epochs=3 max-train=20000"
python train_rewrite.py --task report_plag --epochs 3 --max-train 20000 2>&1 | Tee-Object -FilePath train_report_plag_hard.log
$ec = $LASTEXITCODE
$mins = [math]::Round(((Get-Date)-$t0).TotalMinutes, 1)
Log "END report_plag exit=$ec elapsed_min=$mins"
if ($ec -ne 0) { Log "ABORT: report_plag failed"; exit $ec }

# report_ai
$t1 = Get-Date
Log "START report_ai epochs=3 max-train=10000"
python train_rewrite.py --task report_ai --epochs 3 --max-train 10000 2>&1 | Tee-Object -FilePath train_report_ai_hard.log
$ec = $LASTEXITCODE
$mins = [math]::Round(((Get-Date)-$t1).TotalMinutes, 1)
Log "END report_ai exit=$ec elapsed_min=$mins"
if ($ec -ne 0) { Log "ABORT: report_ai failed"; exit $ec }

# optional base tasks if still OK
$t2 = Get-Date
Log "START plag epochs=3 max-train=20000"
python train_rewrite.py --task plag --epochs 3 --max-train 20000 2>&1 | Tee-Object -FilePath train_plag_hard.log
$ec = $LASTEXITCODE
$mins = [math]::Round(((Get-Date)-$t2).TotalMinutes, 1)
Log "END plag exit=$ec elapsed_min=$mins"

$t3 = Get-Date
Log "START ai epochs=3 max-train=10000"
python train_rewrite.py --task ai --epochs 3 --max-train 10000 2>&1 | Tee-Object -FilePath train_ai_hard.log
$ec = $LASTEXITCODE
$mins = [math]::Round(((Get-Date)-$t3).TotalMinutes, 1)
Log "END ai exit=$ec elapsed_min=$mins"

Log "HARD TRAIN RUNNER COMPLETE"

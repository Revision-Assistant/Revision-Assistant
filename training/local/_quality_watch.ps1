$deadline = (Get-Date).AddHours(10)
while ((Get-Date) -lt $deadline) {
  if (Test-Path 'c:\Users\subha\Desktop\plag and AI\training\local\QUALITY_HARD_PIPELINE_DONE.flag') { break }
  Get-CimInstance Win32_Process -Filter "Name='python.exe'" | ForEach-Object {
    $cmd = $_.CommandLine
    if ($cmd -match 'keepalive|_quality_train_persist|export_quality|upload_quality') { return }
    if ($cmd -match 'INetCache|plag_hard|anti_protect|seq2seq|report_plag|hard_orch|report_hard|train_rewrite|fit_seq2seq|hh_orch|rw_hard') {
      try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
        Add-Content 'c:\Users\subha\Desktop\plag and AI\training\local\quality_watch.log' "$(Get-Date -Format o) KILL $($_.ProcessId)"
      } catch {}
    }
  }
  Start-Sleep 2
}

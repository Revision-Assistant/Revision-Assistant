@echo off
cd /d "c:\Users\subha\Desktop\plag and AI\training\local"
set TF_CPP_MIN_LOG_LEVEL=3
set PYTHONUNBUFFERED=1
echo running started %DATE% %TIME%> train_report_plag.status
python -u train_rewrite.py --task report_plag --epochs 2 > train_report_plag.log 2>&1
echo exit=%ERRORLEVEL% elapsed_ended %DATE% %TIME%>> train_report_plag.status
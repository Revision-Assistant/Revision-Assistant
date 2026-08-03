@echo off
cd /d "c:\Users\subha\Desktop\plag and AI\training\local"
echo HARD TRAIN BAT START %date% %time%>> HARD_TRAIN_RESULTS.txt
echo START report_plag epochs=3 max-train=20000 %date% %time%>> HARD_TRAIN_RESULTS.txt
python -u train_rewrite.py --task report_plag --epochs 3 --max-train 20000 > train_report_plag_hard.log 2>&1
set EC=%ERRORLEVEL%
echo END report_plag exit=%EC% %date% %time%>> HARD_TRAIN_RESULTS.txt
if not "%EC%"=="0" (
  echo ABORT report_plag>> HARD_TRAIN_RESULTS.txt
  exit /b %EC%
)
echo START report_ai epochs=3 max-train=10000 %date% %time%>> HARD_TRAIN_RESULTS.txt
python -u train_rewrite.py --task report_ai --epochs 3 --max-train 10000 > train_report_ai_hard.log 2>&1
set EC=%ERRORLEVEL%
echo END report_ai exit=%EC% %date% %time%>> HARD_TRAIN_RESULTS.txt
if not "%EC%"=="0" (
  echo ABORT report_ai>> HARD_TRAIN_RESULTS.txt
  exit /b %EC%
)
echo START plag epochs=3 max-train=20000 %date% %time%>> HARD_TRAIN_RESULTS.txt
python -u train_rewrite.py --task plag --epochs 3 --max-train 20000 > train_plag_hard.log 2>&1
set EC=%ERRORLEVEL%
echo END plag exit=%EC% %date% %time%>> HARD_TRAIN_RESULTS.txt
echo START ai epochs=3 max-train=10000 %date% %time%>> HARD_TRAIN_RESULTS.txt
python -u train_rewrite.py --task ai --epochs 3 --max-train 10000 > train_ai_hard.log 2>&1
set EC=%ERRORLEVEL%
echo END ai exit=%EC% %date% %time%>> HARD_TRAIN_RESULTS.txt
echo HARD TRAIN BAT COMPLETE %date% %time%>> HARD_TRAIN_RESULTS.txt

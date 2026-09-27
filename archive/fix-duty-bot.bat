@echo off
rem ============================================================
rem  Rebuild duty-bot in pm2 (clean environment, fresh start)
rem  Double-click to run. No admin needed.
rem ============================================================
cd /d C:\qianli\opt\duty-bot
echo Rebuilding duty-bot in pm2 (clean environment)...
pm2 delete duty-bot
pm2 start src/index.js --name duty-bot
pm2 save
echo.
echo ===== pm2 process list =====
pm2 ls
echo ============================
echo If duty-bot shows "online", it is fixed. You can close this window.
pause

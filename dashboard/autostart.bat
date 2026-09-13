@echo off
rem qianli dashboard auto-start entry (invoked hidden by the Startup-folder VBS)
rem Skips if port 3100 is already listening (no duplicate instance after manual npm start)
netstat -ano | findstr /C:":3100 " | findstr "LISTENING" >nul 2>&1 && exit /b 0
cd /d "%~dp0"
rem Start-Process redirection overwrites, keep one previous run log first
if exist dashboard-run.log copy /y dashboard-run.log dashboard-run.last.log >nul 2>&1
powershell -NoProfile -Command "Start-Process -FilePath 'node' -ArgumentList 'server.js' -WindowStyle Hidden -WorkingDirectory '%~dp0' -RedirectStandardOutput '%~dp0dashboard-run.log' -RedirectStandardError '%~dp0dashboard-err.log'"
exit /b 0

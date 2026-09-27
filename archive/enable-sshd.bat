@echo off
rem ============================================================
rem  Enable OpenSSH Server on this Windows machine (qianli deploy target)
rem  Usage: right-click -> Run as administrator (or just double-click,
rem  it will self-elevate via UAC prompt)
rem ============================================================
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Requesting administrator rights, please click Yes on the UAC prompt...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo [1/4] Installing OpenSSH Server capability (skips automatically if already installed)...
powershell -NoProfile -Command "Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0.0"

echo [2/4] Setting sshd service to start automatically on boot...
powershell -NoProfile -Command "Set-Service sshd -StartupType Automatic"

echo [3/4] Starting sshd...
powershell -NoProfile -Command "Start-Service sshd"

echo [4/4] Ensuring firewall rule for port 22...
powershell -NoProfile -Command "if (-not (Get-NetFirewallRule -Name sshd -ErrorAction SilentlyContinue)) { New-NetFirewallRule -Name sshd -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 }"

echo.
echo ===== Current sshd service state =====
powershell -NoProfile -Command "Get-Service sshd | Format-Table -AutoSize Name,Status,StartType"
echo ======================================
echo If Status = Running, sshd is enabled. You can close this window.
echo If not Running and Step 1 showed an error, run:
echo   Get-WindowsCapability -Online -Name OpenSSH.Server*
echo and tell the assistant the output.
pause

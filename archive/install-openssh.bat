@echo off
rem ============================================================
rem  Install OpenSSH Server from local zip (self-elevating)
rem  Put this file AND OpenSSH-Win64.zip on the Desktop, then double-click.
rem ============================================================
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Requesting administrator rights, please click Yes on the UAC prompt...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
setlocal
set "ZIP="
if exist "%~dp0OpenSSH-Win64.zip" set "ZIP=%~dp0OpenSSH-Win64.zip"
if not defined ZIP if exist "%USERPROFILE%\Desktop\OpenSSH-Win64.zip" set "ZIP=%USERPROFILE%\Desktop\OpenSSH-Win64.zip"
if not defined ZIP if exist "%USERPROFILE%\Downloads\OpenSSH-Win64.zip" set "ZIP=%USERPROFILE%\Downloads\OpenSSH-Win64.zip"
if not defined ZIP (
  echo [ERR] OpenSSH-Win64.zip not found next to this file, on Desktop, or in Downloads.
  pause
  exit /b 1
)
echo [1/6] Using zip: %ZIP%
echo [2/6] Extracting to C:\Program Files ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '%ZIP%' -DestinationPath 'C:\Program Files' -Force"
if not exist "C:\Program Files\OpenSSH-Win64\install-sshd.ps1" (
  echo [ERR] Extraction failed - install-sshd.ps1 not found in C:\Program Files\OpenSSH-Win64
  pause
  exit /b 1
)
cd /d "C:\Program Files\OpenSSH-Win64"
echo [3/6] Registering sshd service ...
powershell -NoProfile -ExecutionPolicy Bypass -File ".\install-sshd.ps1"
echo [4/6] Setting autostart and starting service ...
sc config sshd start= auto
net start sshd
echo [5/6] Firewall rule for port 22 ...
powershell -NoProfile -Command "if (-not (Get-NetFirewallRule -Name sshd -ErrorAction SilentlyContinue)) { New-NetFirewallRule -Name sshd -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 }"
echo [6/6] Default shell: git-bash if PortableGit/Git is present ...
if exist "C:\PortableGit\bin\bash.exe" reg add "HKLM\SOFTWARE\OpenSSH" /v DefaultShell /d "C:\PortableGit\bin\bash.exe" /f
if exist "C:\Program Files\Git\bin\bash.exe" reg add "HKLM\SOFTWARE\OpenSSH" /v DefaultShell /d "C:\Program Files\Git\bin\bash.exe" /f
echo.
echo ===== sshd service state =====
sc query sshd | findstr "STATE"
echo ==============================
echo If STATE : 4  RUNNING  ->  SUCCESS. You can close this window.
echo If it failed, screenshot this window and send it to the assistant.
pause

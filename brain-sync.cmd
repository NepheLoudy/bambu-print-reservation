@echo off
rem brain-sync wrapper (ASCII only): locate git-bash, cd to repo root, run brain-sync.sh
setlocal enabledelayedexpansion
cd /d "%~dp0"
for /f "delims=" %%i in ('where git 2^>nul') do (
  set "GIT_EXE=%%i"
  goto :found
)
echo [brain-sync] git not found in PATH
exit /b 1
:found
for %%j in ("%GIT_EXE%") do set "GIT_HOME=%%~dpj.."
if not exist "%GIT_HOME%\usr\bin\bash.exe" set "GIT_HOME=%GIT_HOME%\.."
"%GIT_HOME%\usr\bin\bash.exe" .\brain-sync.sh %*

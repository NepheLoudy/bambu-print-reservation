@echo off
rem brain-sync wrapper (ASCII only): locate git-bash and run brain-sync.sh
setlocal enabledelayedexpansion
for /f "delims=" %%i in ('where git 2^>nul') do (
  set "GIT_EXE=%%i"
  goto :found
)
echo [brain-sync] git not found in PATH
exit /b 1
:found
for %%j in ("%GIT_EXE%") do set "GIT_HOME=%%~dpj.."
if exist "%GIT_HOME%\usr\bin\bash.exe" goto :run
if exist "%GIT_HOME%\..\usr\bin\bash.exe" set "GIT_HOME=%GIT_HOME%\.." 
:run
"%GIT_HOME%\usr\bin\bash.exe" "%~dp0brain-sync.sh" %*

@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
set "PORT=4173"
set "FOUND="

if exist "%~dp0.serve.pid" (
  set /p PID=<"%~dp0.serve.pid"
  call :kill !PID!
  del "%~dp0.serve.pid" >nul 2>&1
)

for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT% " ^| findstr LISTENING') do (
  call :kill %%p
)

if not defined FOUND echo nothing listening on port %PORT%
pause
exit /b 0

:kill
if "%~1"=="" exit /b 0
if "%~1"=="0" exit /b 0
tasklist /FI "PID eq %~1" | find "%~1" >nul
if errorlevel 1 exit /b 0
taskkill /PID %~1 /F >nul 2>&1
if errorlevel 1 (
  echo failed to stop PID=%~1. Open an admin terminal and run: taskkill /PID %~1 /F
) else (
  echo stopped PID=%~1
  set "FOUND=1"
)
exit /b 0
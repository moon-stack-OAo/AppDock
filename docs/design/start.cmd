@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
set "PORT=4173"

where node >nul 2>&1
if errorlevel 1 (
  echo node not found. Install Node.js first.
  pause
  exit /b 1
)

if exist "%~dp0.serve.pid" (
  set /p OLD_PID=<"%~dp0.serve.pid"
  tasklist /FI "PID eq !OLD_PID!" | find "!OLD_PID!" >nul
  if not errorlevel 1 (
    echo already running PID=!OLD_PID!
    goto :urls
  )
)

set "BUSY="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT% " ^| findstr LISTENING') do set "BUSY=%%p"
if defined BUSY (
  echo port %PORT% is in use by PID=!BUSY!. Run stop.cmd first.
  pause
  exit /b 1
)

start "appdock-design" /MIN cmd.exe /c npx.cmd --yes serve . -l tcp://0.0.0.0:%PORT%

set "PID="
for /l %%i in (1,1,20) do (
  if not defined PID (
    for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT% " ^| findstr LISTENING') do set "PID=%%p"
    if not defined PID ping -n 2 127.0.0.1 >nul
  )
)

if not defined PID (
  echo failed to start
  pause
  exit /b 1
)

>"%~dp0.serve.pid" echo !PID!
echo started PID=!PID!

:urls
echo.
echo local:   http://127.0.0.1:%PORT%
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  for /f "tokens=* delims= " %%b in ("%%a") do echo network: http://%%b:%PORT%
)
echo.
echo stop: double-click stop.cmd
pause
endlocal
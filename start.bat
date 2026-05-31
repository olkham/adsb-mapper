@echo off
REM ── ADS-B Mapper launcher (Windows) ────────────────────────────────────────
REM Usage:
REM   start.bat                         Launch with current .env settings
REM   start.bat ws://HOST:9001          Set broker URL, then launch
REM   start.bat ws://HOST:9001 adsb     Set broker URL + topic prefix, launch
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Run install.bat first ^(needs Node 18+^).
  exit /b 1
)

REM Optional: define the MQTT broker straight from the command line.
if not "%~1"=="" (
  > ".env" echo VITE_MQTT_URL=%~1
  if not "%~2"=="" (
    >> ".env" echo VITE_MQTT_PREFIX=%~2
  )
  echo Wrote .env  ^(broker: %~1^)
)

if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 exit /b 1
)

echo Starting ADS-B Mapper on http://localhost:5188
echo Press Ctrl+C to stop.
call npm run dev
endlocal

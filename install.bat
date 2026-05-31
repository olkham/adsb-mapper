@echo off
REM ── ADS-B Mapper installer (Windows) ───────────────────────────────────────
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found.
  echo Install Node.js 18 or newer from https://nodejs.org/ and try again.
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found. Reinstall Node.js from https://nodejs.org/
  exit /b 1
)

if not exist ".env" (
  if exist ".env.example" (
    copy /y ".env.example" ".env" >nul
    echo Created .env from .env.example - edit it to point at your MQTT broker.
  )
)

echo Installing dependencies...
call npm install
if errorlevel 1 (
  echo [ERROR] npm install failed.
  exit /b 1
)

echo.
echo Done. Launch the app with start.bat
endlocal

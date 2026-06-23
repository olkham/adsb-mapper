@echo off
REM ── ADS-B Mapper – install as a Windows service via NSSM ──────────────────
REM Usage (run as Administrator):
REM   install-service.bat              Install / reinstall the service
REM   install-service.bat uninstall    Remove the service
REM
REM Requires NSSM (Non-Sucking Service Manager) – https://nssm.cc
REM   winget install nssm   (Windows 10+)
REM   Or download nssm.exe and place it on your PATH.
setlocal EnableDelayedExpansion
cd /d "%~dp0"
set SERVICE_NAME=adsb-mapper
set APP_DIR=%~dp0

REM ── Admin check ──────────────────────────────────────────────────────────
net session >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Please run this script as Administrator.
  pause
  exit /b 1
)

REM ── Uninstall ─────────────────────────────────────────────────────────────
if /i "%~1"=="uninstall" (
  echo Removing service "%SERVICE_NAME%"...
  nssm stop    "%SERVICE_NAME%" >nul 2>&1
  nssm remove  "%SERVICE_NAME%" confirm
  echo Service removed.
  pause
  exit /b 0
)

REM ── Node check ────────────────────────────────────────────────────────────
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Run install.bat first ^(needs Node 18+^).
  pause
  exit /b 1
)
for /f "delims=" %%N in ('where node') do set NODE_EXE=%%N

REM ── npm check ─────────────────────────────────────────────────────────────
where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm was not found. Ensure Node.js is properly installed.
  pause
  exit /b 1
)
for /f "delims=" %%M in ('where npm') do set NPM_EXE=%%M

REM ── NSSM check ────────────────────────────────────────────────────────────
where nssm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] NSSM not found on PATH.
  echo.
  echo  Install it with:   winget install nssm
  echo  Or download from:  https://nssm.cc/download
  echo  Then add nssm.exe to a folder on your PATH and re-run this script.
  pause
  exit /b 1
)

REM ── Install npm dependencies if needed ────────────────────────────────────
if not exist "%APP_DIR%node_modules" (
  echo Installing npm dependencies...
  call npm install
  if errorlevel 1 ( echo [ERROR] npm install failed. & pause & exit /b 1 )
)

REM ── Remove any existing service instance ──────────────────────────────────
nssm status "%SERVICE_NAME%" >nul 2>&1
if not errorlevel 1 (
  echo Removing existing "%SERVICE_NAME%" service...
  nssm stop   "%SERVICE_NAME%" >nul 2>&1
  nssm remove "%SERVICE_NAME%" confirm
)

REM ── Create service ────────────────────────────────────────────────────────
echo Installing service "%SERVICE_NAME%"...

REM Use cmd.exe as the application so npm (a .cmd script) runs correctly
nssm install "%SERVICE_NAME%" "%ComSpec%"
nssm set     "%SERVICE_NAME%" AppParameters  /c "npm run dev"
nssm set     "%SERVICE_NAME%" AppDirectory   "%APP_DIR%"
nssm set     "%SERVICE_NAME%" DisplayName    "ADS-B Mapper"
nssm set     "%SERVICE_NAME%" Description    "Local aircraft tracking map on http://localhost:5188"
nssm set     "%SERVICE_NAME%" Start          SERVICE_AUTO_START

REM ── Log output to files ───────────────────────────────────────────────────
nssm set "%SERVICE_NAME%" AppStdout "%APP_DIR%logs\service-stdout.log"
nssm set "%SERVICE_NAME%" AppStderr "%APP_DIR%logs\service-stderr.log"
nssm set "%SERVICE_NAME%" AppRotateFiles 1
nssm set "%SERVICE_NAME%" AppRotateSeconds 86400

REM Create logs directory if it does not exist
if not exist "%APP_DIR%logs" mkdir "%APP_DIR%logs"

REM ── Start the service ─────────────────────────────────────────────────────
nssm start "%SERVICE_NAME%"
if errorlevel 1 (
  echo [WARNING] Service installed but could not be started immediately.
  echo           Check: sc query %SERVICE_NAME%
) else (
  echo.
  echo Service "%SERVICE_NAME%" installed and started.
)

echo.
echo   Open    :  http://localhost:5188
echo   Status  :  sc query %SERVICE_NAME%
echo   Stop    :  sc stop  %SERVICE_NAME%
echo   Remove  :  install-service.bat uninstall
echo.
pause
endlocal

@echo off
REM  ADS-B Mapper - restart the running service (Windows / NSSM)
REM  Use this after editing .env so Vite picks up the new values.
REM  Run as Administrator.

set SERVICE_NAME=adsb-mapper

where nssm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] NSSM not found on PATH.
  echo         The service is managed with NSSM - install it, or if you run the
  echo         app with start.bat just close that window and run start.bat again.
  exit /b 1
)

nssm status "%SERVICE_NAME%" >nul 2>&1
if errorlevel 1 (
  echo [INFO] The %SERVICE_NAME% service is not installed.
  echo        If you run the app with start.bat, close that window and run start.bat again.
  exit /b 0
)

echo Restarting service "%SERVICE_NAME%"...
nssm restart "%SERVICE_NAME%"
echo Done.

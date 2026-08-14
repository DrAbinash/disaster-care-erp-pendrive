@echo off
setlocal
cd /d "%~dp0"
set PENDRIVE_ROOT=%~dp0
set HOST=127.0.0.1
set PORT=8898
echo.
echo CARE Ultra-Emergency Billing (USB)
echo Use ONLY if CARE and DS225+ are both down.
echo.
if exist "%~dp0runtime\node.exe" (
  start "" "http://127.0.0.1:8898/"
  "%~dp0runtime\node.exe" "%~dp0app\server.mjs"
) else (
  where node >nul 2>&1
  if errorlevel 1 (
    echo Node.js was not found on this PC, and runtime\node.exe is missing.
    echo Copy this zip from a PC that ran npm run pack, or install Node 22.
    pause
    exit /b 1
  )
  start "" "http://127.0.0.1:8898/"
  node "%~dp0app\server.mjs"
)
echo.
echo Stopped. Export CSV is also saved in the export folder on this stick.
pause

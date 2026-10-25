@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js 20+ tidak ditemukan.
  pause
  exit /b 1
)
echo Buka http://127.0.0.1:8765 di browser.
echo Tekan Ctrl+C untuk berhenti.
node bin\fows.js serve --port 8765
pause

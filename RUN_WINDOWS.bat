@echo off
setlocal
cd /d "%~dp0"
echo ===============================================
echo   FOWS v0.1.0 - Node.js Read-Only Quickstart
 echo ===============================================
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js tidak ditemukan di PATH.
  echo Install Node.js 20+ terlebih dahulu.
  pause
  exit /b 1
)
node bin\fows.js doctor
if errorlevel 1 (
  pause
  exit /b 1
)
echo.
set /p "ROOT=Folder yang ingin discan (contoh D:\Projects): "
if "%ROOT%"=="" (
  echo [BATAL] Folder tidak diisi.
  pause
  exit /b 1
)
echo.
node bin\fows.js scan --root "%ROOT%"
if errorlevel 1 (
  echo [ERROR] Scan gagal, periksa path dan izin.
  pause
  exit /b 1
)
echo.
node bin\fows.js types --root "%ROOT%" --limit 15
echo.
set /p "WATCH=Jalankan watch 30 detik? (Y/N): "
if /i not "%WATCH%"=="Y" goto END
node bin\fows.js watch --root "%ROOT%" --interval 1000 --seconds 30
if errorlevel 1 goto END
echo.
echo ============= SESSION DIFF ==================
node bin\fows.js diff --session latest
:END
echo.
echo Untuk dashboard, jalankan DASHBOARD_WINDOWS.bat
echo Data FOWS berada di folder data\ pada proyek.
pause

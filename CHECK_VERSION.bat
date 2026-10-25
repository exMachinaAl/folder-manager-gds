@echo off
setlocal EnableExtensions DisableDelayedExpansion
pushd "%~dp0" || exit /b 1
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js tidak tersedia pada PATH.
  popd
  pause
  exit /b 1
)
node "scripts\version-check.mjs" %*
set "RC=%ERRORLEVEL%"
popd
if not defined FOWS_NO_PAUSE pause
exit /b %RC%

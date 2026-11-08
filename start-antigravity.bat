@echo off
setlocal
cd /d "%~dp0"
node auto-inject.js --launch %*
if errorlevel 1 (
  echo Launch or injection failed. See the error above.
  pause
  exit /b 1
)
endlocal

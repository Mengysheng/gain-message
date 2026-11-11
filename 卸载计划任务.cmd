@echo off
rem Double-click me to unregister the scheduled task.
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-boot-task.ps1" -Uninstall
echo.
pause

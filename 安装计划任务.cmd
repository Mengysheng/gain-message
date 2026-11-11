@echo off
rem Double-click me to register the Windows scheduled task and run it once.
rem ASCII only on purpose: cmd.exe reads .bat/.cmd in the console code page,
rem non-ASCII here would be mangled on some machines.
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-boot-task.ps1" -RunNow
echo.
pause

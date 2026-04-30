@echo off
set SCRIPT_DIR=%~dp0
if exist "%SCRIPT_DIR%dist\TimeToDeny.exe" (
  "%SCRIPT_DIR%dist\TimeToDeny.exe" %*
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%windows.ps1" %*
)

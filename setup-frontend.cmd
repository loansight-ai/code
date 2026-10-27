@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-frontend.ps1" %*
exit /b %errorlevel%

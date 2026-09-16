@echo off
setlocal
cd /d "%~dp0.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-SiatoyPrinter.ps1" -SourceRoot "%CD%"
if errorlevel 1 pause

@echo off
cd /d "%~dp0"
set "NODE_EXE=node.exe"
if exist "%~dp0runtime\node.exe" set "NODE_EXE=%~dp0runtime\node.exe"
powershell.exe -NoProfile -Command "if (-not (Test-NetConnection 127.0.0.1 -Port 18767 -InformationLevel Quiet -WarningAction SilentlyContinue)) { Start-Process -FilePath '%NODE_EXE%' -ArgumentList 'server.cjs' -WorkingDirectory (Get-Location).Path -WindowStyle Hidden }; Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:18767/'"

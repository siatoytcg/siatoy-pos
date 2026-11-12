@echo off
cd /d "%~dp0"
set "NODE_EXE=node.exe"
if exist "%~dp0runtime\node.exe" set "NODE_EXE=%~dp0runtime\node.exe"
powershell.exe -NoProfile -Command "$c=Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 18767 -State Listen -ErrorAction SilentlyContinue; if($c){$p=Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue; if($p -and $p.ProcessName -in @('node','nodejs')){Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 300}}; Start-Process -FilePath '%NODE_EXE%' -ArgumentList 'server.cjs' -WorkingDirectory (Get-Location).Path -WindowStyle Hidden; Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:18767/'"

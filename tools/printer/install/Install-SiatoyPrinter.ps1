[CmdletBinding()]
param(
  [string]$SourceRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$DriverInf = ''
)

$ErrorActionPreference = 'Stop'
$installRoot = Join-Path $env:LOCALAPPDATA 'SiatoyPrinter'
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Siatoy TCG'

function Fail([string]$Message) {
  Write-Host "Installation failed: $Message" -ForegroundColor Red
  exit 1
}

$node = Get-Command node.exe -ErrorAction SilentlyContinue
$bundledNode = Join-Path $SourceRoot 'runtime\node.exe'
if (-not $node -and -not (Test-Path -LiteralPath $bundledNode)) {
  Fail 'Node.js was not found. Install Node.js LTS or include runtime\node.exe in this package.'
}

$required = @('server.cjs','bridge.html','bridge.js','print-labels.ps1','label-text.ps1','patterns.json','printer-profile.json','Start-Printer.cmd')
foreach ($name in $required) {
  $source = Join-Path $SourceRoot $name
  if (-not (Test-Path -LiteralPath $source)) { Fail "Missing package file: $name" }
}

New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
foreach ($name in $required) {
  Copy-Item -LiteralPath (Join-Path $SourceRoot $name) -Destination $installRoot -Force
}
$vendor = Join-Path $SourceRoot 'vendor'
if (Test-Path -LiteralPath $vendor) {
  Copy-Item -LiteralPath $vendor -Destination $installRoot -Recurse -Force
}
if (Test-Path -LiteralPath $bundledNode) {
  New-Item -ItemType Directory -Force -Path (Join-Path $installRoot 'runtime') | Out-Null
  Copy-Item -LiteralPath $bundledNode -Destination (Join-Path $installRoot 'runtime\node.exe') -Force
}

$bundledDriver = Join-Path $SourceRoot 'vendor\4BARCODE_2024.2_M-3.zip'
if ((-not $DriverInf) -and (Test-Path -LiteralPath $bundledDriver)) {
  $driverTemp = Join-Path ([IO.Path]::GetTempPath()) ('siatoy-driver-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $driverTemp | Out-Null
  Expand-Archive -LiteralPath $bundledDriver -DestinationPath $driverTemp -Force
  $driverExe = Get-ChildItem -LiteralPath $driverTemp -Filter '*.exe' -File -Recurse | Select-Object -First 1
  if ($driverExe) {
    Write-Host 'Launching the bundled 4BARCODE driver installer...'
    Start-Process -FilePath $driverExe.FullName -Wait
  }
  Remove-Item -LiteralPath $driverTemp -Recurse -Force -ErrorAction SilentlyContinue
}

if ($DriverInf) {
  if (-not (Test-Path -LiteralPath $DriverInf)) { Fail "Missing printer driver: $DriverInf" }
  Write-Host 'Installing printer driver (administrator permission may be required)...'
  $driver = Start-Process pnputil.exe -ArgumentList @('/add-driver', $DriverInf, '/install') -Wait -PassThru
  if ($driver.ExitCode -ne 0) { Fail "Printer driver installation failed (exit code $($driver.ExitCode))" }
}

New-Item -ItemType Directory -Force -Path $startMenu | Out-Null
$shortcutPath = Join-Path $startMenu 'Siatoy Printer Helper.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $installRoot 'Start-Printer.cmd'
$shortcut.WorkingDirectory = $installRoot
$shortcut.Description = 'Siatoy TCG label printer helper'
$shortcut.Save()

Start-Process -FilePath (Join-Path $installRoot 'Start-Printer.cmd') -WorkingDirectory $installRoot
Write-Host "Installation complete: $installRoot" -ForegroundColor Green
Write-Host 'Open Siatoy POS and print labels.'

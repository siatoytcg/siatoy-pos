[CmdletBinding()]
param(
  [string]$Output = '',
  [string]$DriverPackage = ''
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if (-not $Output) { $Output = Join-Path (Split-Path -Parent $root) 'Siatoy-Printer-Installer.zip' }
$stage = Join-Path ([IO.Path]::GetTempPath()) ('siatoy-printer-package-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $stage | Out-Null
try {
  $include = @('server.cjs','bridge.html','bridge.js','print-labels.ps1','label-text.ps1','patterns.json','printer-profile.json','Start-Printer.cmd','install')
  foreach ($item in $include) { Copy-Item -LiteralPath (Join-Path $root $item) -Destination $stage -Recurse -Force }
  if ($DriverPackage) {
    if (-not (Test-Path -LiteralPath $DriverPackage)) { throw "Driver package not found: $DriverPackage" }
    New-Item -ItemType Directory -Force -Path (Join-Path $stage 'vendor') | Out-Null
    Copy-Item -LiteralPath $DriverPackage -Destination (Join-Path $stage 'vendor\4BARCODE_2024.2_M-3.zip') -Force
  }
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($node) {
    New-Item -ItemType Directory -Force -Path (Join-Path $stage 'runtime') | Out-Null
    Copy-Item -LiteralPath $node.Source -Destination (Join-Path $stage 'runtime\node.exe') -Force
  } else {
    Write-Warning 'node.exe not found; package will require Node.js on the customer computer.'
  }
  $readme = Join-Path $stage 'INSTALL.txt'
  @(
    'Siatoy TCG Printer Helper',
    '',
    '1. Install Node.js LTS and the 4BARCODE 4B-2054 Windows driver.',
    '2. Open the install folder and run Install-SiatoyPrinter.cmd.',
    '3. Open Siatoy POS and allow the printer helper popup.'
  ) | Set-Content -LiteralPath $readme -Encoding ascii
  if (Test-Path -LiteralPath $Output) { Remove-Item -LiteralPath $Output -Force }
  Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $Output -CompressionLevel Optimal
  Write-Host "Created $Output"
} finally {
  Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
}

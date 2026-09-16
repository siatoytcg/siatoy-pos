$ErrorActionPreference='Stop'
$path=Join-Path $PSScriptRoot 'patterns.json'
$legacy=@(Get-Content -LiteralPath $path -Raw | ConvertFrom-Json)
Write-Output "Windows PowerShell $($PSVersionTable.PSVersion): legacy outer count=$($legacy.Count), first element type=$($legacy[0].GetType().Name)"
$direct=Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
if($direct.Count -ne 107 -or $direct[0] -ne '212222' -or $direct[106] -ne '2331112'){throw 'Direct JSON array check failed'}
& (Join-Path $PSScriptRoot 'print-labels.ps1') -ValidateOnly
Write-Output 'PASS: JSON array indexed correctly and native validation completed without printing'

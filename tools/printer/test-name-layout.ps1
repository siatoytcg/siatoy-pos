$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
. (Join-Path $PSScriptRoot 'label-text.ps1')
$bitmap=[Drawing.Bitmap]::new(480,140)
$bitmap.SetResolution(203,203)
$g=[Drawing.Graphics]::FromImage($bitmap)
$g.Clear([Drawing.Color]::White)
$g.PageUnit=[Drawing.GraphicsUnit]::Millimeter
$name='Pokémon SV8a Terastal Festival · Booster Box'
Draw-ProductName -Graphics $g -Text $name -Bounds ([Drawing.RectangleF]::new(1,1,30,5.5))
$bitmap.Save((Join-Path $PSScriptRoot 'name-layout-check.png'),[Drawing.Imaging.ImageFormat]::Png)
$g.Dispose();$bitmap.Dispose()
Write-Output 'PASS: rendered long product name using production drawing function'

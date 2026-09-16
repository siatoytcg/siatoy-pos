param([string]$JobPath, [switch]$ValidateOnly)
$ErrorActionPreference = 'Stop'
$profile = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'printer-profile.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$names = @()
if ($JobPath) {
    $job = Get-Content -LiteralPath $JobPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $profile.testCodes = @($job.codes)
    if ($null -eq $job.names) { throw 'Missing product names. Refresh POS and create a new job.' }
    if ($null -ne $job.names) {
        $names = @($job.names)
        if ($names.Count -ne $profile.testCodes.Count) { throw 'Product names must match codes.' }
        foreach ($name in $names) { if ($name -isnot [string] -or $name.Length -gt 200 -or $name -match '[\x00-\x1f\x7f]') { throw 'Invalid product name.' } }
    }
}
if ($profile.testCodes.Count -lt 1 -or $profile.testCodes.Count -gt 500) { throw 'Between 1 and 500 labels required.' }
foreach ($code in $profile.testCodes) {
    if ($code -isnot [string] -or $code -notmatch '^[\x20-\x7e]{1,24}$') { throw 'Invalid barcode text.' }
    $dataCount = if ($code -match '^([0-9]{2}){2,}$') { $code.Length/2 } else { $code.Length }
    $width = (35+11*$dataCount)*(25.4/$profile.dpi*$profile.moduleDots)*$profile.barcodeWidthScale + 20*(25.4/$profile.dpi*$profile.moduleDots)
    if ($width -gt ($profile.labelWidthMm-2)) { throw 'Barcode exceeds label width.' }
}
# Windows PowerShell 5.1 emits the JSON array as a single pipeline object.
# Assign directly so indexing addresses individual symbols, not a nested array.
$patterns = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'patterns.json') -Raw | ConvertFrom-Json
if ($patterns.Count -ne 107) { throw 'Barcode patterns missing' }
for ($symbolIndex = 0; $symbolIndex -lt 107; $symbolIndex++) {
    $pattern = $patterns[$symbolIndex]
    $expectedLength = if ($symbolIndex -eq 106) { 7 } else { 6 }
    $expectedUnits = if ($symbolIndex -eq 106) { 13 } else { 11 }
    if ($pattern -isnot [string] -or $pattern -notmatch '^[1-4]+$' -or $pattern.Length -ne $expectedLength) { throw 'Invalid barcode pattern' }
    $units = 0
    foreach ($digit in $pattern.ToCharArray()) { $units += [int]::Parse([string]$digit) }
    if ($units -ne $expectedUnits) { throw 'Invalid barcode pattern width' }
}
if ($ValidateOnly) { Write-Output 'VALIDATED: codes and 107 barcode patterns'; return }
Add-Type -AssemblyName System.Drawing
. (Join-Path $PSScriptRoot 'label-text.ps1')
$doc = [Drawing.Printing.PrintDocument]::new()
$doc.PrinterSettings.PrinterName = $profile.printerName
if (-not $doc.PrinterSettings.IsValid) { throw 'Printer unavailable' }
$doc.DocumentName = 'Siatoy POS - calibrated labels'
$doc.PrinterSettings.Copies = 1
$doc.PrintController = [Drawing.Printing.StandardPrintController]::new()
# Preserve the driver's stock and media settings for this diagnostic print.
# A custom PaperSize can change the feed length independently of gap sensing.
$stock = $doc.DefaultPageSettings.PaperSize
Write-Output ('DRIVER STOCK: {0}; {1:N2} x {2:N2} mm' -f $stock.PaperName,($stock.Width*0.254),($stock.Height*0.254))
if ($stock.Width*0.254 -lt 100 -or $stock.Height*0.254 -lt 24) {
    $doc.Dispose()
    throw 'Driver stock is too small for the three-label test; no job sent.'
}
if (($profile.codeYmm + $profile.contentOffsetYmm + 4) -gt ($stock.Height*0.254)) { throw 'Content exceeds driver stock height; no job sent.' }
$doc.DefaultPageSettings.Margins = [Drawing.Printing.Margins]::new(0,0,0,0)
$doc.DefaultPageSettings.Landscape = $false
$script:printRow = 0
$doc.add_PrintPage({
 param($sender,$e)
 $g=$e.Graphics
 $g.PageUnit=[Drawing.GraphicsUnit]::Millimeter
 $g.TranslateTransform(-$e.PageSettings.HardMarginX*0.254,-$e.PageSettings.HardMarginY*0.254)
 $g.SmoothingMode=[Drawing.Drawing2D.SmoothingMode]::None
 $font=[Drawing.Font]::new('Arial',$profile.fontPoints)
 $format=[Drawing.StringFormat]::new()
 $format.Alignment=[Drawing.StringAlignment]::Center
 try {
  for($i=0;$i -lt $profile.columns;$i++) {
   $index=$script:printRow*3+$i
   if ($index -ge $profile.testCodes.Count) { continue }
   $code=$profile.testCodes[$index]
   $start=104
   if ($code -match '^([0-9]{2}){2,}$') {
    $start=105; $data=@(for($k=0;$k -lt $code.Length;$k+=2){[int]::Parse($code.Substring($k,2))})
   } else { $data=@($code.ToCharArray() | ForEach-Object { [int]$_-32 }) }
   $checksum=$start
   for($j=0;$j -lt $data.Count;$j++) { $checksum += $data[$j]*($j+1) }
   $symbols=@($start)+$data+@(($checksum%103),106)
   $module=25.4/$profile.dpi*$profile.moduleDots
   $scale=if ($null -ne $profile.barcodeWidthScale) { [double]$profile.barcodeWidthScale } else { 1.0 }
   if ($scale -lt 0.8 -or $scale -gt 1) { throw 'Barcode width scale must be between 0.8 and 1.' }
   # Preserve the original quiet zones while narrowing the bar pattern.
   $quietMm=10*$module
   $module*=$scale
   $units=20
   foreach($symbol in $symbols){foreach($c in $patterns[$symbol].ToCharArray()){$units += [int]::Parse([string]$c)}}
   $left=$profile.leftMm+$i*($profile.labelWidthMm+$profile.columnGapMm)+[double]$profile.contentOffsetXmm
   $barcodeWidth=($units-20)*$module+2*$quietMm
   if ($barcodeWidth -gt ($profile.labelWidthMm-2)) { throw 'Barcode exceeds label width.' }
   $x=$left+($profile.labelWidthMm-$barcodeWidth)/2+$quietMm
   foreach($symbol in $symbols){$bar=$true;foreach($c in $patterns[$symbol].ToCharArray()){
    $w=[int]::Parse([string]$c)*$module
    if($bar){$g.FillRectangle([Drawing.Brushes]::Black,[single]$x,[single]($profile.barcodeYmm+$profile.contentOffsetYmm),[single]$w,[single]$profile.barcodeHeightMm)}
    $x+=$w;$bar=-not $bar
   }}
   $g.DrawString($profile.title,[Drawing.Font]$font,[Drawing.Brushes]::Black,[Drawing.RectangleF]::new($left,($profile.titleYmm+$profile.contentOffsetYmm),$profile.labelWidthMm,4),$format)
   if ($index -lt $names.Count -and $names[$index]) {
    Draw-ProductName -Graphics $g -Text $names[$index] -Bounds ([Drawing.RectangleF]::new(($left+1),($profile.productNameYmm+$profile.contentOffsetYmm),($profile.labelWidthMm-2),$profile.productNameHeightMm)) -FontPoints $profile.productNameFontPoints
   }
   $g.DrawString($code,[Drawing.Font]$font,[Drawing.Brushes]::Black,[Drawing.RectangleF]::new($left,($profile.codeYmm+$profile.contentOffsetYmm),$profile.labelWidthMm,4),$format)
  }
 } finally {$font.Dispose();$format.Dispose()}
 $script:printRow++
 $e.HasMorePages=($script:printRow*3 -lt $profile.testCodes.Count)
})
try { $doc.Print(); Write-Output ('SUBMITTED: {0} labels, {1} rows' -f $profile.testCodes.Count,[Math]::Ceiling($profile.testCodes.Count/3)) } finally {$doc.Dispose()}

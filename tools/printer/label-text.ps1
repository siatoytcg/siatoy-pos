function Draw-ProductName {
    param($Graphics, [string]$Text, [System.Drawing.RectangleF]$Bounds, [double]$FontPoints = 6.5)
    $format = [System.Drawing.StringFormat]::new()
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $format.FormatFlags = [System.Drawing.StringFormatFlags]::LineLimit
    $format.Trimming = [System.Drawing.StringTrimming]::EllipsisCharacter
    $font = $null
    try {
        for ($size = $FontPoints; $size -ge 5.5; $size -= 0.25) {
            if ($font) { $font.Dispose() }
            $font = [System.Drawing.Font]::new('Tahoma', [single]$size)
            $characters = 0; $lines = 0
            [void]$Graphics.MeasureString($Text, $font, $Bounds.Size, $format, [ref]$characters, [ref]$lines)
            if ($characters -ge $Text.Length -and $lines -le 2) { break }
        }
        $Graphics.DrawString($Text, $font, [System.Drawing.Brushes]::Black, $Bounds, $format)
    } finally {
        if ($font) { $font.Dispose() }
        $format.Dispose()
    }
}

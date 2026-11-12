param(
  [ValidateSet('Restart','Clear')][string]$Action = 'Restart',
  [string]$PrinterName = ''
)
$ErrorActionPreference = 'Stop'
Set-Service -Name Spooler -StartupType Automatic

if ($Action -eq 'Restart') {
  if ((Get-Service -Name Spooler).Status -eq 'Running') {
    Restart-Service -Name Spooler -Force
  } else {
    Start-Service -Name Spooler
  }
  Write-Output 'Spooler restarted'
  exit 0
}

if ([string]::IsNullOrWhiteSpace($PrinterName)) {
  throw 'Printer name is required when clearing print jobs.'
}
if ((Get-Service -Name Spooler).Status -ne 'Running') {
  Start-Service -Name Spooler
}
$jobs = @(Get-PrintJob -PrinterName $PrinterName -ErrorAction Stop)
foreach ($job in $jobs) {
  Remove-PrintJob -PrinterName $PrinterName -Id $job.Id -ErrorAction Stop
}
Write-Output ("Cleared {0} print job(s)" -f $jobs.Count)

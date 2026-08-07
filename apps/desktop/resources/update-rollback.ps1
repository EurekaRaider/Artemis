param(
  [Parameter(Mandatory = $true)]
  [string]$HealthMarkerPath,

  [Parameter(Mandatory = $true)]
  [string]$PreviousInstallerPath,

  [Parameter(Mandatory = $true)]
  [int]$ApplicationProcessId,

  [int]$TimeoutSeconds = 90
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$marker = [System.IO.Path]::GetFullPath($HealthMarkerPath)
$installer = [System.IO.Path]::GetFullPath($PreviousInstallerPath)
if (-not $installer.EndsWith('.exe', [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'Rollback artifact must be an executable installer'
}
if (-not [System.IO.File]::Exists($installer)) {
  throw "Rollback installer is missing: $installer"
}
if ($TimeoutSeconds -lt 10 -or $TimeoutSeconds -gt 600) {
  throw 'Rollback timeout is outside the supported range'
}

for ($elapsed = 0; $elapsed -lt $TimeoutSeconds; $elapsed += 1) {
  if ([System.IO.File]::Exists($marker)) {
    exit 0
  }
  Start-Sleep -Seconds 1
}

if ([System.IO.File]::Exists($marker)) {
  exit 0
}

$applicationProcess = Get-Process -Id $ApplicationProcessId -ErrorAction SilentlyContinue
if ($null -ne $applicationProcess) {
  Stop-Process -Id $ApplicationProcessId -Force
  $applicationProcess.WaitForExit()
}

Start-Process -FilePath $installer -ArgumentList @('/S', '--force-run')
exit 2

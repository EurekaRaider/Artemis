param([Parameter(Mandatory = $true)][string]$StatePath)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$state = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
$pending = $state.pending
if (-not $pending) { throw 'Missing update transaction' }
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Save-State {
  $temporary = "$StatePath.helper.tmp"
  [IO.File]::WriteAllText($temporary, ($state | ConvertTo-Json -Depth 12), $utf8)
  Move-Item -LiteralPath $temporary -Destination $StatePath -Force
}
function Test-Installer([string]$Path, [string]$Hash) {
  if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Hash) { throw 'Installer hash mismatch' }
}
function Run-Installer([string]$Path) {
  $process = Start-Process -FilePath $Path -ArgumentList '/S' -PassThru
  if (-not $process.WaitForExit(180000)) { Stop-Process -Id $process.Id -Force; throw 'Installer timed out' }
  if ($process.ExitCode -ne 0) { throw "Installer exited $($process.ExitCode)" }
}
function Start-Artemis {
  return Start-Process -FilePath $pending.executable -ArgumentList ('--user-data-dir="' + $pending.userData + '"') -PassThru
}
Test-Installer $pending.installer $pending.installerHash
Test-Installer $pending.previousInstaller $pending.previousHash
if (-not (Test-Path -LiteralPath $pending.databaseBackup)) { throw 'Database backup missing' }
[IO.File]::WriteAllText($pending.readyMarker, $pending.version, $utf8)
# Never overwrite a running application's database or installation.
$parent = Get-Process -Id $pending.parentPid -ErrorAction SilentlyContinue
$exitDeadline = [DateTime]::UtcNow.AddSeconds(45)
while ($parent -and -not $parent.HasExited) {
  if (Test-Path -LiteralPath $pending.cancelMarker) { exit 1 }
  if ([DateTime]::UtcNow -ge $exitDeadline) {
    $state.PSObject.Properties.Remove('pending'); Save-State
    exit 1
  }
  Start-Sleep -Milliseconds 100
  $parent.Refresh()
}
if (Test-Path -LiteralPath $pending.cancelMarker) { exit 1 }
$newProcess = $null
try {
  Run-Installer $pending.installer
  $newProcess = Start-Artemis
  $deadline = [DateTime]::UtcNow.AddSeconds(120)
  while ([DateTime]::UtcNow -lt $deadline) {
    if ((Test-Path -LiteralPath $pending.healthMarker) -and (Get-Content -LiteralPath $pending.healthMarker -Raw).Trim() -eq $pending.version) {
      $state.PSObject.Properties.Remove('pending'); Save-State
      exit 0
    }
    Start-Sleep -Milliseconds 250
  }
  throw 'Application health deadline exceeded'
} catch {
  if ($newProcess -and -not $newProcess.HasExited) {
    & "$env:SystemRoot\System32\taskkill.exe" /PID $newProcess.Id /T /F | Out-Null
    if (-not $newProcess.WaitForExit(10000)) { throw 'Cannot stop unhealthy application; database preserved' }
  }
  # One recovery attempt; record quarantine before launching the old build.
  $quarantined = @()
  if ($state.PSObject.Properties.Name -contains 'quarantined') { $quarantined = @($state.quarantined) }
  $state | Add-Member -NotePropertyName quarantined -NotePropertyValue (@($quarantined + $pending.version) | Select-Object -Unique) -Force
  $state.PSObject.Properties.Remove('pending'); Save-State
  Test-Installer $pending.previousInstaller $pending.previousHash
  Run-Installer $pending.previousInstaller
  Remove-Item -LiteralPath ($pending.databasePath + '-wal'), ($pending.databasePath + '-shm') -Force -ErrorAction SilentlyContinue
  Copy-Item -LiteralPath $pending.databaseBackup -Destination $pending.databasePath -Force
  Start-Artemis | Out-Null
  exit 1
}

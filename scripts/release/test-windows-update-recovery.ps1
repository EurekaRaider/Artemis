# Fault injection for the real external recovery helper. Uses disposable fake
# installers; final NSIS installation is covered by verify-windows-installed.mjs.
param([string]$Helper = (Join-Path $PSScriptRoot '../../apps/desktop/resources/windows-install-recover.ps1'), [string[]]$Scenarios = @('healthy', 'installer-failure', 'health-timeout', 'tampered', 'cancelled'))
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Join-Path ([IO.Path]::GetTempPath()) ('Artemis-recovery-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
$source = @'
using System;
using System.IO;
using System.Diagnostics;
public class RecoveryProbe {
  public static int Main(string[] args) {
    string name = Path.GetFileNameWithoutExtension(Process.GetCurrentProcess().MainModule.FileName);
    string root = Environment.GetEnvironmentVariable("ARTEMIS_RECOVERY_PROBE");
    File.AppendAllText(Path.Combine(root, "calls.txt"), name + "\n");
    if (name == "failed") return 7;
    if (name == "healthy") File.WriteAllText(Path.Combine(root, "healthy.marker"), "2.0.0");
    return 0;
  }
}
'@
try {
  $binary = Join-Path $root 'probe.exe'
  Add-Type -TypeDefinition $source -OutputAssembly $binary -OutputType ConsoleApplication
  foreach ($name in @('next', 'old', 'failed', 'healthy', 'unhealthy')) { Copy-Item $binary (Join-Path $root "$name.exe") }
  $env:ARTEMIS_RECOVERY_PROBE = $root
  foreach ($scenario in $Scenarios) {
    foreach ($file in @('calls.txt', 'healthy.marker', 'ready.marker', 'cancel.marker')) { Remove-Item (Join-Path $root $file) -Force -ErrorAction SilentlyContinue }
    $database = Join-Path $root 'database.sqlite'
    $backup = Join-Path $root 'backup.sqlite'
    [IO.File]::WriteAllText($database, 'new-database')
    [IO.File]::WriteAllText($backup, 'old-database')
    $installer = Join-Path $root $(if ($scenario -eq 'installer-failure') { 'failed.exe' } else { 'next.exe' })
    $old = Join-Path $root 'old.exe'
    $pending = @{
      version = '2.0.0'; previousVersion = '1.0.0'; installer = $installer; previousInstaller = $old
      installerHash = (Get-FileHash $installer -Algorithm SHA256).Hash.ToLowerInvariant()
      previousHash = (Get-FileHash $old -Algorithm SHA256).Hash.ToLowerInvariant()
      databasePath = $database; databaseBackup = $backup; userData = $root
      executable = Join-Path $root $(if ($scenario -eq 'healthy') { 'healthy.exe' } else { 'unhealthy.exe' })
      healthMarker = Join-Path $root 'healthy.marker'; readyMarker = Join-Path $root 'ready.marker'
      cancelMarker = Join-Path $root 'cancel.marker'; parentPid = 2147483647
    }
    if ($scenario -eq 'tampered') { $pending.installerHash = ('0' * 64) }
    if ($scenario -eq 'cancelled') { [IO.File]::WriteAllText($pending.cancelMarker, 'cancelled') }
    $statePath = Join-Path $root 'state.json'
    @{sequence = 10; pending = $pending} | ConvertTo-Json -Depth 12 | Set-Content $statePath -Encoding UTF8
    $ErrorActionPreference = 'Continue'
    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $Helper -StatePath $statePath 2>&1 | Out-Host
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    $state = Get-Content $statePath -Raw | ConvertFrom-Json
    if ($scenario -in @('installer-failure', 'health-timeout')) {
      $probeDeadline = [DateTime]::UtcNow.AddSeconds(5)
      do {
        $probeCalls = @(Get-Content (Join-Path $root 'calls.txt') -ErrorAction SilentlyContinue)
        if (@($probeCalls | Where-Object { $_ -eq 'unhealthy' }).Count -ge $(if ($scenario -eq 'health-timeout') { 2 } else { 1 })) { break }
        Start-Sleep -Milliseconds 50
      } while ([DateTime]::UtcNow -lt $probeDeadline)
    }
    $calls = @(); if (Test-Path (Join-Path $root 'calls.txt')) { $calls = @(Get-Content (Join-Path $root 'calls.txt')) }
    if ($scenario -eq 'healthy') {
      if ($exitCode -ne 0 -or $state.PSObject.Properties.Name -contains 'pending' -or ($calls -join ',') -ne 'next,healthy') { throw 'Healthy update failed' }
    } elseif ($scenario -in @('installer-failure', 'health-timeout')) {
      if ($exitCode -ne 1 -or $state.PSObject.Properties.Name -contains 'pending' -or $state.quarantined -notcontains '2.0.0') { throw "Recovery state failed: $scenario" }
      if (@($calls | Where-Object { $_ -eq 'old' }).Count -ne 1 -or [IO.File]::ReadAllText($database) -ne 'old-database') { throw "Recovery rollback failed: $scenario" }
    } else {
      if ($exitCode -eq 0 -or $calls.Count -ne 0 -or [IO.File]::ReadAllText($database) -ne 'new-database') { throw "Unsafe preflight: $scenario" }
    }
    Write-Host "PASS recovery $scenario"
  }
} finally {
  Remove-Item Env:ARTEMIS_RECOVERY_PROBE -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $root -Recurse -Force
}
# The rejected-update scenarios intentionally leave a nonzero native exit code.
# Only reach success after every scenario assertion and cleanup has completed.
exit 0

param(
  [Parameter(Mandatory = $true)][string]$ResourceDirectory,
  [Parameter(Mandatory = $true)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$nativePath = Join-Path $ResourceDirectory 'windows-sandbox-native.cs'
if (Test-Path $nativePath) {
  $nativeSource = [IO.File]::ReadAllText($nativePath)
} else {
  # Supports a pre-extraction checkout for before/after verification.
  $scriptSource = [IO.File]::ReadAllText((Join-Path $ResourceDirectory 'windows-sandbox.ps1'))
  $nativeSource = [regex]::Match($scriptSource, '(?s)\$nativeSource = @''\r?\n(.*?)\r?\n''@').Groups[1].Value
}
if (-not $nativeSource) { throw 'Native sandbox source is missing' }
Add-Type -TypeDefinition $nativeSource -Language CSharp
$probePath = Join-Path $OutputDirectory 'probe.exe'
Add-Type -TypeDefinition ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'access-probe.cs'))) -Language CSharp -OutputAssembly $probePath -OutputType ConsoleApplication
$results = @()
foreach ($policy in @('allow-child', 'deny-child')) {
  $root = Join-Path $OutputDirectory $policy
  $workspace = Join-Path $root 'workspace'
  $readOnly = Join-Path $root 'readonly'
  $private = Join-Path $root 'private'
  $runtime = Join-Path $root 'runtime'
  foreach ($directory in @($root, $workspace, $readOnly, $private, $runtime)) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
  [IO.File]::WriteAllText((Join-Path $readOnly 'readable.txt'), 'readable')
  [IO.File]::WriteAllText((Join-Path $private 'private.txt'), 'private')
  $executable = Join-Path $readOnly 'probe.exe'
  Copy-Item -LiteralPath $probePath -Destination $executable
  $before = (Get-Acl $workspace).Sddl
  $code = [ArtemisNativeSandbox]::LaunchClassic(
    ('artemis-verification-' + [Guid]::NewGuid().ToString('N')),
    $workspace, $workspace, $runtime, $executable,
    [string[]]@($workspace, $readOnly, $private, $policy),
    [string[]]@($workspace, $runtime), [string[]]@($readOnly), $false, ($policy -eq 'deny-child')
  )
  if ($code -ne 0) { throw "Sandbox probe failed ($policy): $code" }
  if ((Get-Acl $workspace).Sddl -ne $before) { throw 'Workspace ACL was not restored' }
  if ([IO.File]::ReadAllText((Join-Path $workspace 'allowed.txt')) -ne 'allowed') { throw 'Workspace output missing' }
  $pidFile = Join-Path $workspace 'descendant.pid'
  if (Test-Path $pidFile) {
    $descendantId = [int][IO.File]::ReadAllText($pidFile)
    if (Get-Process -Id $descendantId -ErrorAction SilentlyContinue) { throw 'Sandbox descendant survived job cleanup' }
  }
  [IO.File]::WriteAllText((Join-Path $runtime 'host-reclaim.txt'), 'host')
  $results += @{policy=$policy; exitCode=$code; aclRestored=$true; descendantCleanup=$true; hostRuntimeReclaim=$true}
}
$results | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputDirectory 'results.json') -Encoding UTF8
$results | ConvertTo-Json -Compress

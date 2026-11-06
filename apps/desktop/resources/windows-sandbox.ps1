param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Za-z0-9._-]+$')]
  [string]$Identity,

  [Parameter(Mandatory = $true)]
  [string]$WorkspacePath,

  [Parameter(Mandatory = $true)]
  [string]$WorkingDirectory,

  [Parameter(Mandatory = $true)]
  [string]$RuntimePath,

  [AllowEmptyString()]
  [string]$HostAccessPath = '',

  [AllowEmptyString()]
  [string]$HostTempPath = '',

  [switch]$DenyChildProcesses,

  [Parameter(Mandatory = $true)]
  [string]$Executable,

  [Parameter(Mandatory = $true)]
  [string]$ArgumentsBase64,

  [Parameter(Mandatory = $true)]
  [string]$WritablePathsBase64,

  [Parameter(Mandatory = $true)]
  [string]$ReadOnlyPathsBase64,

  [Parameter(Mandatory = $true)]
  [string]$SandboxSpecificationBase64,

  [Parameter(Mandatory = $true)]
  [ValidateSet('deny', 'allow')]
  [string]$NetworkPolicy
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-SandboxDiagnostic([string]$Stage) {
  if ($env:ARTEMIS_WINDOWS_SANDBOX_DIAGNOSTICS -eq '1') {
    [Console]::Error.WriteLine("Artemis Windows sandbox stage: $Stage")
  }
}

try {
  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
  $OutputEncoding = [Console]::OutputEncoding
}
catch {
  # Keep the inherited encoding on older hosts that reject console changes.
}

$workspace = [System.IO.Path]::GetFullPath($WorkspacePath)
$workingDirectory = [System.IO.Path]::GetFullPath($WorkingDirectory)
$runtime = [System.IO.Path]::GetFullPath($RuntimePath)
$hostAccess = if ([string]::IsNullOrWhiteSpace($HostAccessPath)) {
  ''
}
else {
  [System.IO.Path]::GetFullPath($HostAccessPath)
}
$hostTemp = if ([string]::IsNullOrWhiteSpace($HostTempPath)) {
  ''
}
else {
  [System.IO.Path]::GetFullPath($HostTempPath)
}
if (-not [System.IO.Directory]::Exists($workspace)) {
  throw "Workspace does not exist: $workspace"
}
if (-not [System.IO.Directory]::Exists($workingDirectory)) {
  throw "Working directory does not exist: $workingDirectory"
}
if (-not [System.IO.Directory]::Exists($runtime)) {
  throw "Runtime directory does not exist: $runtime"
}

function ConvertFrom-Base64Json([string]$Value) {
  $json = [System.Text.Encoding]::UTF8.GetString(
    [System.Convert]::FromBase64String($Value)
  )
  return $json | ConvertFrom-Json
}

function Test-PathWithinRoot([string]$Path, [string]$Root) {
  $resolvedRoot = [System.IO.Path]::GetFullPath($Root)
  $rootPrefix = $resolvedRoot.TrimEnd('\') + '\'
  return (
    $Path.Equals($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
    $Path.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)
  )
}

if ($hostAccess) {
  if (-not [System.IO.Directory]::Exists($hostAccess)) {
    throw "Host access directory does not exist: $hostAccess"
  }
  if (-not (Test-PathWithinRoot $hostAccess $runtime)) {
    throw 'Host access directory must remain inside the MCP runtime'
  }
}
if ($hostTemp) {
  if (-not [System.IO.Directory]::Exists($hostTemp)) {
    throw "Host temp directory does not exist: $hostTemp"
  }
  if (Test-PathWithinRoot $hostTemp $runtime) {
    throw 'Host temp directory must remain outside the MCP runtime'
  }
}

if (
  -not (Test-PathWithinRoot $workingDirectory $workspace) -and
  -not (Test-PathWithinRoot $workingDirectory $runtime)
) {
  throw 'Working directory must remain inside the workspace or MCP runtime'
}

$rawCommandArguments = ConvertFrom-Base64Json $ArgumentsBase64
$commandArgumentList = New-Object 'System.Collections.Generic.List[string]'
foreach ($argument in $rawCommandArguments) {
  $commandArgumentList.Add([string]$argument)
}
[string[]]$commandArguments = $commandArgumentList.ToArray()

$rawWritablePaths = ConvertFrom-Base64Json $WritablePathsBase64
$writablePathList = New-Object 'System.Collections.Generic.List[string]'
foreach ($pathValue in $rawWritablePaths) {
  if ($null -eq $pathValue -or [string]::IsNullOrWhiteSpace([string]$pathValue)) {
    continue
  }
  $path = [System.IO.Path]::GetFullPath([string]$pathValue)
  if (
    -not (Test-PathWithinRoot $path $workspace) -and
    -not (Test-PathWithinRoot $path $runtime)
  ) {
    throw "Writable path escapes the workspace and MCP runtime: $path"
  }
  $writablePathList.Add($path)
}
[string[]]$writablePaths = $writablePathList.ToArray()

$rawReadOnlyPaths = ConvertFrom-Base64Json $ReadOnlyPathsBase64
$readOnlyPathList = New-Object 'System.Collections.Generic.List[string]'
foreach ($pathValue in $rawReadOnlyPaths) {
  if ($null -eq $pathValue -or [string]::IsNullOrWhiteSpace([string]$pathValue)) {
    continue
  }
  $readOnlyPathList.Add([System.IO.Path]::GetFullPath([string]$pathValue))
}
[string[]]$readOnlyPaths = $readOnlyPathList.ToArray()

[byte[]]$sandboxSpecification = [System.Convert]::FromBase64String(
  $SandboxSpecificationBase64
)
if (
  $sandboxSpecification.Length -lt 8 -or
  [System.Text.Encoding]::ASCII.GetString($sandboxSpecification, 4, 4) -ne 'SBOX'
) {
  throw 'Windows sandbox specification is invalid'
}

function Get-AncestorDirectories([string]$Path) {
  $ancestors = New-Object 'System.Collections.Generic.List[string]'
  $current = [System.IO.Directory]::GetParent(
    [System.IO.Path]::GetFullPath($Path)
  )
  while ($null -ne $current) {
    $ancestors.Add($current.FullName)
    $current = $current.Parent
  }
  $values = $ancestors.ToArray()
  [array]::Reverse($values)
  return $values
}

function Test-AppContainerAncestorAccess(
  [string]$Path,
  [System.Security.Principal.SecurityIdentifier]$Sid
) {
  $requiredRights = (
    [System.Security.AccessControl.FileSystemRights]::Traverse -bor
    [System.Security.AccessControl.FileSystemRights]::ReadAttributes
  )
  $grantedRights = 0
  $directory = New-Object System.IO.DirectoryInfo($Path)
  $security = $directory.GetAccessControl(
    [System.Security.AccessControl.AccessControlSections]::Access
  )
  $rules = $security.GetAccessRules(
    $true,
    $true,
    [System.Security.Principal.SecurityIdentifier]
  )
  foreach ($rule in $rules) {
    if (
      $rule.IdentityReference -eq $Sid -and
      $rule.AccessControlType -eq
        [System.Security.AccessControl.AccessControlType]::Allow
    ) {
      $grantedRights = $grantedRights -bor $rule.FileSystemRights
    }
  }
  return ($grantedRights -band $requiredRights) -eq $requiredRights
}

$nativeSource = [System.IO.File]::ReadAllText(
  (Join-Path $PSScriptRoot 'windows-sandbox-native.cs')
)

$sandboxTempEnvironment = @{}
foreach ($name in @('TEMP', 'TMP', 'TMPDIR')) {
  $sandboxTempEnvironment[$name] = [System.Environment]::GetEnvironmentVariable(
    $name,
    [System.EnvironmentVariableTarget]::Process
  )
}
try {
  if ($hostTemp) {
    foreach ($name in @('TEMP', 'TMP', 'TMPDIR')) {
      [System.Environment]::SetEnvironmentVariable(
        $name,
        $hostTemp,
        [System.EnvironmentVariableTarget]::Process
      )
    }
  }
  Write-SandboxDiagnostic 'compiling native helper'
  Add-Type -TypeDefinition $nativeSource -Language CSharp
}
finally {
  foreach ($name in @('TEMP', 'TMP', 'TMPDIR')) {
    [System.Environment]::SetEnvironmentVariable(
      $name,
      $sandboxTempEnvironment[$name],
      [System.EnvironmentVariableTarget]::Process
    )
  }
}
Write-SandboxDiagnostic 'native helper compiled'
Write-SandboxDiagnostic "profile identity: $Identity"
$workspaceRoot = [System.IO.Path]::GetPathRoot($workspace)
$systemRoot = [System.IO.Path]::GetPathRoot(
  [System.Environment]::SystemDirectory
)
$needsClassicAncestorAccess = -not $workspaceRoot.Equals(
  $systemRoot,
  [System.StringComparison]::OrdinalIgnoreCase
)
function Initialize-ClassicAppContainerAncestors {
  if ($needsClassicAncestorAccess) {
    $traverseSid = [System.Security.Principal.SecurityIdentifier]::new(
      [ArtemisNativeSandbox]::CapabilitySid(
        'artemisWorkspaceTraverse'
      )
    )
    $accessPaths = @($workspace) + @($writablePaths) + @($readOnlyPaths)
    $ancestors = @(
      $accessPaths |
        ForEach-Object { Get-AncestorDirectories $_ } |
        Sort-Object -Unique
    )
    $missingTraverse = @(
      $ancestors | Where-Object {
        -not (Test-AppContainerAncestorAccess $_ $traverseSid)
      }
    )
    if ($missingTraverse.Count -gt 0) {
      $setupPath = Join-Path $PSScriptRoot 'windows-sandbox-setup.ps1'
      if (-not [System.IO.File]::Exists($setupPath)) {
        throw "Windows sandbox setup helper does not exist: $setupPath"
      }
      $pathsBase64 = [System.Convert]::ToBase64String(
        [System.Text.Encoding]::UTF8.GetBytes(
          ($missingTraverse | ConvertTo-Json -Compress)
        )
      )
      $escapedSetupPath = $setupPath.Replace("'", "''")
      $setupCommand = "& '$escapedSetupPath' -PathsBase64 '$pathsBase64'"
      $encodedSetupCommand = [System.Convert]::ToBase64String(
        [System.Text.Encoding]::Unicode.GetBytes($setupCommand)
      )
      $setupProcess = Start-Process `
        -FilePath 'powershell.exe' `
        -ArgumentList @(
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-EncodedCommand',
          $encodedSetupCommand
        ) `
        -Verb RunAs `
        -WindowStyle Hidden `
        -Wait `
        -PassThru
      if ($setupProcess.ExitCode -ne 0) {
        throw "Windows sandbox setup failed with exit code $($setupProcess.ExitCode)"
      }
      foreach ($ancestor in $ancestors) {
        if (-not (Test-AppContainerAncestorAccess $ancestor $traverseSid)) {
          throw "Windows sandbox setup did not grant ancestor access: $ancestor"
        }
      }
    }
  }
}

# Windows 11 25H2 can create an experimental AppContainer without applying
# its filesystem grants. Keep filesystem policy enforced by classic ACLs.
$versionInfo = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
$windowsBuild = [int]$versionInfo.CurrentBuildNumber
$useClassicAppContainer = ($windowsBuild -ge 26200) -and ($windowsBuild -lt 26600)
if (-not $useClassicAppContainer) {
  try {
    Write-SandboxDiagnostic 'launching experimental AppContainer'
    $exitCode = [ArtemisNativeSandbox]::Launch(
      $Identity,
      $workingDirectory,
      $hostAccess,
      $Executable,
      $commandArguments,
      $sandboxSpecification,
      [bool]$DenyChildProcesses
    )
  }
  catch {
    $experimentalFailure = $_.Exception.ToString()
    $experimentalSandboxUnavailable =
      ($experimentalFailure -match 'LoadLibraryEx\(processmodel\.dll\) failed: (?:120|126)') -or
      ($experimentalFailure -match 'Experimental_CreateProcessInSandbox failed: 120') -or
      ($experimentalFailure -match 'Windows CreateProcessInSandbox is unavailable')
    if (-not $experimentalSandboxUnavailable) {
      throw
    }
    $useClassicAppContainer = $true
  }
}
if ($useClassicAppContainer) {
  # Services cannot display UAC. The classic launcher grants access only to
  # the requested paths and fails closed if their existing ancestors block it.
  if ([System.Diagnostics.Process]::GetCurrentProcess().SessionId -ne 0) {
    Initialize-ClassicAppContainerAncestors
  }
  Write-SandboxDiagnostic 'falling back to classic AppContainer'
  $exitCode = [ArtemisNativeSandbox]::LaunchClassic(
    $Identity,
    $workspace,
    $workingDirectory,
    $hostAccess,
    $Executable,
    $commandArguments,
    $writablePaths,
    $readOnlyPaths,
    ($NetworkPolicy -eq 'allow'),
    [bool]$DenyChildProcesses
  )
}
Write-SandboxDiagnostic "sandbox child exited: $exitCode"
exit $exitCode

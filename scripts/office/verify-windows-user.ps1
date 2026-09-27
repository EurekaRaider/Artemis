# Ephemeral CI account only. This probes an unsigned engineering runtime, not release acceptance.
param(
  [Parameter(Mandatory = $true)][string]$Office,
  [Parameter(Mandatory = $true)][string]$Bridge,
  [string]$Corpus = 'artifacts/office/corpus',
  [string]$Out = 'artifacts/office/ordinary-user'
)
$ErrorActionPreference = 'Stop'
if (-not $env:GITHUB_ACTIONS -or $env:RUNNER_OS -ne 'Windows' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
  throw 'This account fixture is restricted to an ephemeral Windows Actions runner.'
}
$probeUserName = 'art-office-' + [guid]::NewGuid().ToString('N').Substring(0, 6)
$probeStage = Join-Path $env:ProgramData ('Artemis Office 验收-' + [guid]::NewGuid().ToString('N'))
$probeUser = $null
$probeProcess = $null
New-Item $Out -ItemType Directory -Force | Out-Null
$probeEvidence = (Resolve-Path $Out).Path
try {
  $probePassword = ConvertTo-SecureString ([guid]::NewGuid().ToString('N') + 'aA1!') -AsPlainText -Force
  $probeUser = New-LocalUser -Name $probeUserName -Password $probePassword -AccountNeverExpires -PasswordNeverExpires
  Add-LocalGroupMember -Group (Get-LocalGroup -SID 'S-1-5-32-545').Name -Member $probeUser
  New-Item $probeStage -ItemType Directory | Out-Null
  $probeAcl = Get-Acl $probeStage
  $probeAcl.SetAccessRuleProtection($true, $false)
  foreach ($sid in @($probeUser.SID, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'), [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))) {
    $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $probeAcl.AddAccessRule($rule)
  }
  Set-Acl $probeStage $probeAcl
  Copy-Item (Split-Path (Split-Path (Resolve-Path $Office).Path)) (Join-Path $probeStage 'runtime') -Recurse
  Copy-Item $Bridge (Join-Path $probeStage 'office-bridge.exe')
  Copy-Item $Corpus (Join-Path $probeStage 'corpus') -Recurse
  Copy-Item (Get-Command node.exe).Source (Join-Path $probeStage 'node.exe')
  Copy-Item (Join-Path $PSScriptRoot 'probe-native.mjs') $probeStage
  Copy-Item (Join-Path $PSScriptRoot 'corpus.json') $probeStage
  New-Item (Join-Path $probeStage 'evidence') -ItemType Directory | Out-Null
  $probeWorker = Join-Path $probeStage 'worker.ps1'
  @'
param([string]$Commit)
$ErrorActionPreference = 'Stop'
$env:GITHUB_SHA = $Commit
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Expected an ordinary user token' }
$localData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData, [Environment+SpecialFolderOption]::Create)
if (-not $localData) { throw 'The ordinary user has no local application data directory' }
$payload = Join-Path $localData 'Artemis\capability-packs\office-core\1.0.0\payload'
New-Item $payload -ItemType Directory -Force | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'runtime') (Join-Path $payload 'runtime') -Recurse
Copy-Item (Join-Path $PSScriptRoot 'office-bridge.exe') $payload
$workspace = Join-Path $localData 'Artemis\验证文档'
Copy-Item (Join-Path $PSScriptRoot 'corpus') $workspace -Recurse
$output = Join-Path $PSScriptRoot 'evidence'
$office = Join-Path $payload 'runtime\program\soffice.exe'
$bridge = Join-Path $payload 'office-bridge.exe'
$proof = [ordered]@{
  schemaVersion=1; administrator=$false; userSid=$identity.User.Value
  payload=$payload; workspace=$workspace; localApplicationData=$localData; userProfile=$env:USERPROFILE
  finalCapabilityPackage=$false; releaseAccepted=$false
  acl=@((Get-Acl $payload).Sddl, (Get-Acl $office).Sddl, (Get-Acl $bridge).Sddl)
}
$proof | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $output 'identity.json') -Encoding utf8
& (Join-Path $PSScriptRoot 'node.exe') (Join-Path $PSScriptRoot 'probe-native.mjs') --office $office --bridge $bridge --corpus $workspace --out (Join-Path $output 'native')
$code = $LASTEXITCODE
$proof.nativeProbeExitCode = $code
$proof | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $output 'identity.json') -Encoding utf8
exit $code
'@ | Set-Content $probeWorker -Encoding utf8BOM
  $credential = [PSCredential]::new("$env:COMPUTERNAME\$probeUserName", $probePassword)
  # Let CreateProcessWithLogonW create the new user's environment instead of
  # forwarding runneradmin's USERPROFILE, APPDATA and temporary directories.
  $probeProcess = Start-Process -FilePath (Get-Command powershell.exe).Source -Credential $credential -LoadUserProfile -UseNewEnvironment -WorkingDirectory $probeStage -ArgumentList @('-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', "`"$probeWorker`"", '-Commit', $env:GITHUB_SHA) -RedirectStandardOutput (Join-Path $probeStage 'stdout.log') -RedirectStandardError (Join-Path $probeStage 'stderr.log') -PassThru
  if (-not $probeProcess.WaitForExit(300000)) { throw 'Ordinary-user native probe timed out' }
  $probeProcess.Refresh()
  if ($probeProcess.ExitCode -ne 0) { throw "Ordinary-user probe exited $($probeProcess.ExitCode); see its preserved evidence" }
} finally {
  if (Test-Path (Join-Path $probeStage 'evidence')) {
    Get-ChildItem (Join-Path $probeStage 'evidence') | Copy-Item -Destination $probeEvidence -Recurse
  }
  foreach ($name in @('stdout.log', 'stderr.log')) {
    $log = Join-Path $probeStage $name
    if (Test-Path $log) { Copy-Item $log $probeEvidence; Get-Content $log }
  }
  if ($probeUser) {
    # Kill only processes owned by the unique account created by this fixture.
    foreach ($process in Get-CimInstance Win32_Process) {
      try {
        $owner = Invoke-CimMethod $process -MethodName GetOwner -ErrorAction Stop
        if ($owner.User -eq $probeUserName) { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue }
      } catch { }
    }
    Remove-LocalUser -Name $probeUserName
  }
  if ($probeProcess) { $probeProcess.Dispose() }
  if (Test-Path $probeStage) { Remove-Item $probeStage -Recurse -Force }
}

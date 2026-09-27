# Inspect the final user installation, including every inherited allow rule.
param([Parameter(Mandatory = $true)][string]$Root)
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$trusted = @($identity.User.Value, 'S-1-5-18', 'S-1-5-32-544')
$writeMask = 2 -bor 4 -bor 16 -bor 64 -bor 256 -bor 65536 -bor 262144 -bor 524288
$patterns = @{}
$count = 0
foreach ($item in @((Get-Item -LiteralPath $Root)) + @(Get-ChildItem -LiteralPath $Root -Force -Recurse)) {
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Installed runtime contains a reparse point' }
  $acl = Get-Acl -LiteralPath $item.FullName
  foreach ($rule in $acl.Access) {
    if ($rule.AccessControlType -ne 'Allow' -or ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly)) { continue }
    $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    if (($rule.FileSystemRights -band $writeMask) -and $sid -notin $trusted) { throw "Unexpected writer $sid on $($item.FullName)" }
  }
  if (-not $patterns.ContainsKey($acl.Sddl)) { $patterns[$acl.Sddl] = @{sddl=$acl.Sddl; owner=$acl.Owner; example=$item.FullName; count=0} }
  $patterns[$acl.Sddl].count++
  $count++
}
@{
  administrator=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  userSid=$identity.User.Value
  windows=(Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,ProductType)
  inspectedPaths=$count; unexpectedWriters=0; aclPatterns=@($patterns.Values)
} | ConvertTo-Json -Depth 6 -Compress

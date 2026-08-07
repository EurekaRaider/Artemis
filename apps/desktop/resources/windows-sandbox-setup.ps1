param(
  [Parameter(Mandatory = $true)]
  [string]$PathsBase64
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$json = [System.Text.Encoding]::UTF8.GetString(
  [System.Convert]::FromBase64String($PathsBase64)
)
$decodedPaths = $json | ConvertFrom-Json
$paths = New-Object 'System.Collections.Generic.List[string]'
foreach ($decodedPath in $decodedPaths) {
  $paths.Add([string]$decodedPath)
}
if ($paths.Count -eq 0) {
  throw 'At least one sandbox ancestor path is required'
}

$capabilitySource = @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;

public static class ArtemisSandboxCapability
{
    [DllImport("kernelbase.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool DeriveCapabilitySidsFromName(
        string capabilityName,
        out IntPtr capabilityGroupSids,
        out uint capabilityGroupSidCount,
        out IntPtr capabilitySids,
        out uint capabilitySidCount);

    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr memory);

    public static string Sid(string capabilityName)
    {
        IntPtr groupSids = IntPtr.Zero;
        IntPtr capabilitySids = IntPtr.Zero;
        uint groupCount = 0;
        uint capabilityCount = 0;
        try
        {
            if (!DeriveCapabilitySidsFromName(
                capabilityName,
                out groupSids,
                out groupCount,
                out capabilitySids,
                out capabilityCount))
            {
                var error = Marshal.GetLastWin32Error();
                throw new InvalidOperationException(
                    "DeriveCapabilitySidsFromName failed: " + error +
                    " (" + new Win32Exception(error).Message + ")");
            }
            if (capabilityCount != 1)
                throw new InvalidOperationException(
                    "Expected one application capability SID.");
            return new SecurityIdentifier(
                Marshal.ReadIntPtr(capabilitySids)).Value;
        }
        finally
        {
            for (var index = 0; index < groupCount; index++)
                LocalFree(Marshal.ReadIntPtr(
                    groupSids,
                    index * IntPtr.Size));
            if (groupSids != IntPtr.Zero)
                LocalFree(groupSids);
            for (var index = 0; index < capabilityCount; index++)
                LocalFree(Marshal.ReadIntPtr(
                    capabilitySids,
                    index * IntPtr.Size));
            if (capabilitySids != IntPtr.Zero)
                LocalFree(capabilitySids);
        }
    }
}
'@

Add-Type -TypeDefinition $capabilitySource -Language CSharp
$traverseCapability = [System.Security.Principal.SecurityIdentifier]::new(
  [ArtemisSandboxCapability]::Sid(
    'artemisWorkspaceTraverse'
  )
)
foreach ($pathValue in $paths) {
  if (
    $null -eq $pathValue -or
    [string]::IsNullOrWhiteSpace([string]$pathValue)
  ) {
    throw 'Sandbox ancestor paths cannot be empty'
  }
  $path = [System.IO.Path]::GetFullPath([string]$pathValue)
  if (-not [System.IO.Directory]::Exists($path)) {
    throw "Sandbox ancestor path does not exist: $path"
  }

  $directory = New-Object System.IO.DirectoryInfo($path)
  $security = $directory.GetAccessControl(
    [System.Security.AccessControl.AccessControlSections]::Access
  )
  $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
    $traverseCapability,
    (
      [System.Security.AccessControl.FileSystemRights]::Traverse -bor
      [System.Security.AccessControl.FileSystemRights]::ReadAttributes
    ),
    [System.Security.AccessControl.InheritanceFlags]::None,
    [System.Security.AccessControl.PropagationFlags]::None,
    [System.Security.AccessControl.AccessControlType]::Allow
  )
  $security.AddAccessRule($rule)
  $directory.SetAccessControl($security)
}

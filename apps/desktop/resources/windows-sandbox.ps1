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

$nativeSource = @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;

public static class ArtemisNativeSandbox
{
    private const uint CREATE_SUSPENDED = 0x00000004;
    private const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    private const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
    private const uint STARTF_USESTDHANDLES = 0x00000100;
    private const uint ERROR_ALREADY_EXISTS = 183;
    private const uint LOAD_LIBRARY_SEARCH_SYSTEM32 = 0x00000800;
    private const uint INFINITE = 0xFFFFFFFF;
    private const int JobObjectBasicAccountingInformation = 1;
    private const int JobObjectExtendedLimitInformation = 9;
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    private const uint JOB_TEARDOWN_TIMEOUT_MS = 10000;
    private const uint DUPLICATE_SAME_ACCESS = 0x00000002;
    private const uint DACL_SECURITY_INFORMATION = 0x00000004;
    private const int ERROR_INSUFFICIENT_BUFFER = 122;
    // The sandbox receives only service station read and private desktop use.
    // Its ACEs exclude clipboard, screen, hooks, and desktop switching.
    private const int WINSTA_SANDBOX_ACCESS = 0x20123;
    private const uint DESKTOP_PRIVATE_ACCESS = 0x000F01FF;
    private const int DESKTOP_SANDBOX_ACCESS = 0x200C3;
    private const int STD_INPUT_HANDLE = -10;
    private const int STD_OUTPUT_HANDLE = -11;
    private const int STD_ERROR_HANDLE = -12;
    private static readonly IntPtr PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES =
        new IntPtr(0x00020009);
    private static readonly IntPtr PROC_THREAD_ATTRIBUTE_HANDLE_LIST =
        new IntPtr(0x00020002);

    [StructLayout(LayoutKind.Sequential)]
    private struct SECURITY_CAPABILITIES
    {
        public IntPtr AppContainerSid;
        public IntPtr Capabilities;
        public uint CapabilityCount;
        public uint Reserved;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SID_AND_ATTRIBUTES
    {
        public IntPtr Sid;
        public uint Attributes;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SECURITY_ATTRIBUTES
    {
        public uint nLength;
        public IntPtr lpSecurityDescriptor;
        [MarshalAs(UnmanagedType.Bool)]
        public bool bInheritHandle;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public uint dwProcessId;
        public uint dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct STARTUPINFOEX
    {
        public STARTUPINFO StartupInfo;
        public IntPtr AttributeList;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public IntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_ACCOUNTING_INFORMATION
    {
        public long TotalUserTime;
        public long TotalKernelTime;
        public long ThisPeriodTotalUserTime;
        public long ThisPeriodTotalKernelTime;
        public uint TotalPageFaultCount;
        public uint TotalProcesses;
        public uint ActiveProcesses;
        public uint TotalTerminatedProcesses;
    }

    [UnmanagedFunctionPointer(CallingConvention.Winapi, CharSet = CharSet.Unicode)]
    private delegate bool CreateProcessInSandboxDelegate(
        string applicationName,
        StringBuilder commandLine,
        IntPtr processAttributes,
        IntPtr threadAttributes,
        bool inheritHandles,
        uint creationFlags,
        IntPtr environment,
        string currentDirectory,
        ref STARTUPINFO startupInfo,
        string identity,
        IntPtr sandboxSpecification,
        uint sandboxSpecificationSize,
        out PROCESS_INFORMATION processInformation);

    [DllImport("userenv.dll", CharSet = CharSet.Unicode)]
    private static extern int CreateAppContainerProfile(
        string name,
        string displayName,
        string description,
        IntPtr capabilities,
        uint capabilityCount,
        out IntPtr appContainerSid);

    [DllImport("userenv.dll", CharSet = CharSet.Unicode)]
    private static extern int DeriveAppContainerSidFromAppContainerName(
        string name,
        out IntPtr appContainerSid);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr LoadLibraryEx(
        string fileName,
        IntPtr file,
        uint flags);

    [DllImport("kernel32.dll", CharSet = CharSet.Ansi, SetLastError = true)]
    private static extern IntPtr GetProcAddress(
        IntPtr module,
        string procedureName);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool FreeLibrary(IntPtr module);

    [DllImport("userenv.dll", CharSet = CharSet.Unicode)]
    private static extern int DeleteAppContainerProfile(string name);

    [DllImport("kernelbase.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool DeriveCapabilitySidsFromName(
        string capabilityName,
        out IntPtr capabilityGroupSids,
        out uint capabilityGroupSidCount,
        out IntPtr capabilitySids,
        out uint capabilitySidCount);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool InitializeProcThreadAttributeList(
        IntPtr attributeList,
        int attributeCount,
        int flags,
        ref IntPtr size);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool UpdateProcThreadAttribute(
        IntPtr attributeList,
        uint flags,
        IntPtr attribute,
        IntPtr value,
        IntPtr size,
        IntPtr previousValue,
        IntPtr returnSize);

    [DllImport("kernel32.dll")]
    private static extern void DeleteProcThreadAttributeList(
        IntPtr attributeList);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcess(
        string applicationName,
        StringBuilder commandLine,
        IntPtr processAttributes,
        IntPtr threadAttributes,
        bool inheritHandles,
        uint creationFlags,
        IntPtr environment,
        string currentDirectory,
        ref STARTUPINFOEX startupInfo,
        out PROCESS_INFORMATION processInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateJobObject(
        IntPtr jobAttributes,
        string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(
        IntPtr job,
        int informationClass,
        IntPtr information,
        uint informationLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool QueryInformationJobObject(
        IntPtr job,
        int informationClass,
        out JOBOBJECT_BASIC_ACCOUNTING_INFORMATION information,
        uint informationLength,
        IntPtr returnLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateJobObject(
        IntPtr job,
        uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(
        IntPtr job,
        IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint ResumeThread(IntPtr thread);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(
        IntPtr handle,
        uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(
        IntPtr process,
        out uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetStdHandle(int standardHandle);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool DuplicateHandle(
        IntPtr sourceProcess,
        IntPtr sourceHandle,
        IntPtr targetProcess,
        out IntPtr targetHandle,
        uint desiredAccess,
        bool inheritHandle,
        uint options);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr GetProcessWindowStation();

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateDesktop(
        string name, string device, IntPtr devmode, uint flags,
        uint access, ref SECURITY_ATTRIBUTES attributes);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool CloseDesktop(IntPtr desktop);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool GetUserObjectInformation(
        IntPtr handle,
        int index,
        StringBuilder value,
        uint length,
        out uint needed);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool GetUserObjectSecurity(
        IntPtr handle,
        ref uint information,
        byte[] descriptor,
        uint length,
        out uint needed);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetUserObjectSecurity(
        IntPtr handle,
        ref uint information,
        byte[] descriptor);

    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr memory);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool FreeSid(IntPtr sid);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(
        IntPtr process, uint desiredAccess, out IntPtr token);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetTokenInformation(
        IntPtr token, int informationClass, IntPtr information,
        uint length, out uint needed);

    private static void ThrowLastError(string operation)
    {
        var error = Marshal.GetLastWin32Error();
        throw new InvalidOperationException(
            operation + " failed: " + error + " (" +
            new Win32Exception(error).Message + ")");
    }

    private static string UserObjectName(IntPtr handle)
    {
        var name = new StringBuilder(256);
        uint needed;
        if (!GetUserObjectInformation(
            handle, 2, name, (uint)(name.Capacity * 2), out needed))
            ThrowLastError("GetUserObjectInformation(name)");
        return name.ToString();
    }

    private static IntPtr CreatePrivateSandboxDesktop(
        string name, SecurityIdentifier sid)
    {
        var owner = WindowsIdentity.GetCurrent().User;
        if (owner == null)
            throw new InvalidOperationException(
                "The service user SID is unavailable.");
        var descriptor = new RawSecurityDescriptor(
            "O:" + owner.Value + "G:" + owner.Value +
            "D:(A;;0x" +
                DESKTOP_PRIVATE_ACCESS.ToString("X") +
                ";;;" + owner.Value + ")" +
            "(A;;0x" +
                DESKTOP_SANDBOX_ACCESS.ToString("X") +
                ";;;" + sid.Value + ")" +
            "S:(ML;;NW;;;LW)");
        var bytes = new byte[descriptor.BinaryLength];
        descriptor.GetBinaryForm(bytes, 0);
        var buffer = Marshal.AllocHGlobal(bytes.Length);
        try
        {
            Marshal.Copy(bytes, 0, buffer, bytes.Length);
            var attributes = new SECURITY_ATTRIBUTES
            {
                nLength = (uint)Marshal.SizeOf(
                    typeof(SECURITY_ATTRIBUTES)),
                lpSecurityDescriptor = buffer,
                bInheritHandle = false
            };
            var desktop = CreateDesktop(
                name, null, IntPtr.Zero, 0,
                DESKTOP_PRIVATE_ACCESS, ref attributes);
            if (desktop == IntPtr.Zero)
                ThrowLastError("CreateDesktop(private sandbox)");
            return desktop;
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    private static void DiagnoseSandboxToken(
        IntPtr process, IntPtr expectedSid, string desktopName)
    {
        if (Environment.GetEnvironmentVariable(
            "ARTEMIS_WINDOWS_SANDBOX_DIAGNOSTICS") != "1")
            return;
        IntPtr token = IntPtr.Zero;
        IntPtr information = IntPtr.Zero;
        try
        {
            if (!OpenProcessToken(process, 0x0008, out token))
                ThrowLastError("OpenProcessToken");
            uint needed;
            GetTokenInformation(token, 31, IntPtr.Zero, 0,
                out needed);
            if (needed < IntPtr.Size)
                ThrowLastError("GetTokenInformation(size)");
            information = Marshal.AllocHGlobal((int)needed);
            if (!GetTokenInformation(token, 31, information,
                needed, out needed))
                ThrowLastError("GetTokenInformation");
            var actualSid = Marshal.ReadIntPtr(information);
            Console.Error.WriteLine(
                "Artemis Windows sandbox stage: service desktop=" +
                desktopName + ", child AppContainer SID matches=" +
                (actualSid != IntPtr.Zero &&
                 new SecurityIdentifier(actualSid).Equals(
                     new SecurityIdentifier(expectedSid))));
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(
                "Artemis Windows sandbox stage: token diagnostic=" +
                error.Message);
        }
        finally
        {
            if (information != IntPtr.Zero)
                Marshal.FreeHGlobal(information);
            if (token != IntPtr.Zero)
                CloseHandle(token);
        }
    }

    private static void UpdateSessionObjectAccess(
        IntPtr handle,
        SecurityIdentifier sid,
        int rights,
        bool grant)
    {
        using (var mutex = new Mutex(
            false,
            @"Local\ArtemisSandboxSessionAcl"))
        {
            try { mutex.WaitOne(); }
            catch (AbandonedMutexException) { }
            try
            {
                var information = DACL_SECURITY_INFORMATION;
                uint needed;
                GetUserObjectSecurity(
                    handle, ref information, null, 0, out needed);
                if (needed == 0 ||
                    Marshal.GetLastWin32Error() !=
                        ERROR_INSUFFICIENT_BUFFER)
                    ThrowLastError("GetUserObjectSecurity(size)");
                var bytes = new byte[needed];
                if (!GetUserObjectSecurity(
                    handle, ref information, bytes,
                    (uint)bytes.Length, out needed))
                    ThrowLastError("GetUserObjectSecurity");
                var descriptor = new RawSecurityDescriptor(bytes, 0);
                var acl = descriptor.DiscretionaryAcl;
                if (acl == null)
                    throw new InvalidOperationException(
                        "Session desktop has no access control list.");
                if (grant)
                {
                    acl.InsertAce(acl.Count, new CommonAce(
                        AceFlags.None,
                        AceQualifier.AccessAllowed,
                        rights,
                        sid,
                        false,
                        null));
                }
                else
                {
                    for (var index = acl.Count - 1; index >= 0;
                        index--)
                    {
                        var ace = acl[index] as CommonAce;
                        if (ace != null &&
                            ace.AceQualifier ==
                                AceQualifier.AccessAllowed &&
                            ace.AccessMask == rights &&
                            ace.SecurityIdentifier.Equals(sid))
                            acl.RemoveAce(index);
                    }
                }
                descriptor.DiscretionaryAcl = acl;
                var updated = new byte[descriptor.BinaryLength];
                descriptor.GetBinaryForm(updated, 0);
                if (!SetUserObjectSecurity(
                    handle, ref information, updated))
                    ThrowLastError("SetUserObjectSecurity");
            }
            finally { mutex.ReleaseMutex(); }
        }
    }

    private sealed class SessionDesktopAccess : IDisposable
    {
        private readonly IntPtr station;
        private readonly IntPtr desktop;
        private readonly SecurityIdentifier sid;
        public readonly string Name;
        private bool stationGranted;

        public SessionDesktopAccess(SecurityIdentifier sid)
        {
            this.sid = sid;
            station = GetProcessWindowStation();
            if (station == IntPtr.Zero)
                ThrowLastError("GetProcessWindowStation");
            var desktopName = "ArtemisSandbox-" +
                Guid.NewGuid().ToString("N");
            Name = UserObjectName(station) + "\\" + desktopName;
            UpdateSessionObjectAccess(
                station, sid, WINSTA_SANDBOX_ACCESS, true);
            stationGranted = true;
            try
            {
                desktop = CreatePrivateSandboxDesktop(
                    desktopName, sid);
            }
            catch
            {
                UpdateSessionObjectAccess(
                    station, sid, WINSTA_SANDBOX_ACCESS, false);
                throw;
            }
        }

        public void Dispose()
        {
            try
            {
                if (desktop != IntPtr.Zero)
                    CloseDesktop(desktop);
            }
            finally
            {
                if (stationGranted)
                    UpdateSessionObjectAccess(
                        station, sid, WINSTA_SANDBOX_ACCESS, false);
            }
        }
    }

    private static SessionDesktopAccess GrantServiceDesktop(
        SecurityIdentifier sid)
    {
        // Service session 0 does not give AppContainer processes the desktop
        // access that interactive sessions normally provide.
        return Process.GetCurrentProcess().SessionId == 0
            ? new SessionDesktopAccess(sid)
            : null;
    }

    private static void TerminateAndDrainJob(IntPtr job)
    {
        var informationSize = (uint)Marshal.SizeOf(
            typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION));
        JOBOBJECT_BASIC_ACCOUNTING_INFORMATION information;
        if (!QueryInformationJobObject(
            job,
            JobObjectBasicAccountingInformation,
            out information,
            informationSize,
            IntPtr.Zero))
            ThrowLastError("QueryInformationJobObject");
        if (information.ActiveProcesses == 0)
            return;
        if (!TerminateJobObject(job, 1))
            ThrowLastError("TerminateJobObject");
        var deadline = DateTime.UtcNow.AddMilliseconds(
            JOB_TEARDOWN_TIMEOUT_MS);
        while (true)
        {
            if (!QueryInformationJobObject(
                job,
                JobObjectBasicAccountingInformation,
                out information,
                informationSize,
                IntPtr.Zero))
                ThrowLastError("QueryInformationJobObject");
            if (information.ActiveProcesses == 0)
                return;
            if (DateTime.UtcNow >= deadline)
                throw new InvalidOperationException(
                    "Windows sandbox job still has " +
                    information.ActiveProcesses +
                    " active process(es) after termination");
            Thread.Sleep(50);
        }
    }

    private static IntPtr DuplicateStandardHandle(int standardHandle)
    {
        var source = GetStdHandle(standardHandle);
        if (source == IntPtr.Zero || source == new IntPtr(-1))
            ThrowLastError("GetStdHandle");
        var process = GetCurrentProcess();
        IntPtr duplicate;
        if (!DuplicateHandle(
            process,
            source,
            process,
            out duplicate,
            0,
            true,
            DUPLICATE_SAME_ACCESS))
            ThrowLastError("DuplicateHandle");
        return duplicate;
    }

    private static IntPtr DeriveCapabilitySid(string name)
    {
        IntPtr groupSids = IntPtr.Zero;
        IntPtr capabilitySids = IntPtr.Zero;
        uint groupCount = 0;
        uint capabilityCount = 0;
        if (!DeriveCapabilitySidsFromName(
            name,
            out groupSids,
            out groupCount,
            out capabilitySids,
            out capabilityCount))
            ThrowLastError("DeriveCapabilitySidsFromName");
        try
        {
            if (capabilityCount != 1)
                throw new InvalidOperationException(
                    "Expected one application capability SID.");
            var capabilitySid = Marshal.ReadIntPtr(capabilitySids);
            capabilityCount = 0;
            return capabilitySid;
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

    public static string CapabilitySid(string name)
    {
        var sid = DeriveCapabilitySid(name);
        try
        {
            return new SecurityIdentifier(sid).Value;
        }
        finally
        {
            LocalFree(sid);
        }
    }

    private static string Quote(string value)
    {
        if (value.Length > 0 &&
            value.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0)
            return value;

        var result = new StringBuilder("\"");
        var slashes = 0;
        foreach (var character in value)
        {
            if (character == '\\')
            {
                slashes++;
                continue;
            }
            if (character == '"')
            {
                result.Append('\\', slashes * 2 + 1);
                result.Append('"');
                slashes = 0;
                continue;
            }
            result.Append('\\', slashes);
            result.Append(character);
            slashes = 0;
        }
        result.Append('\\', slashes * 2);
        result.Append('"');
        return result.ToString();
    }

    private static FileSystemAccessRule Grant(
        string path,
        SecurityIdentifier sid,
        FileSystemRights rights)
    {
        var isDirectory = Directory.Exists(path);
        var rule = new FileSystemAccessRule(
            sid,
            rights,
            isDirectory ? InheritanceFlags.ContainerInherit |
                InheritanceFlags.ObjectInherit : InheritanceFlags.None,
            PropagationFlags.None,
            AccessControlType.Allow);
        FileSystemSecurity security = isDirectory
            ? (FileSystemSecurity)new DirectoryInfo(path).GetAccessControl(AccessControlSections.Access)
            : new FileInfo(path).GetAccessControl(AccessControlSections.Access);
        security.AddAccessRule(rule);
        if (isDirectory) new DirectoryInfo(path).SetAccessControl((DirectorySecurity)security);
        else new FileInfo(path).SetAccessControl((FileSecurity)security);
        return rule;
    }

    private static void PreserveHostAccess(string path)
    {
        if (String.IsNullOrEmpty(path))
            return;
        var userSid = WindowsIdentity.GetCurrent().User;
        if (userSid == null)
            throw new InvalidOperationException(
                "The desktop user SID is unavailable.");
        var rule = new FileSystemAccessRule(
            userSid,
            FileSystemRights.FullControl,
            InheritanceFlags.ContainerInherit |
                InheritanceFlags.ObjectInherit,
            PropagationFlags.None,
            AccessControlType.Allow);
        var directory = new DirectoryInfo(path);
        var security = directory.GetAccessControl(
            AccessControlSections.Access);
        // AppContainer rule removal propagates to descendants. Convert this
        // private root's inherited host rules to explicit rules first so they
        // remain when that sandbox-only rule is revoked.
        security.SetAccessRuleProtection(true, true);
        security.AddAccessRule(rule);
        directory.SetAccessControl(security);
    }

    private static void Revoke(
        string path,
        FileSystemAccessRule rule)
    {
        var isDirectory = Directory.Exists(path);
        FileSystemSecurity security = isDirectory
            ? (FileSystemSecurity)new DirectoryInfo(path).GetAccessControl(AccessControlSections.Access)
            : new FileInfo(path).GetAccessControl(AccessControlSections.Access);
        security.RemoveAccessRuleSpecific(rule);
        if (isDirectory) new DirectoryInfo(path).SetAccessControl((DirectorySecurity)security);
        else new FileInfo(path).SetAccessControl((FileSecurity)security);
    }

    public static int Launch(
        string identity,
        string workingDirectory,
        string hostAccessPath,
        string executable,
        string[] arguments,
        byte[] sandboxSpecification)
    {
        IntPtr module = IntPtr.Zero;
        IntPtr specification = IntPtr.Zero;
        IntPtr job = IntPtr.Zero;
        IntPtr sessionSid = IntPtr.Zero;
        SessionDesktopAccess sessionDesktop = null;
        var process = new PROCESS_INFORMATION();

        try
        {
            module = LoadLibraryEx(
                "processmodel.dll",
                IntPtr.Zero,
                LOAD_LIBRARY_SEARCH_SYSTEM32);
            if (module == IntPtr.Zero)
                ThrowLastError("LoadLibraryEx(processmodel.dll)");

            var procedure = GetProcAddress(
                module,
                "Experimental_CreateProcessInSandbox");
            if (procedure == IntPtr.Zero)
                throw new PlatformNotSupportedException(
                    "Windows CreateProcessInSandbox is unavailable.");
            var createProcess = (CreateProcessInSandboxDelegate)
                Marshal.GetDelegateForFunctionPointer(
                    procedure,
                    typeof(CreateProcessInSandboxDelegate));

            specification = Marshal.AllocHGlobal(sandboxSpecification.Length);
            Marshal.Copy(
                sandboxSpecification,
                0,
                specification,
                sandboxSpecification.Length);

            var startup = new STARTUPINFO();
            startup.cb = Marshal.SizeOf(typeof(STARTUPINFO));
            startup.dwFlags = (int)STARTF_USESTDHANDLES;
            startup.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
            startup.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
            startup.hStdError = GetStdHandle(STD_ERROR_HANDLE);

            var commandLine = new StringBuilder(Quote(executable));
            foreach (var argument in arguments)
                commandLine.Append(' ').Append(Quote(argument));

            PreserveHostAccess(hostAccessPath);
            if (Process.GetCurrentProcess().SessionId == 0)
            {
                var hr = DeriveAppContainerSidFromAppContainerName(
                    identity, out sessionSid);
                if (hr != 0)
                    Marshal.ThrowExceptionForHR(hr);
                sessionDesktop = GrantServiceDesktop(
                    new SecurityIdentifier(sessionSid));
                startup.lpDesktop = sessionDesktop.Name;
            }
            if (!createProcess(
                executable,
                commandLine,
                IntPtr.Zero,
                IntPtr.Zero,
                false,
                CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT,
                IntPtr.Zero,
                workingDirectory,
                ref startup,
                identity,
                specification,
                (uint)sandboxSpecification.Length,
                out process))
                ThrowLastError("Experimental_CreateProcessInSandbox");
            if (sessionDesktop != null)
                DiagnoseSandboxToken(
                    process.hProcess, sessionSid,
                    sessionDesktop.Name);

            job = CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero)
                ThrowLastError("CreateJobObject");

            var limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            limits.BasicLimitInformation.LimitFlags =
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            var limitsSize = Marshal.SizeOf(typeof(
                JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            var limitsBuffer = Marshal.AllocHGlobal(limitsSize);
            try
            {
                Marshal.StructureToPtr(limits, limitsBuffer, false);
                if (!SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    limitsBuffer,
                    (uint)limitsSize))
                    ThrowLastError("SetInformationJobObject");
            }
            finally
            {
                Marshal.FreeHGlobal(limitsBuffer);
            }

            if (!AssignProcessToJobObject(job, process.hProcess))
                ThrowLastError("AssignProcessToJobObject");
            if (ResumeThread(process.hThread) == 0xFFFFFFFF)
                ThrowLastError("ResumeThread");

            WaitForSingleObject(process.hProcess, INFINITE);
            uint exitCode;
            if (!GetExitCodeProcess(process.hProcess, out exitCode))
                ThrowLastError("GetExitCodeProcess");
            return unchecked((int)exitCode);
        }
        finally
        {
            Exception jobDrainError = null;
            Exception sessionCleanupError = null;
            if (process.hThread != IntPtr.Zero)
                CloseHandle(process.hThread);
            if (process.hProcess != IntPtr.Zero)
                CloseHandle(process.hProcess);
            if (job != IntPtr.Zero)
            {
                try
                {
                    TerminateAndDrainJob(job);
                }
                catch (Exception error)
                {
                    jobDrainError = error;
                }
                finally
                {
                    CloseHandle(job);
                }
            }
            if (specification != IntPtr.Zero)
                Marshal.FreeHGlobal(specification);
            if (module != IntPtr.Zero)
                FreeLibrary(module);
            if (sessionDesktop != null)
            {
                try { sessionDesktop.Dispose(); }
                catch (Exception error) { sessionCleanupError = error; }
            }
            if (sessionSid != IntPtr.Zero)
                FreeSid(sessionSid);
            DeleteAppContainerProfile(identity);
            if (jobDrainError != null)
                throw jobDrainError;
            if (sessionCleanupError != null)
                throw sessionCleanupError;
        }
    }

    public static int LaunchClassic(
        string identity,
        string workspace,
        string workingDirectory,
        string hostAccessPath,
        string executable,
        string[] arguments,
        string[] writablePaths,
        string[] readOnlyPaths,
        bool allowNetwork)
    {
        IntPtr appContainerSid = IntPtr.Zero;
        IntPtr traverseCapabilitySid = IntPtr.Zero;
        IntPtr networkCapabilitySid = IntPtr.Zero;
        IntPtr capabilityBuffer = IntPtr.Zero;
        IntPtr securityCapabilitiesBuffer = IntPtr.Zero;
        IntPtr handleListBuffer = IntPtr.Zero;
        IntPtr attributeList = IntPtr.Zero;
        IntPtr job = IntPtr.Zero;
        IntPtr standardInput = IntPtr.Zero;
        IntPtr standardOutput = IntPtr.Zero;
        IntPtr standardError = IntPtr.Zero;
        SessionDesktopAccess sessionDesktop = null;
        var process = new PROCESS_INFORMATION();
        var grants = new List<Tuple<string, FileSystemAccessRule>>();

        try
        {
            var hr = CreateAppContainerProfile(
                identity,
                "Artemis Agent",
                "Ephemeral Artemis agent sandbox",
                IntPtr.Zero,
                0,
                out appContainerSid);
            if ((uint)hr == (0x80070000u | ERROR_ALREADY_EXISTS))
            {
                hr = DeriveAppContainerSidFromAppContainerName(
                    identity,
                    out appContainerSid);
            }
            if (hr != 0)
                Marshal.ThrowExceptionForHR(hr);

            PreserveHostAccess(hostAccessPath);
            var sid = new SecurityIdentifier(appContainerSid);
            sessionDesktop = GrantServiceDesktop(sid);
            var writablePathSet = new HashSet<string>(
                writablePaths,
                StringComparer.OrdinalIgnoreCase);
            foreach (var path in readOnlyPaths)
            {
                grants.Add(Tuple.Create(
                    path,
                    Grant(
                        path,
                        sid,
                        FileSystemRights.ReadAndExecute |
                            FileSystemRights.ListDirectory |
                             FileSystemRights.ReadAttributes |
                             FileSystemRights.Synchronize)));
            }
            if (!writablePathSet.Contains(workspace))
            {
                grants.Add(Tuple.Create(
                    workspace,
                    Grant(
                        workspace,
                        sid,
                        FileSystemRights.ReadAndExecute |
                            FileSystemRights.ListDirectory |
                            FileSystemRights.ReadAttributes |
                            FileSystemRights.Synchronize)));
            }
            foreach (var path in writablePaths)
            {
                grants.Add(Tuple.Create(
                    path,
                    Grant(
                        path,
                        sid,
                        FileSystemRights.Modify |
                            FileSystemRights.ReadAndExecute |
                            FileSystemRights.Synchronize)));
            }

            var capabilities = new SECURITY_CAPABILITIES
            {
                AppContainerSid = appContainerSid,
                Capabilities = IntPtr.Zero,
                CapabilityCount = allowNetwork ? 2u : 1u,
                Reserved = 0
            };
            traverseCapabilitySid = DeriveCapabilitySid(
                "artemisWorkspaceTraverse");
            var capabilityEntries = new List<SID_AND_ATTRIBUTES>();
            capabilityEntries.Add(new SID_AND_ATTRIBUTES
            {
                Sid = traverseCapabilitySid,
                Attributes = 0x00000004
            });
            if (allowNetwork)
            {
                networkCapabilitySid = DeriveCapabilitySid(
                    "internetClient");
                capabilityEntries.Add(new SID_AND_ATTRIBUTES
                {
                    Sid = networkCapabilitySid,
                    Attributes = 0x00000004
                });
            }
            var capabilitySize = Marshal.SizeOf(
                typeof(SID_AND_ATTRIBUTES));
            capabilityBuffer = Marshal.AllocHGlobal(
                capabilitySize * capabilityEntries.Count);
            for (var index = 0;
                index < capabilityEntries.Count;
                index++)
            {
                Marshal.StructureToPtr(
                    capabilityEntries[index],
                    new IntPtr(
                        capabilityBuffer.ToInt64() +
                        capabilitySize * index),
                    false);
            }
            capabilities.Capabilities = capabilityBuffer;

            securityCapabilitiesBuffer = Marshal.AllocHGlobal(
                Marshal.SizeOf(typeof(SECURITY_CAPABILITIES)));
            Marshal.StructureToPtr(
                capabilities,
                securityCapabilitiesBuffer,
                false);

            standardInput = DuplicateStandardHandle(STD_INPUT_HANDLE);
            standardOutput = DuplicateStandardHandle(STD_OUTPUT_HANDLE);
            standardError = DuplicateStandardHandle(STD_ERROR_HANDLE);
            handleListBuffer = Marshal.AllocHGlobal(IntPtr.Size * 3);
            Marshal.WriteIntPtr(handleListBuffer, 0, standardInput);
            Marshal.WriteIntPtr(handleListBuffer, IntPtr.Size, standardOutput);
            Marshal.WriteIntPtr(
                handleListBuffer,
                IntPtr.Size * 2,
                standardError);

            var attributeSize = IntPtr.Zero;
            InitializeProcThreadAttributeList(
                IntPtr.Zero,
                2,
                0,
                ref attributeSize);
            if (attributeSize == IntPtr.Zero)
                ThrowLastError(
                    "InitializeProcThreadAttributeList(size)");
            attributeList = Marshal.AllocHGlobal(attributeSize);
            if (!InitializeProcThreadAttributeList(
                attributeList,
                2,
                0,
                ref attributeSize))
                ThrowLastError(
                    "InitializeProcThreadAttributeList");
            if (!UpdateProcThreadAttribute(
                attributeList,
                0,
                PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,
                securityCapabilitiesBuffer,
                new IntPtr(Marshal.SizeOf(
                    typeof(SECURITY_CAPABILITIES))),
                IntPtr.Zero,
                IntPtr.Zero))
                ThrowLastError("UpdateProcThreadAttribute");
            if (!UpdateProcThreadAttribute(
                attributeList,
                0,
                PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
                handleListBuffer,
                new IntPtr(IntPtr.Size * 3),
                IntPtr.Zero,
                IntPtr.Zero))
                ThrowLastError("UpdateProcThreadAttribute(handle list)");

            var startup = new STARTUPINFOEX();
            startup.StartupInfo.cb = Marshal.SizeOf(
                typeof(STARTUPINFOEX));
            startup.StartupInfo.dwFlags =
                (int)STARTF_USESTDHANDLES;
            startup.StartupInfo.hStdInput =
                standardInput;
            startup.StartupInfo.hStdOutput =
                standardOutput;
            startup.StartupInfo.hStdError =
                standardError;
            if (sessionDesktop != null)
                startup.StartupInfo.lpDesktop = sessionDesktop.Name;
            startup.AttributeList = attributeList;

            var commandLine = new StringBuilder(Quote(executable));
            foreach (var argument in arguments)
                commandLine.Append(' ').Append(Quote(argument));

            if (!CreateProcess(
                executable,
                commandLine,
                IntPtr.Zero,
                IntPtr.Zero,
                true,
                CREATE_SUSPENDED |
                    CREATE_UNICODE_ENVIRONMENT |
                    EXTENDED_STARTUPINFO_PRESENT,
                IntPtr.Zero,
                workingDirectory,
                ref startup,
                out process))
                ThrowLastError("CreateProcess(AppContainer)");

            CloseHandle(standardInput);
            standardInput = IntPtr.Zero;
            CloseHandle(standardOutput);
            standardOutput = IntPtr.Zero;
            CloseHandle(standardError);
            standardError = IntPtr.Zero;

            job = CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero)
                ThrowLastError("CreateJobObject");
            var limits =
                new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            limits.BasicLimitInformation.LimitFlags =
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            var limitsSize = Marshal.SizeOf(typeof(
                JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            var limitsBuffer = Marshal.AllocHGlobal(limitsSize);
            try
            {
                Marshal.StructureToPtr(
                    limits,
                    limitsBuffer,
                    false);
                if (!SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    limitsBuffer,
                    (uint)limitsSize))
                    ThrowLastError("SetInformationJobObject");
            }
            finally
            {
                Marshal.FreeHGlobal(limitsBuffer);
            }
            if (!AssignProcessToJobObject(job, process.hProcess))
                ThrowLastError("AssignProcessToJobObject");
            if (ResumeThread(process.hThread) == 0xFFFFFFFF)
                ThrowLastError("ResumeThread");

            WaitForSingleObject(process.hProcess, INFINITE);
            uint exitCode;
            if (!GetExitCodeProcess(process.hProcess, out exitCode))
                ThrowLastError("GetExitCodeProcess");
            return unchecked((int)exitCode);
        }
        finally
        {
            Exception jobDrainError = null;
            Exception sessionCleanupError = null;
            if (process.hThread != IntPtr.Zero)
                CloseHandle(process.hThread);
            if (process.hProcess != IntPtr.Zero)
                CloseHandle(process.hProcess);
            if (job != IntPtr.Zero)
            {
                try
                {
                    TerminateAndDrainJob(job);
                }
                catch (Exception error)
                {
                    jobDrainError = error;
                }
                finally
                {
                    CloseHandle(job);
                }
            }
            if (attributeList != IntPtr.Zero)
            {
                DeleteProcThreadAttributeList(attributeList);
                Marshal.FreeHGlobal(attributeList);
            }
            if (securityCapabilitiesBuffer != IntPtr.Zero)
                Marshal.FreeHGlobal(securityCapabilitiesBuffer);
            if (handleListBuffer != IntPtr.Zero)
                Marshal.FreeHGlobal(handleListBuffer);
            if (standardInput != IntPtr.Zero)
                CloseHandle(standardInput);
            if (standardOutput != IntPtr.Zero)
                CloseHandle(standardOutput);
            if (standardError != IntPtr.Zero)
                CloseHandle(standardError);
            if (capabilityBuffer != IntPtr.Zero)
                Marshal.FreeHGlobal(capabilityBuffer);
            if (networkCapabilitySid != IntPtr.Zero)
                LocalFree(networkCapabilitySid);
            if (traverseCapabilitySid != IntPtr.Zero)
                LocalFree(traverseCapabilitySid);
            for (var index = grants.Count - 1; index >= 0; index--)
            {
                try
                {
                    Revoke(
                        grants[index].Item1,
                        grants[index].Item2);
                }
                catch
                {
                    // The deleted profile SID cannot authenticate
                    // even if best-effort ACL cleanup is interrupted.
                }
            }
            if (sessionDesktop != null)
            {
                try { sessionDesktop.Dispose(); }
                catch (Exception error) { sessionCleanupError = error; }
            }
            if (appContainerSid != IntPtr.Zero)
                FreeSid(appContainerSid);
            DeleteAppContainerProfile(identity);
            if (jobDrainError != null)
                throw jobDrainError;
            if (sessionCleanupError != null)
                throw sessionCleanupError;
        }
    }
}
'@

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

# SandboxSpec accepts fully qualified paths on any volume. Use classic
# AppContainer only when the experimental API is unavailable.
$diagnosticClassic =
  ($env:ARTEMIS_WINDOWS_SANDBOX_DIAGNOSTICS -eq '1') -and
  ($env:ARTEMIS_WINDOWS_SANDBOX_DIAGNOSTIC_CLASSIC -eq '1')
$useClassicAppContainer = $diagnosticClassic
if (-not $useClassicAppContainer) {
  try {
    Write-SandboxDiagnostic 'launching experimental AppContainer'
    $exitCode = [ArtemisNativeSandbox]::Launch(
      $Identity,
      $workingDirectory,
      $hostAccess,
      $Executable,
      $commandArguments,
      $sandboxSpecification
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
  if (-not $diagnosticClassic) {
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
    ($NetworkPolicy -eq 'allow')
  )
}
Write-SandboxDiagnostic "sandbox child exited: $exitCode"
exit $exitCode

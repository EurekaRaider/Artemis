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

    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr memory);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool FreeSid(IntPtr sid);

    private static void ThrowLastError(string operation)
    {
        var error = Marshal.GetLastWin32Error();
        throw new InvalidOperationException(
            operation + " failed: " + error + " (" +
            new Win32Exception(error).Message + ")");
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
        var rule = new FileSystemAccessRule(
            sid,
            rights,
            InheritanceFlags.ContainerInherit |
                InheritanceFlags.ObjectInherit,
            PropagationFlags.None,
            AccessControlType.Allow);
        var directory = new DirectoryInfo(path);
        var security = directory.GetAccessControl(
            AccessControlSections.Access);
        security.AddAccessRule(rule);
        directory.SetAccessControl(security);
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
        Grant(path, userSid, FileSystemRights.FullControl);
    }

    private static void Revoke(
        string path,
        FileSystemAccessRule rule)
    {
        var directory = new DirectoryInfo(path);
        var security = directory.GetAccessControl(
            AccessControlSections.Access);
        security.RemoveAccessRuleSpecific(rule);
        directory.SetAccessControl(security);
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
            DeleteAppContainerProfile(identity);
            if (jobDrainError != null)
                throw jobDrainError;
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
            if (appContainerSid != IntPtr.Zero)
                FreeSid(appContainerSid);
            DeleteAppContainerProfile(identity);
            if (jobDrainError != null)
                throw jobDrainError;
        }
    }
}
'@

Add-Type -TypeDefinition $nativeSource -Language CSharp
$workspaceRoot = [System.IO.Path]::GetPathRoot($workspace)
$systemRoot = [System.IO.Path]::GetPathRoot(
  [System.Environment]::SystemDirectory
)
$requiresClassicAppContainer = -not $workspaceRoot.Equals(
  $systemRoot,
  [System.StringComparison]::OrdinalIgnoreCase
)
if ($requiresClassicAppContainer) {
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

if ($requiresClassicAppContainer) {
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
else {
  try {
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
}
exit $exitCode

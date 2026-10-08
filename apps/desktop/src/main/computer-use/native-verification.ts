import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import {
  computerUsePackManifestSchema,
  type CapabilityPackManifest,
} from "@artemis/protocol";
const run = promisify(execFile);

export async function verifyComputerUseNative(
  root: string,
  manifest: CapabilityPackManifest,
): Promise<void> {
  const pack = computerUsePackManifestSchema.parse(manifest);
  if (pack.platform !== process.platform)
    throw new Error("Computer Use native platform mismatch");
  if (process.platform === "darwin") {
    const app = join(root, "ArtemisComputerUse.app");
    await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app], {
      timeout: 60000,
    });
    const identity = await run(
      "/usr/bin/codesign",
      ["-dv", "--verbose=4", app],
      { timeout: 10000 },
    );
    if (
      !identity.stderr
        .split(/\r?\n/u)
        .includes("TeamIdentifier=" + pack.native.signer) ||
      !identity.stderr
        .split(/\r?\n/u)
        .includes("Identifier=com.artemis.computer-use") ||
      !/flags=0x[\da-f]+\([^\r\n)]*\bruntime\b/iu.test(identity.stderr)
    )
      throw new Error(
        "Computer Use signing identity or hardened runtime mismatch",
      );
    await run("/usr/bin/xcrun", ["stapler", "validate", app], {
      timeout: 60000,
    });
    await run("/usr/sbin/spctl", ["--assess", "--type", "execute", app], {
      timeout: 60000,
    });
    return;
  }
  if (process.platform !== "win32")
    throw new Error("Unsupported Computer Use platform");
  // No downloaded text is interpolated into the verification program.
  const script =
    "$ErrorActionPreference='Stop'; $p=$env:ARTEMIS_COMPUTER_VERIFY_PATH; $s=Get-AuthenticodeSignature -LiteralPath $p; if($env:ARTEMIS_COMPUTER_VERIFY_SIGNER -eq 'unsigned'){if($s.Status -ne 'NotSigned'){throw 'Unexpected native signature'}} elseif($s.Status -ne 'Valid' -or $s.SignerCertificate.Thumbprint -ne $env:ARTEMIS_COMPUTER_VERIFY_SIGNER){throw 'Native signature mismatch'}; $trusted=@([System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18','S-1-5-32-544'); $paths=@();$d=$env:ARTEMIS_COMPUTER_VERIFY_ROOT;for($i=0;$i-lt 4;$i++){$paths+=$d;$parent=[System.IO.Directory]::GetParent($d);if(!$parent){break};$d=$parent.FullName};foreach($path in $paths+(Get-ChildItem -LiteralPath $env:ARTEMIS_COMPUTER_VERIFY_ROOT -Recurse -Force | ForEach-Object FullName)){$acl=Get-Acl -LiteralPath $path; if($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -notin $trusted){throw 'Unsafe native installation owner'}; foreach($a in $acl.Access){if($a.AccessControlType -eq 'Allow' -and $a.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -notin $trusted -and ([int]$a.FileSystemRights -band 0xD0156)){throw 'Unsafe Computer Use installation ACL'}}}";
  await run(
    join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      timeout: 30000,
      windowsHide: true,
      env: {
        SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
        ARTEMIS_COMPUTER_VERIFY_ROOT: root,
        ARTEMIS_COMPUTER_VERIFY_PATH: join(root, pack.entrypoint),
        ARTEMIS_COMPUTER_VERIFY_SIGNER: pack.native.signer ?? "unsigned",
      },
    },
  );
}

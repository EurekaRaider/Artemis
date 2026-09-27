// A private, temporary installation under the current ordinary user's LocalAppData.
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

if (process.platform !== "win32" || !process.env.LOCALAPPDATA)
  throw Error("A Windows user profile is required");
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([name]) => name.toLowerCase() !== "psmodulepath",
  ),
);
execFileSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "$ErrorActionPreference='Stop'; $p=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()); if($p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Ordinary user required'}; if((Get-CimInstance Win32_OperatingSystem).ProductType -ne 1){throw 'Windows client OS required'}",
  ],
  { env, stdio: "inherit" },
);
const base = await mkdtemp(
  join(process.env.LOCALAPPDATA, "Artemis Office 验收-"),
);
const out = resolve("artifacts/office/client");
await mkdir(out, { recursive: true });
try {
  const workspace = join(base, "验证文档");
  await cp(resolve("artifacts/office/corpus"), workspace, { recursive: true });
  const result = spawnSync(
    process.execPath,
    [
      resolve("artifacts/office/candidate-tools/verify-candidate.mjs"),
      resolve("artifacts/office/candidate"),
      join(base, "capability-packs"),
      workspace,
      out,
      resolve("scripts/office/probe-native.mjs"),
    ],
    { env, stdio: "inherit", timeout: 1_800_000 },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw Error("Windows client candidate acceptance failed");
} finally {
  // The dedicated runtime should exit through UNO shutdown. This fallback can
  // stop only binaries under the unique directory created by this invocation.
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$ErrorActionPreference='Stop'; $prefix=$env:OFFICE_CLIENT_ROOT+[IO.Path]::DirectorySeparatorChar; Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)} | ForEach-Object {Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue}",
    ],
    { env: { ...env, OFFICE_CLIENT_ROOT: base }, stdio: "inherit" },
  );
  await rm(base, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 500,
  });
  const report = JSON.parse(await readFile(join(out, "report.json"), "utf8"));
  report.temporaryClientInstallationRemoved = true;
  await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2));
}

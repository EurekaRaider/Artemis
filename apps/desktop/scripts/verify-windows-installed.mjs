import { execFileSync } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { verifyPackagedStartup } from "./verify-packaged-startup.mjs";
if (
  process.platform !== "win32" ||
  process.arch !== "x64" ||
  process.env.GITHUB_ACTIONS !== "true" ||
  process.env.RUNNER_ENVIRONMENT !== "github-hosted"
)
  throw new Error(
    "Installed-package verification requires a disposable GitHub-hosted Windows x64 runner",
  );
const { version } = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const root = await mkdtemp(join(tmpdir(), "Artemis-安装验证-"));
const install = join(root, "应用 程序");
const exe = join(install, "Artemis.exe");
const installer = resolve("release", `Artemis-Windows-x64-${version}.exe`);
const ps = (script) =>
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$ErrorActionPreference='Stop'; ${script}`,
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        ARTEMIS_TEST_INSTALL: install,
        ARTEMIS_TEST_INSTALLER: installer,
      },
      timeout: 240000,
    },
  );
let installed = false;
try {
  ps(
    "$p=Start-Process -FilePath $env:ARTEMIS_TEST_INSTALLER -ArgumentList ('/S /D='+$env:ARTEMIS_TEST_INSTALL) -PassThru -Wait; if($p.ExitCode -ne 0){throw \"Installer failed\"}",
  );
  installed = true;
  const marker = JSON.parse(
    await readFile(join(install, "resources/distribution.json"), "utf8"),
  );
  if (marker.distribution !== "nsis" || marker.arch !== "x64")
    throw Error("NSIS distribution marker missing");
  await verifyPackagedStartup(
    exe,
    join(root, "profile"),
    join(root, "startup.png"),
  );
  execFileSync(
    exe,
    [
      resolve("../../node_modules/vitest/vitest.mjs"),
      "run",
      "test/design-plugin-runtime-worker-sandbox.test.ts",
    ],
    {
      cwd: resolve("."),
      stdio: "inherit",
      timeout: 180000,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        ARTEMIS_DESIGN_TEST_HELPER: join(
          install,
          "resources/resources/windows-sandbox.ps1",
        ),
      },
    },
  );
  console.log(
    JSON.stringify({
      installedPath: install,
      arch: "x64",
      distribution: "nsis",
      unicodePath: true,
      startup: true,
      designSandbox: true,
      environment:
        "GitHub-hosted Windows Server; not Windows 11 manual acceptance",
    }),
  );
} finally {
  if (installed)
    ps(
      '$u=Join-Path $env:ARTEMIS_TEST_INSTALL "Uninstall Artemis.exe"; if(Test-Path -LiteralPath $u){$p=Start-Process -FilePath $u -ArgumentList "/S" -Wait -PassThru; if($p.ExitCode -ne 0){throw "Uninstall failed"}}',
    );
  await rm(root, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 300,
  });
}

import { execFile } from "node:child_process";
import {
  copyFile,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it.skipIf(process.platform !== "win32")(
  "keeps PowerShell alive after quitting without locking the application executable",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "artemis-update-launcher-"));
    const launcher = fileURLToPath(
      new URL(
        "../../../resources/windows-install-recover.cjs",
        import.meta.url,
      ),
    );
    const parent = join(root, "parent.cjs");
    const helper = join(root, "helper.ps1");
    const state = join(root, "state.json");
    const ready = join(root, "ready.marker");
    const survived = join(root, "survived.marker");
    const release = join(root, "release.marker");
    const application = join(root, "Artemis.exe");
    const host = join(root, "update-recovery.exe");
    try {
      await copyFile(process.execPath, application);
      await copyFile(process.execPath, host);
      await writeFile(
        helper,
        `param([string]$StatePath)
$state = Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json
if (Test-Path Env:ELECTRON_RUN_AS_NODE) { exit 1 }
[IO.File]::WriteAllText($state.ready, 'ready')
$deadline = [DateTime]::UtcNow.AddSeconds(15)
while (Get-Process -Id $state.parentPid -ErrorAction SilentlyContinue) {
  if ([DateTime]::UtcNow -gt $deadline) { exit 1 }
  Start-Sleep -Milliseconds 100
}
[IO.File]::WriteAllText($state.survived, 'survived')
while (-not (Test-Path -LiteralPath $state.release)) {
  if ([DateTime]::UtcNow -gt $deadline) { exit 1 }
  Start-Sleep -Milliseconds 100
}
`,
      );
      await writeFile(
        parent,
        `const fs = require('node:fs');
const { spawn } = require('node:child_process');
fs.writeFileSync(${JSON.stringify(state)}, JSON.stringify({ parentPid: process.pid, ready: ${JSON.stringify(ready)}, survived: ${JSON.stringify(survived)}, release: ${JSON.stringify(release)} }));
const log = fs.openSync(${JSON.stringify(join(root, "helper.log"))}, 'w');
const child = spawn(${JSON.stringify(host)}, ${JSON.stringify([launcher, helper, state])}, { detached: true, windowsHide: true, stdio: ['ignore', log, log], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
fs.closeSync(log);
child.unref();
child.once('error', () => process.exit(1));
const deadline = Date.now() + 10000;
setInterval(() => {
  if (fs.existsSync(${JSON.stringify(ready)})) process.exit(0);
  if (Date.now() > deadline) process.exit(1);
}, 100);
`,
      );
      await promisify(execFile)(application, [parent], { timeout: 15000 });
      await expect
        .poll(() => readFile(survived, "utf8"), { timeout: 10000 })
        .toBe("survived");
      await rename(application, `${application}.replaced`);
    } finally {
      await writeFile(release, "release");
      await rm(root, { recursive: true, force: true, maxRetries: 3 });
    }
  },
  30000,
);

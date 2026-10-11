import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assertInstalledComputerUse } from "./installed-computer-use-state.mjs";

if (process.platform !== "darwin" || process.arch !== "x64")
  throw new Error("Intel capability acceptance requires native macOS x64");
const executable = process.env.ARTEMIS_CAPABILITY_EXECUTABLE;
assert(executable, "Provide the final signed ZIP application's executable");
const { _electron: electron } = await import("playwright-core");
const require = createRequire(import.meta.url);
const hostVersion = require(resolve("package.json")).version;
const catalog = JSON.parse(
  await readFile("apps/desktop/resources/office-runtime/catalog.json", "utf8"),
);
const office = catalog.additionalManifests?.find(
  (manifest) => manifest.platform === "darwin" && manifest.arch === "x64",
);
assert(
  office,
  "Merge the accepted Intel Office catalog before releasing the host",
);
const root = await mkdtemp(join(tmpdir(), "artemis-intel-install-"));
const output = resolve("artifacts/verification/installed-intel-capabilities");
await mkdir(output, { recursive: true });
const report = {
  sourceCommit: process.env.GITHUB_SHA,
  hostVersion,
  platform: process.platform,
  arch: process.arch,
  checks: [],
};
let app;
try {
  app = await electron.launch({
    executablePath: executable,
    args: [`--user-data-dir=${join(root, "profile")}`],
    env: { ...process.env, ARTEMIS_DISABLE_AUTO_UPDATE: "1" },
  });
  report.runtime = await app.evaluate(({ app }) => ({
    version: app.getVersion(),
    packaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
  }));
  assert.deepEqual(report.runtime, {
    version: hostVersion,
    packaged: true,
    platform: "darwin",
    arch: "x64",
  });
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.artemis);
  report.office = await page.evaluate(async () => {
    const before = await window.artemis.officeCapabilityStatus();
    await window.artemis.installOfficeCapability();
    return { before, after: await window.artemis.officeCapabilityStatus() };
  });
  assert.equal(report.office.before.activeVersion, undefined);
  assert.equal(report.office.before.availableVersion, office.version);
  assert.equal(report.office.after.activeVersion, office.version);
  report.checks.push(
    "Office discovered and installed through packaged host IPC in a fresh profile",
  );
  report.computerUse = await page.evaluate(async () => {
    await window.artemis.checkComputerRuntimeUpdates();
    const before = await window.artemis.computerRuntimeStatus();
    await window.artemis.installArtemisPlugin(
      { kind: "builtin", pluginName: "computer-use" },
      crypto.randomUUID(),
    );
    const plugin = (await window.artemis.listArtemisPlugins()).find(
      (plugin) => plugin.name === "computer-use",
    );
    return {
      before,
      after: await window.artemis.computerRuntimeStatus(),
      plugin,
      skills: (await window.artemis.listInstalledSkills())
        .filter((skill) => plugin?.skillNames.includes(skill.name))
        .map(({ name, enabled }) => ({ name, enabled })),
      mcpServers: (await window.artemis.listMcpServers())
        .filter(({ config }) => plugin?.mcpServerIds.includes(config.id))
        .map(({ config }) => ({ id: config.id, enabled: config.enabled })),
    };
  });
  assertInstalledComputerUse(report.computerUse);
  report.checks.push(
    "Computer Use discovered, installed and probed by the signed packaged host in a fresh profile",
  );
  report.preview = await app.evaluate(({ app }, version) => {
    const path = process.getBuiltinModule("path");
    const require = process
      .getBuiltinModule("module")
      .createRequire(path.join(app.getAppPath(), "package.json"));
    const binding = require(
      path.join(
        app.getPath("userData"),
        "capability-packs",
        "computer-use",
        version,
        "ArtemisComputerUse.app",
        "Contents",
        "Frameworks",
        "artemis-computer-preview.node",
      ),
    );
    return { loaded: true, exports: Object.getOwnPropertyNames(binding) };
  }, report.computerUse.after.activeVersion);
  assert.equal(report.preview.loaded, true);
  report.checks.push(
    "Installed Intel preview module loads in the final signed Electron host",
  );
} catch (error) {
  report.failure = String(error.stack ?? error);
  process.exitCode = 1;
} finally {
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await app?.close();
  await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify(report, null, 2));
}

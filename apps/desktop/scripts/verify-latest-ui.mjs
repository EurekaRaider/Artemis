import { verifyLatestUiInteractions } from "./verify-latest-ui-interactions.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile, readdir, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const app = join(root, "apps/desktop");
const output = resolve(
  process.argv[2] || join(root, "artifacts/ui-migration-9556fac"),
);
const electron = createRequire(import.meta.url)("electron");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
async function fingerprint() {
  const paths = [
    ...new Set(git("ls-files", "-co", "--exclude-standard").split("\n")),
  ].sort();
  return hash(
    Buffer.from(
      (
        await Promise.all(
          paths.map(
            async (path) =>
              `${path}\0${hash(await readFile(join(root, path)))}`,
          ),
        )
      ).join("\n"),
    ),
  );
}
async function treeHash(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const records = await Promise.all(
    entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(
        async (entry) =>
          `${entry.name}\0${entry.isDirectory() ? await treeHash(join(directory, entry.name)) : hash(await readFile(join(directory, entry.name)))}`,
      ),
  );
  return hash(Buffer.from(records.join("\n")));
}
const sourceFingerprint = await fingerprint();
const rendererFingerprint = await treeHash(join(app, "dist-renderer"));
const manifest = JSON.parse(
  await readFile(join(root, "scripts/ui-prototype-manifest.json"), "utf8"),
);
for (const file of manifest.files)
  assert.equal(
    hash(await readFile(join(root, file.path))),
    file.sha256,
    `Frozen prototype changed: ${file.path}`,
  );
await mkdir(output, { recursive: true });
const temp = await mkdtemp(join(tmpdir(), "artemis-latest-ui-"));
const cases = [
  ["workspace-light", "", "light"],
  ["workspace-dark", "", "dark"],
  ["workspace-narrow", "", "light", 980],
  ["goal-active", "goal-active", "light"],
  ["goal-paused", "goal-paused", "dark"],
  ["goal-blocked", "goal-blocked", "light"],
  ["goal-usage-limited", "goal-usage-limited", "dark"],
  ["goal-budget-limited", "goal-budget-limited", "light"],
  ["goal-complete", "goal-complete", "dark"],
  ["settings-light", "feedback-layout-settings", "light"],
  ["settings-dark", "feedback-layout-settings", "dark"],
  ["archive", "secondary-pages-archive", "light"],
  ["usage", "secondary-pages-token-usage", "dark"],
  ["automation", "secondary-pages-automations", "light"],
  ["environment-light", "environment-open", "light"],
  ["environment-dark", "environment-open", "dark"],
  ["dock-workspace", "environment-dock-workspace", "light"],
  ["sources", "environment-sources", "dark"],
  ["markdown-dirty", "markdown-editor-dirty", "light"],
  ["mcp-editor", "mcp-editor-new", "dark"],
];
const report = {
  schemaVersion: 1,
  sourceCommit: git("rev-parse", "HEAD"),
  dirty: git("status", "--porcelain") !== "",
  sourceFingerprint,
  rendererFingerprint,
  prototypeCommit: manifest.sourceCommit,
  platform: process.platform,
  architecture: process.arch,
  boundary:
    "Native production smoke, bound to working-tree and built-renderer hashes. Not prototype pixel parity, external accounts, signed packaging or cross-platform acceptance.",
  cases: [],
};
try {
  for (const [id, view, theme, width = 1440] of cases) {
    const screenshot = join(output, `${id}.png`);
    const accessibility = join(output, `${id}.json`);
    const env = {
      ...process.env,
      ARTEMIS_SMOKE_SCREENSHOT: screenshot,
      ARTEMIS_SMOKE_ACCESSIBILITY: accessibility,
      ARTEMIS_SMOKE_VIEW: view,
      ARTEMIS_SMOKE_LOCALE: view ? "en" : "zh-CN",
      ARTEMIS_SMOKE_THEME: theme,
      ARTEMIS_SMOKE_WINDOW_WIDTH: String(width),
      ARTEMIS_SMOKE_WINDOW_HEIGHT: "900",
    };
    if (view.startsWith("markdown-editor")) {
      const workspace = join(temp, `${id}-workspace`);
      await mkdir(workspace, { recursive: true });
      await writeFile(
        join(workspace, "NOTES.md"),
        "# Migration notes\n\nUnsaved content must survive Dock navigation.\n",
      );
      env.ARTEMIS_SMOKE_WORKSPACE = workspace;
    }
    delete env.ARTEMIS_DEV_SERVER_URL;
    delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(
      electron,
      [app, `--user-data-dir=${join(temp, id)}`, "--disable-gpu"],
      { cwd: app, env, encoding: "utf8", timeout: 60000 },
    );
    assert.equal(
      result.status,
      0,
      `${id}: ${result.error?.message || result.stderr}`,
    );
    const audit = JSON.parse(await readFile(accessibility, "utf8"));
    const bytes = await readFile(screenshot);
    assert(bytes.length > 10000, `${id}: empty screenshot`);
    assert.deepEqual(
      audit.rendererConsoleEntries,
      [],
      `${id}: renderer errors`,
    );
    assert.deepEqual(audit.issues, [], `${id}: inaccessible control`);
    assert.equal(audit.resolvedTheme, theme, `${id}: wrong theme`);
    assert(audit.interactiveCount > 0, `${id}: no controls`);
    if (view.startsWith("goal-"))
      assert(
        audit.goalBar && audit.goalActionLabels?.length > 0,
        `${id}: missing goal controls`,
      );
    report.cases.push({
      id,
      view,
      theme,
      width,
      screenshotSha256: hash(bytes),
      auditSha256: hash(await readFile(accessibility)),
      interactiveCount: audit.interactiveCount,
      status: "passed",
    });
    console.log(`${id}: passed`);
  }
  report.interactions = await verifyLatestUiInteractions({
    root,
    temp,
    output,
    electron,
  });
  assert.equal(
    await fingerprint(),
    sourceFingerprint,
    "Source changed during native verification",
  );
  assert.equal(
    await treeHash(join(app, "dist-renderer")),
    rendererFingerprint,
    "Renderer changed during native verification",
  );
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = String(error);
  process.exitCode = 1;
} finally {
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    `${report.status}: ${report.cases.length}/${cases.length} native scenarios`,
  );
  if (report.error) console.error(report.error);
}

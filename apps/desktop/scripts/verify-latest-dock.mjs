import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
const { _electron } = await import(
  process.env.ARTEMIS_PLAYWRIGHT_MODULE || "playwright"
);
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const candidateHead = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
assert.equal(
  process.env.ARTEMIS_EXPECTED_HEAD || candidateHead,
  candidateHead,
  "Candidate HEAD changed",
);
const chromeInset = process.platform === "darwin" ? 28 : 0;
const out =
  process.argv[2] || join(root, "artifacts/ui-migration-9556fac/dock");
const temp = await mkdtemp(join(tmpdir(), "artemis-latest-dock-"));
const data = join(temp, "user-data"),
  project = join(temp, "Artemis");
await Promise.all([
  mkdir(data),
  mkdir(project),
  mkdir(out, { recursive: true }),
]);
const { build } = createRequire(root + "/apps/desktop/package.json")("esbuild");
const storeModule = join(temp, "store.mjs");
await build({
  entryPoints: [join(root, "apps/desktop/src/main/store.ts")],
  outfile: storeModule,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  logLevel: "silent",
});
const { AppStore } = await import(pathToFileURL(storeModule).href);
const store = new AppStore(join(data, "artemis.sqlite"));
const now = new Date().toISOString();
store.upsertProject({
  id: "parity-project",
  name: "Artemis",
  path: project,
  createdAt: now,
  updatedAt: now,
});
store.createThread({
  id: "parity-thread",
  projectId: "parity-project",
  title: "UI 设计语言改版",
  mode: "execute",
  target: "local",
  status: "completed",
  pinned: false,
  archived: false,
  createdAt: now,
  updatedAt: now,
});
store.appendEvent("parity-user", "parity-thread", "parity-turn", {
  type: "user.message",
  messageId: "parity-user-message",
  text: "请对齐 Artemis 当前的主界面与子面板，使用现有组件重新编排 UI 原型。",
});
store.appendEvent("parity-start", "parity-thread", "parity-turn", {
  type: "turn.started",
  mode: "execute",
});
store.appendEvent("parity-answer", "parity-thread", "parity-turn", {
  type: "message.part.delta",
  partId: "parity-answer",
  partType: "text",
  delta:
    "已梳理主界面与各工具面板，正在统一组件的使用方式。\n\n先整理会话和输入区，再检查审查、文件和设置面板。你可以在右侧查看改动，或从环境面板打开目标、来源与 Agent 活动。",
});
store.appendEvent("parity-done", "parity-thread", "parity-turn", {
  type: "turn.completed",
  reason: "completed",
  finalPartId: "parity-answer",
  durationMs: 252000,
});
store.setThreadGoal(
  "parity-thread",
  "对齐 Artemis 当前主界面与子面板，使用现有组件组装一套可交互的 UI 原型，并完成布局与交互检查。",
  undefined,
  "paused",
);
const extra = [
  {
    type: "agent-team.status",
    teamId: "parity-team",
    mission: "UI 实现团队",
    status: "completed",
    memberAgentIds: ["parity-agent"],
    requiredAgentIds: ["parity-agent"],
    maxMembers: 8,
    updatedAt: now,
  },
  {
    type: "child-agent.status",
    agentId: "parity-agent",
    teamId: "parity-team",
    label: "布局检查",
    status: "completed",
    task: "核对主界面及子面板的信息层级、入口和容器关系。",
    output:
      "已核对 9 类 Dock 面板。建议保持会话区独立滚动，并将上下文入口集中到环境浮层。",
    updatedAt: now,
  },
  {
    type: "mcp.tool.used",
    toolCallId: "parity-mcp",
    serverId: "filesystem",
    serverName: "filesystem",
    toolName: "read_file",
    agentId: "parent",
  },
  {
    type: "task.source.added",
    sourceId: "parity-source",
    kind: "file",
    name: "README.md",
    mimeType: "text/markdown",
  },
];
for (const [i, payload] of extra.entries())
  store.appendEvent(
    "parity-extra-" + i,
    "parity-thread",
    "parity-turn",
    payload,
  );
store.close();
execFileSync("git", ["init", "-b", "main"], { cwd: project, stdio: "ignore" });
await writeFile(
  join(project, "README.md"),
  "# Artemis\n\nUI prototype parity fixture.\n",
);
const env = { ...process.env };
for (const key of Object.keys(env))
  if (
    key === "ELECTRON_RUN_AS_NODE" ||
    key === "ARTEMIS_DEV_SERVER_URL" ||
    key.startsWith("ARTEMIS_SMOKE_")
  )
    delete env[key];
const app = await _electron.launch({
  executablePath: createRequire(root + "/apps/desktop/package.json")(
    "electron",
  ),
  args: [root + "/apps/desktop", `--user-data-dir=${data}`],
  env,
  timeout: 30000,
});
const product = await app.firstWindow();
const errors = [];
product.on("pageerror", (e) =>
  errors.push({ surface: "product", message: e.message }),
);
try {
  await product.waitForFunction(() => !!window.artemis);
  await app.evaluate(({ BrowserWindow }, chromeInset) => {
    globalThis.__productWindow = BrowserWindow.getAllWindows()[0];
    globalThis.__productWindow.setContentSize(1440, 900 + chromeInset);
  }, chromeInset);
  await product.evaluate(async () => {
    await window.artemis.setLanguage("zh-CN");
    await window.artemis.setTheme("light");
  });
  await product.waitForTimeout(800);
  if (
    (await product.locator(".sidebar").getAttribute("aria-hidden")) === "true"
  )
    await product
      .locator(".workspace-header")
      .getByRole("button")
      .first()
      .click();
  await product.getByText("UI 设计语言改版", { exact: true }).first().click();
  const dismiss = product.getByRole("button", { name: "暂不", exact: true });
  if (await dismiss.count()) await dismiss.click();
  if (
    (await product
      .locator(".right-sidebar-toggle")
      .getAttribute("aria-expanded")) === "true"
  )
    await product.locator(".right-sidebar-toggle").click();
  const checks = [];
  const capture = async (name) => {
    await product
      .locator('[data-artemis-component="workspace-dock"][data-state="open"]')
      .waitFor();
    await product.screenshot({
      path: join(out, name + ".png"),
      animations: "disabled",
    });
    checks.push(name);
  };
  const launch = async (label) => {
    if (
      (await product
        .locator(".right-sidebar-toggle")
        .getAttribute("aria-expanded")) !== "true"
    )
      await product.locator(".right-sidebar-toggle").click();
    await product.locator(".workspace-tab-add").click();
    await product
      .locator(".workspace-tab-menu")
      .getByRole("button", { name: label, exact: true })
      .click();
  };
  await launch("文件");
  await product
    .locator('[data-artemis-component="workspace-file-tree-row"]:visible')
    .filter({ hasText: "README.md" })
    .click();
  await capture("files");
  for (const [name, label] of [
    ["review", "审查"],
    ["terminal", "终端"],
    ["browser", "浏览器"],
  ]) {
    await launch(label);
    await capture(name);
  }
  await product.locator(".goal-bar-main").click();
  await product.locator(".goal-editor-input").waitFor();
  const originalGoal = await product.locator(".goal-editor-input").inputValue();
  await product
    .locator(".goal-editor-input")
    .fill(originalGoal + "\n未保存目标草稿");
  await capture("goal");
  for (const [name, selector] of [
    ["sources", ".environment-view-all"],
    ["team", '.environment-activity-row:has-text("UI 实现团队")'],
    ["agent", '.environment-activity-row:has-text("布局检查")'],
  ]) {
    await product.locator(".environment-trigger").click();
    await product.locator(selector).click();
    await capture(name);
  }
  await launch("文件");
  await product
    .locator('[data-artemis-component="workspace-file-tree-row"]:visible')
    .filter({ hasText: "README.md" })
    .click();
  await product
    .locator(".workspace-files-panel > .workspace-panel-toolbar")
    .getByRole("button", { name: /阅读/ })
    .click();
  await capture("markdown");
  assert.deepEqual(errors, []);
  assert.equal(checks.length, 9);
  await writeFile(
    join(out, "report.json"),
    JSON.stringify(
      {
        status: "passed",
        candidateHead,
        checks,
        platform: process.platform,
        architecture: process.arch,
        boundary:
          "Nine production Dock views only; no prototype rendering or pixel parity.",
      },
      null,
      2,
    ) + "\n",
  );
  console.log("Nine production Dock views passed");
} finally {
  await app.close();
}

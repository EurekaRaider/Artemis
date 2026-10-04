import { verificationOutput } from "../../../../../scripts/artifacts/output-path.mjs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
const { _electron } = await import(
  process.env.ARTEMIS_PLAYWRIGHT_MODULE || "playwright"
);
const root = fileURLToPath(new URL("../../../../../", import.meta.url)),
  out = process.argv[2] || verificationOutput("automation-redesign");
await mkdir(out, { recursive: true });
const require = createRequire(root + "/package.json");
const temp = await mkdtemp(join(tmpdir(), "artemis-automations-")),
  data = temp + "/data",
  projectPath = temp + "/project";
await Promise.all([mkdir(data), mkdir(projectPath)]);
await require("esbuild").build({
  entryPoints: [root + "/apps/desktop/src/main/settings/store.ts"],
  outfile: temp + "/store.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  logLevel: "silent",
});
const { AppStore } = await import(pathToFileURL(temp + "/store.mjs").href);
const store = new AppStore(data + "/artemis.sqlite"),
  now = new Date().toISOString();
store.upsertProject({
  id: "sample",
  name: "示例项目",
  path: projectPath,
  createdAt: now,
  updatedAt: now,
});
const selection = {
  providerId: "ui-check",
  modelId: "reasoner",
  thinkingLevel: "max",
};
for (const [index, name] of ["每日代码审查", "每周项目检查"].entries())
  store.createAutomation({
    id: "task-" + index,
    projectId: "sample",
    name,
    prompt: index
      ? "检查项目状态，整理下周需要关注的问题。"
      : "检查最近的代码变更，关注潜在问题，并整理一份简短的审查报告。",
    mode: "review",
    target: "local",
    schedule: {
      kind: "weekly",
      daysOfWeek: index ? [1] : [1, 2, 3, 4, 5, 6, 7],
      localTime: index ? "10:00" : "09:00",
      timeZone: "Asia/Shanghai",
    },
    modelSelection: { ...selection, thinkingLevel: index ? "medium" : "max" },
    enabled: false,
    authorizationState: "not-required",
    createdAt: now,
    updatedAt: now,
  });
store.close();
const requests = [];
const server = createServer(async (request, response) => {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw);
  requests.push({ model: body.model, reasoning_effort: body.reasoning_effort });
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const choice of [
    {
      delta: { role: "assistant", content: "本地验证完成。" },
      finish_reason: null,
    },
    { delta: {}, finish_reason: "stop" },
  ]) {
    response.write(
      "data: " +
        JSON.stringify({
          id: "local-check",
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: body.model,
          choices: [{ index: 0, ...choice }],
          usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 },
        }) +
        "\n\n",
    );
  }
  response.end("data: [DONE]\n\n");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const provider = {
  id: "ui-check",
  name: "本地界面验证",
  baseUrl: "http://127.0.0.1:" + server.address().port + "/v1",
  api: "openai-completions",
  models: [
    {
      id: "reasoner",
      name: "示例推理模型",
      reasoning: true,
      highestThinkingLevel: "max",
      input: ["text"],
      contextWindow: 128000,
      maxTokens: 4096,
    },
    {
      id: "fast",
      name: "示例快速模型",
      reasoning: false,
      input: ["text"],
      contextWindow: 128000,
      maxTokens: 4096,
    },
  ],
};
await writeFile(
  data + "/settings.json",
  JSON.stringify({
    version: 1,
    credentials: {},
    providers: { "ui-check": provider },
    model: selection,
    language: "zh-CN",
    theme: "dark",
    contextWindow: 128000,
  }),
);
const env = { ...process.env };
for (const key of Object.keys(env))
  if (
    key.startsWith("ARTEMIS_SMOKE_") ||
    ["ELECTRON_RUN_AS_NODE", "ARTEMIS_DEV_SERVER_URL"].includes(key)
  )
    delete env[key];
let app;
try {
  app = await _electron.launch({
    executablePath: require("electron"),
    args: [root + "/apps/desktop", "--user-data-dir=" + data, "--disable-gpu"],
    env,
  });
  const errors = [];
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator("[data-renderer-ready=true]").waitFor({ timeout: 30000 });
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setSize(1440, 900);
    win.center();
    win.show();
  });
  await page.locator('[data-nav-view="automations"]:visible').click();
  await page.locator(".automation-card").first().waitFor();
  await page.screenshot({ path: out + "/list-dark.png" });
  await page.getByRole("button", { name: "新建定时任务", exact: true }).click();
  const dialog = page.locator(".automation-dialog");
  await dialog.getByLabel("名称", { exact: true }).fill("每日代码审查");
  await dialog
    .getByLabel("任务内容", { exact: true })
    .fill("检查最近的代码变更，关注潜在问题，并整理一份简短的审查报告。");
  assert.match(
    await dialog.getByLabel("模型", { exact: true }).innerText(),
    /示例推理模型/,
  );
  await page.screenshot({ path: out + "/dialog-dark.png" });
  await dialog.locator(".automation-time-trigger").click();
  await page.locator(".automation-time-popover").waitFor();
  await page.screenshot({ path: out + "/time-menu-dark.png" });
  await page.keyboard.press("Escape");
  await dialog.getByLabel("模型", { exact: true }).click();
  await page.screenshot({ path: out + "/model-menu-dark.png" });
  await page.getByRole("option", { name: "示例快速模型", exact: true }).click();
  assert.equal(
    await dialog.getByLabel("推理强度", { exact: true }).isDisabled(),
    true,
  );
  await dialog.getByLabel("模型", { exact: true }).click();
  await page.getByRole("option", { name: "示例推理模型", exact: true }).click();
  await dialog.getByLabel("推理强度", { exact: true }).click();
  await page.getByRole("option", { name: "低", exact: true }).click();
  await dialog.getByLabel("执行时间", { exact: true }).click();
  await page.getByRole("option", { name: "一次", exact: true }).click();
  await dialog.locator("input[type=date]").fill("2099-10-01");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  const saved = await page.evaluate(async () =>
    (await window.artemis.listAutomations()).find(
      (task) => task.name === "每日代码审查" && task.schedule.kind === "once",
    ),
  );
  assert.equal(saved.modelSelection.thinkingLevel, "low");
  assert.equal(saved.modelSelection.modelId, "reasoner");
  assert.equal(
    (await page.evaluate(() => window.artemis.getSettings())).selection
      .thinkingLevel,
    "max",
  );
  await page
    .locator(".automation-card")
    .filter({ hasText: "2099" })
    .getByRole("button", { name: "编辑", exact: true })
    .click();
  assert.match(
    await dialog.getByLabel("推理强度", { exact: true }).innerText(),
    /低/,
  );
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setMinimumSize(480, 600);
    win.setSize(680, 820);
  });
  await page.screenshot({ path: out + "/dialog-narrow.png" });
  const footer = await dialog
    .locator(".automation-dialog-footer")
    .boundingBox();
  assert.ok(footer.y + footer.height <= 820);
  await dialog.getByLabel("推理强度", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: out + "/dialog-narrow-settings.png" });
  const overflow = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
    dialog: document
      .querySelector(".automation-dialog")
      .getBoundingClientRect()
      .toJSON(),
  }));
  assert.ok(overflow.scroll <= overflow.width);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.screenshot({ path: out + "/list-narrow.png" });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1440, 900),
  );
  await page.evaluate(() => window.artemis.setTheme("light"));
  await page.reload();
  await page.locator("[data-renderer-ready=true]").waitFor();
  await page.locator('[data-nav-view="automations"]:visible').click();
  await page.getByRole("button", { name: "新建定时任务", exact: true }).click();
  await page.screenshot({ path: out + "/dialog-light.png" });
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.evaluate(() => window.artemis.setTheme("dark"));
  await page.reload();
  await page.locator("[data-renderer-ready=true]").waitFor();
  await page.locator('[data-nav-view="automations"]:visible').click();
  await page
    .locator(".automation-card")
    .filter({ hasText: "2099" })
    .getByRole("button", { name: "立即运行", exact: true })
    .click();
  let run;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    run = (
      await page.evaluate(
        (id) => window.artemis.listAutomationRuns(id),
        saved.id,
      )
    )[0];
    if (run && ["completed", "failed"].includes(run.state)) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const snapshot = await page.evaluate(() => window.artemis.getSnapshot());
  const thread = snapshot.threads.find((thread) => thread.id === run.threadId);
  await writeFile(
    out + "/dispatch.json",
    JSON.stringify(
      { run, thread, requests, events: snapshot.events[run.threadId] },
      null,
      2,
    ),
  );
  assert.deepEqual(thread.modelSelection, saved.modelSelection);
  assert.equal(run.state, "completed", JSON.stringify(run));
  assert.equal(requests.at(-1).model, "reasoner");
  assert.equal(requests.at(-1).reasoning_effort, "low");
  assert.equal(
    (await page.evaluate(() => window.artemis.getSettings())).selection
      .thinkingLevel,
    "max",
  );
  for (const record of await page.evaluate(() =>
    window.artemis.listAutomations(),
  ))
    await page.evaluate((id) => window.artemis.deleteAutomation(id), record.id);
  await page.locator(".automation-empty").waitFor();
  await page.screenshot({ path: out + "/empty-dark.png" });
  await writeFile(
    out + "/report.json",
    JSON.stringify(
      {
        userData: data,
        saved,
        run,
        threadSelection: thread.modelSelection,
        requests,
        errors,
        overflow,
        screenshots: [
          "list-dark.png",
          "dialog-dark.png",
          "model-menu-dark.png",
          "dialog-narrow.png",
          "list-narrow.png",
          "dialog-light.png",
          "time-menu-dark.png",
          "dialog-narrow-settings.png",
          "empty-dark.png",
        ],
      },
      null,
      2,
    ),
  );
  assert.deepEqual(errors, []);
  console.log("Native automation checks passed; screenshots in " + out);
} finally {
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => {});
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

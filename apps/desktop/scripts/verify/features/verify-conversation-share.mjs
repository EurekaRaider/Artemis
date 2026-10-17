import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { SessionManager } from "@earendil-works/pi-coding-agent";

// Browser plugin not available: exercise the real Electron renderer with Playwright.
// All user data, CLI uploads and receipts are isolated synthetic fixtures.
const require = createRequire(import.meta.url);
const { _electron } = require("playwright-core");
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const root = resolve(desktop, "../..");
const output = resolve(
  process.argv[2] ??
    join(root, "artifacts/verification/pi-1.3.0/20261017/desktop"),
);
const temporary = await mkdtemp(join(tmpdir(), "artemis-share-qa-"));
const profile = join(temporary, "profile");
const bin = join(temporary, "bin");
let app;
try {
  await Promise.all([
    mkdir(output, { recursive: true }),
    mkdir(profile),
    mkdir(bin),
  ]);
  const storeModule = join(temporary, "store.mjs");
  await build({
    entryPoints: [join(desktop, "src/main/settings/store.ts")],
    outfile: storeModule,
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
  });
  const { AppStore } = await import(pathToFileURL(storeModule).href);
  const store = new AppStore(join(profile, "artemis.sqlite"));
  const now = new Date().toISOString();
  const sm = SessionManager.create(temporary, join(temporary, "sessions"));
  sm.appendMessage({
    role: "user",
    content: "请解释这次升级如何保持并发能力。",
    timestamp: 1,
  });
  sm.appendMessage({
    role: "assistant",
    content: [
      {
        type: "text",
        text: "已验证多会话并发、父子任务等待和取消后的替换执行。分享是经过预览的固定快照。",
      },
      { type: "thinking", thinking: "SYNTHETIC_PRIVATE_THINKING" },
    ],
    api: "openai-completions",
    provider: "synthetic",
    model: "synthetic",
    timestamp: 2,
    stopReason: "stop",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  });
  store.upsertProject({
    id: "share-project",
    name: "Pi 1.3 升级验收",
    path: temporary,
    createdAt: now,
    updatedAt: now,
  });
  store.createThread({
    id: "share-thread",
    projectId: "share-project",
    title: "分享功能验收",
    mode: "work",
    target: "local",
    status: "idle",
    pinned: false,
    archived: false,
    sessionFile: sm.getSessionFile(),
    createdAt: now,
    updatedAt: now,
  });
  store.close();
  await writeFile(
    join(profile, "settings.json"),
    JSON.stringify({
      version: 1,
      credentials: {},
      language: "zh-CN",
      theme: "light",
      expandedProjectIds: ["share-project"],
    }),
  );
  await mkdir(join(profile, "conversation-shares"));
  const radiusUrl = "https://radius.earendil.com/artifacts/synthetic-qa";
  await writeFile(
    join(profile, "conversation-shares/shares.json"),
    JSON.stringify([
      {
        id: "c6dd7620-6aae-48e4-b0fb-dcd32ac5fa65",
        threadId: "share-thread",
        title: "分享功能验收",
        createdAt: now,
        destination: "radius",
        remoteId: "synthetic-qa",
        url: radiusUrl,
      },
    ]),
  );
  const uploadPath = join(output, "synthetic-upload.html");
  const gh = join(bin, "gh");
  await writeFile(
    gh,
    `#!${process.execPath}\nconst fs = require('node:fs'); const args=process.argv.slice(2); if(args[0]==='gist'){fs.copyFileSync(args.at(-1),${JSON.stringify(uploadPath)});console.log('https://gist.github.com/synthetic/abc123');}`,
  );
  await chmod(gh, 0o700);
  const exported = join(output, "exported.html");
  const bootstrap = join(temporary, "bootstrap.mjs");
  await writeFile(
    bootstrap,
    `import {app,dialog,shell} from 'electron'; app.setPath('userData',${JSON.stringify(profile)}); app.setAppPath(${JSON.stringify(desktop)}); globalThis.shareQaOpened=[]; shell.openExternal=async(url)=>{globalThis.shareQaOpened.push(url)}; dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(exported)}}); await import(${JSON.stringify(pathToFileURL(join(desktop, "dist-electron/main.js")).href)});`,
  );
  app = await _electron.launch({
    executablePath: require("electron"),
    args: [bootstrap],
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    },
    timeout: 60_000,
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") console.error(message.text());
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByText("分享功能验收", { exact: true })
    .first()
    .waitFor({ timeout: 60_000 });
  await page
    .getByRole("button", { name: "更多任务操作", exact: true })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "分享会话", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "分享会话" });
  await dialog.getByRole("button", { name: "上传快照", exact: true }).waitFor();
  await dialog.locator("iframe").waitFor();
  const frame = page.frameLocator('iframe[title="分享预览"]');
  await frame
    .getByText("请解释这次升级如何保持并发能力。", { exact: true })
    .waitFor({ timeout: 60_000 });
  assert.equal(
    await frame.locator("body").evaluate(() => typeof window.artemis),
    "undefined",
  );
  assert.equal(
    await frame.locator("body").evaluate(() => typeof require),
    "undefined",
  );
  assert.equal(
    await frame
      .locator("body")
      .innerText()
      .then((text) => text.includes("SYNTHETIC_PRIVATE_THINKING")),
    false,
  );
  await dialog
    .getByRole("link", { name: "在 Radius 中管理", exact: true })
    .click();
  assert.deepEqual(await app.evaluate(() => globalThis.shareQaOpened), [
    radiusUrl,
  ]);
  await page.screenshot({ path: join(output, "share-light.png") });
  await dialog.screenshot({ path: join(output, "share-light-dialog.png") });
  await dialog.getByRole("button", { name: "导出 HTML", exact: true }).click();
  await dialog.getByText("已导出 HTML。", { exact: true }).waitFor();
  assert.match(await readFile(exported, "utf8"), /Content-Security-Policy/);
  await dialog.getByRole("button", { name: "上传快照", exact: true }).click();
  await dialog
    .getByRole("link", { name: "打开", exact: true })
    .waitFor({ timeout: 30_000 });
  assert.equal(
    await readFile(uploadPath, "utf8"),
    await readFile(exported, "utf8"),
  );
  await page.evaluate(() => window.artemis.setTheme("dark"));
  await page.locator('html[data-theme="dark"]').waitFor();
  const previewFrame = page
    .frames()
    .find((frame) => frame.url().startsWith("artemis-preview://share-"));
  await previewFrame.waitForFunction(
    () => getComputedStyle(document.body).backgroundColor === "rgb(36, 39, 45)",
  );
  const darkColors = await frame.locator("body").evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    text: getComputedStyle(element).color,
  }));
  assert.notEqual(darkColors.background, "rgb(0, 0, 0)");
  assert.notEqual(darkColors.background, darkColors.text);
  assert.equal(darkColors.background, "rgb(36, 39, 45)");
  await page.screenshot({ path: join(output, "share-dark.png") });
  await dialog.screenshot({ path: join(output, "share-dark-dialog.png") });
  await page.setViewportSize({ width: 760, height: 850 });
  await page.screenshot({ path: join(output, "share-narrow.png") });
  const overflow = await dialog.evaluate(
    (element) => element.scrollWidth > element.clientWidth + 1,
  );
  assert.equal(overflow, false);
  await dialog.getByRole("button", { name: "删除分享", exact: true }).click();
  await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
  await dialog
    .getByRole("link", { name: "打开", exact: true })
    .waitFor({ state: "detached" });
  assert.equal(errors.length, 0, errors.join("\n"));
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        passed: true,
        browser: "Browser plugin not available; Playwright Electron",
        data: "isolated synthetic profile and fake gh; no remote publication",
        url: page.url(),
        title: await page.title(),
        errors,
        checks: [
          "menu entry",
          "real SDK export worker",
          "offline preview content",
          "thinking excluded",
          "Radius manage opens in browser",
          "HTML export",
          "single synthetic Gist upload",
          "dark/light/narrow layout",
          "no horizontal overflow",
          "confirmed Gist deletion",
        ],
      },
      null,
      2,
    ),
  );
  console.log(output);
} finally {
  await app?.close();
  await rm(temporary, { recursive: true, force: true });
}

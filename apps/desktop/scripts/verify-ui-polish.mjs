import assert from "node:assert/strict";
const { _electron } = await import(
  process.env.ARTEMIS_PLAYWRIGHT_MODULE || "playwright"
);
import { createRequire } from "node:module";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const root = process.cwd(),
  phase = process.argv[2] || "after",
  out = root + "/artifacts/ui-polish-20260908/" + phase;
await mkdir(out, { recursive: true });
const temp = await mkdtemp("/tmp/artemis-polish-"),
  data = temp + "/data";
await mkdir(data);
const require = createRequire(root + "/package.json");
await require("esbuild").build({
  entryPoints: [root + "/apps/desktop/src/main/store.ts"],
  outfile: temp + "/store.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  logLevel: "silent",
});
const { AppStore } = await import(pathToFileURL(temp + "/store.mjs"));
const store = new AppStore(data + "/artemis.sqlite"),
  now = new Date().toISOString();
for (const id of ["design", "notes"]) {
  await mkdir(temp + "/" + id);
  store.upsertProject({
    id,
    name: id === "design" ? "Artemis" : "token-lab",
    path: temp + "/" + id,
    createdAt: now,
    updatedAt: now,
  });
}
store.createThread({
  id: "design-thread",
  projectId: "design",
  title: "UI 设计语言改版",
  mode: "plan",
  target: "local",
  status: "completed",
  pinned: false,
  archived: false,
  createdAt: now,
  updatedAt: now,
});
for (const [index, payload] of [
  {
    type: "user.message",
    messageId: "user-one",
    text: "这个 Markdown 文件讲了什么？",
  },
  {
    type: "task.source.added",
    sourceId: "file-one",
    name: "AGENTS.md",
    mimeType: "text/markdown",
    kind: "file",
  },
  {
    type: "task.source.added",
    sourceId: "image-one",
    name: "界面参考.png",
    mimeType: "image/png",
    kind: "image",
  },
  { type: "turn.started", mode: "plan" },
  { type: "turn.completed", reason: "completed", durationMs: 1000 },
].entries())
  store.appendEvent("fixture-" + index, "design-thread", "turn-one", payload);
store.close();
const env = { ...process.env };
for (const k of Object.keys(env))
  if (
    k.startsWith("ARTEMIS_SMOKE_") ||
    ["ELECTRON_RUN_AS_NODE", "ARTEMIS_DEV_SERVER_URL"].includes(k)
  )
    delete env[k];
const app = await _electron.launch({
  executablePath: require("electron"),
  args: [root + "/apps/desktop", "--user-data-dir=" + data, "--disable-gpu"],
  env,
});
const report = { phase, checks: [], screenshots: [] };
try {
  const page = await app.firstWindow();
  await page.locator("[data-renderer-ready=true]").waitFor();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1440, 900),
  );
  const status = {
    settings: {
      enabled: true,
      gatewayUrl: "https://gateway.example.test",
      deviceId: "demo-device",
      deviceName: "Demo Mac",
      defaultProjectId: "design",
      grants: [],
    },
    state: "connected",
    identities: [
      {
        channel: "slack",
        connectionId: "demo-slack",
        tenantId: "demo",
        appId: "bot",
        userId: "demo-user",
      },
    ],
    connections: [
      {
        id: "demo-slack",
        name: "Slack",
        channel: "slack",
        state: "connected",
        configuration: {
          id: "demo-slack",
          name: "Slack",
          tenantId: "demo",
          botId: "bot",
        },
      },
    ],
    remoteTasks: [
      { threadId: "design-thread", channel: "slack", kind: "direct" },
    ],
    pairingRequests: [],
    spaces: [],
  };
  await app.evaluate(({ ipcMain }, value) => {
    globalThis.polishStatus = value;
    for (const name of ["artemis:im-status", "artemis:im-manage"]) {
      ipcMain.removeHandler(name);
      ipcMain.handle(name, () => globalThis.polishStatus);
    }
    ipcMain.removeHandler("artemis:prompt-attachments-select");
    ipcMain.handle("artemis:prompt-attachments-select", () => [
      {
        type: "file",
        name: "AGENTS.md",
        mimeType: "text/markdown",
        content: "# Demo",
      },
    ]);
  }, status);
  await page
    .locator(".thread-select")
    .filter({ hasText: "UI 设计语言改版" })
    .click();
  const shot = async (name) => {
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await page.screenshot({
      path: out + "/" + name + ".png",
      animations: "disabled",
    });
    report.screenshots.push(name);
  };
  await page
    .locator(".composer")
    .getByRole("button", { name: /添加文件或图片|Add files or images/ })
    .click();
  await page.locator(".composer-attachment").waitFor();
  for (const theme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: theme });
    await page.locator(".composer textarea").fill("附件草稿 · 保留");
    await shot("workspace-" + theme);
  }
  if (phase === "after") {
    assert.equal(
      await page
        .locator(".message-attachments .user-message-attachment")
        .count(),
      2,
    );
    assert.equal(
      await page
        .locator(".composer-attachment")
        .evaluate((el) => Math.round(el.getBoundingClientRect().height)),
      24,
    );
    const inactive = page.locator(
      '[data-tree-row-id="project:notes"] > .project-row',
    );
    await page.mouse.move(1000, 300);
    assert.equal(
      await inactive
        .locator(".project-new-thread")
        .evaluate((el) => getComputedStyle(el).opacity),
      "0",
    );
    const active = page.locator(
      '[data-tree-row-id="project:design"] > .project-row',
    );
    assert.equal(
      await active
        .locator('.project-new-thread [data-artemis-icon="edit-square"]')
        .count(),
      1,
    );
    for (const theme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: theme });
      for (const [name, button] of [
        ["new", active.locator(".project-new-thread")],
        ["more", active.locator(".project-action")],
        [
          "plus",
          page.locator(
            ".project-collection > .project-row > .project-new-thread",
          ),
        ],
      ]) {
        await button.hover();
        const centers = await button.evaluate((el) => {
          const box = el.getBoundingClientRect();
          const icon = el.querySelector("svg").getBoundingClientRect();
          return {
            x: Math.abs(box.x + box.width / 2 - icon.x - icon.width / 2),
            y: Math.abs(box.y + box.height / 2 - icon.y - icon.height / 2),
          };
        });
        assert(
          centers.x <= 0.5 && centers.y <= 0.5,
          `${name} icon must be centered: ${JSON.stringify(centers)}`,
        );
        await shot(`sidebar-hover-${name}-${theme}`);
      }
    }
    report.checks.push(
      "new, plus and more icons centered within 0.5 CSS px in both themes",
    );
    await page.waitForFunction(() =>
      document
        .querySelector(".im-thread-connection")
        ?.getAttribute("title")
        ?.includes("状态未知"),
    );
    assert.equal(
      await page.locator(".im-thread-connection[data-state=connected]").count(),
      0,
    );
    report.checks.push(
      "persisted timeline attachments, compact draft, project actions, unknown connection status",
    );
  }
  await page
    .locator(".sidebar")
    .getByRole("button", { name: /^(设置|Settings)$/ })
    .click();
  for (const theme of ["dark", "light"]) {
    await page.emulateMedia({ colorScheme: theme });
    for (const tab of [
      "general",
      "providers",
      "im",
      "agents",
      "capabilities",
      "maintenance",
    ]) {
      await page.locator("#settings-tab-" + tab + "-button").click();
      await page.locator("#settings-tab-" + tab).waitFor({ state: "visible" });
      await shot("settings-" + tab + "-" + theme);
    }
  }
  await page.locator("#settings-tab-im-button").click();
  await page.locator("#im-nav-slack").waitFor({ state: "visible" });
  if (phase === "after") {
    await page.locator('.im-settings[data-compact="true"]').waitFor();
    assert.equal(
      await page.locator(".im-settings").getAttribute("data-compact"),
      "true",
    );
    assert(
      await page
        .getByRole("tab", { name: "群消息接入", exact: true })
        .isVisible(),
    );
    await page.getByRole("tab", { name: "群消息接入", exact: true }).click();
    await page.locator("#im-spaces").waitFor({ state: "visible" });
    assert.equal(await page.locator("#im-nav-spaces").count(), 1);
    const backgrounds = await page.evaluate(() => [
      getComputedStyle(document.querySelector("#im-nav-spaces"))
        .backgroundColor,
      getComputedStyle(document.querySelector("#im-nav-slack")).backgroundColor,
    ]);
    assert.notEqual(
      backgrounds[0],
      backgrounds[1],
      "selected group tab must be distinguishable",
    );
    await shot("im-group-entry");
    await page.locator("#im-nav-slack").click();
    report.checks.push(
      "group messages directly visible and opens existing group setup in compact settings",
    );
    const heading = await page.locator(".im-header").boundingBox();
    const viewport = await page
      .locator(
        '[data-artemis-component="settings-surface"] > [data-part="body"] > [data-part="content"]',
      )
      .boundingBox();
    assert(heading.y >= viewport.y, "IM header must remain visible on entry");
    assert.equal(
      await page
        .locator(".settings-panel")
        .evaluate((el) => Math.round(el.getBoundingClientRect().width)),
      860,
    );
    await app.evaluate(() => {
      globalThis.polishStatus = {
        ...globalThis.polishStatus,
        connections: globalThis.polishStatus.connections.map((c) => ({
          ...c,
          state: "error",
          error: "Disconnected fixture",
        })),
      };
    });
    await page.waitForFunction(
      () =>
        document
          .querySelector("#im-nav-slack .im-dot")
          ?.getAttribute("data-state") === "error",
    );
    await shot("im-disconnected");
    await app.evaluate(() => {
      globalThis.polishStatus = {
        ...globalThis.polishStatus,
        connections: globalThis.polishStatus.connections.map((c) => ({
          ...c,
          state: "connected",
          error: undefined,
        })),
      };
    });
    await page.waitForFunction(
      () =>
        document
          .querySelector("#im-nav-slack .im-dot")
          ?.getAttribute("data-state") === "connected",
    );
    report.checks.push(
      "live IM disconnect and reconnect, 860px settings, compact IM navigation",
    );
  }
  for (const view of [
    "wecom",
    "feishu",
    "slack",
    "gateway",
    "pairing",
    "permissions",
    "spaces",
    "setup-guide",
  ]) {
    const direct = page.locator("#im-nav-" + view);
    if (await direct.isVisible()) await direct.click();
    else {
      await page.locator(".im-common-trigger").click();
      await page
        .getByRole("menuitem")
        .filter({
          hasText: {
            gateway: "Gateway",
            pairing: "配对",
            permissions: "项目授权",
            spaces: "群协作",
            "setup-guide": "设置指引",
          }[view],
        })
        .click();
    }
    if (phase === "after") {
      const viewport = page.locator(
        '[data-artemis-component="settings-surface"] > [data-part="body"] > [data-part="content"]',
      );
      assert(
        await viewport.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        "IM horizontal overflow: " + view,
      );
    }
    await shot("im-" + view);
  }
  if (phase === "after") {
    await page.locator(".im-guide-link").click();
    const entry = page.getByRole("button", { name: /群消息接入/ });
    await entry.scrollIntoViewIfNeeded();
    await shot("im-wizard-group-entry");
    await entry.click();
    await page.locator("#im-spaces").waitFor({ state: "visible" });
    report.checks.push("wizard group entry opens existing collaboration setup");
  }
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(780, 720),
  );
  await shot("settings-narrow");
  report.checks.push("six settings pages, eight IM inner pages, narrow window");
  console.log(JSON.stringify(report));
  await writeFile(out + "/report.json", JSON.stringify(report, null, 2));
} finally {
  await app.close();
}

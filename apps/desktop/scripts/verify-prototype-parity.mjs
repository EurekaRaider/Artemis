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
assert.equal(
  execFileSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  "",
  "Prototype parity requires a clean candidate",
);
const manifest = JSON.parse(
  await readFile(
    join(root, "docs/discussion-151/prototype-manifest.json"),
    "utf8",
  ),
);
for (const entry of manifest.files) {
  const bytes = await readFile(join(root, "docs", entry.path));
  assert.equal(bytes.length, entry.bytes, entry.path);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    entry.sha256,
    entry.path,
  );
}
const chromeInset = process.platform === "darwin" ? 28 : 0;
const out = process.argv[2] || join(root, "artifacts/prototype-parity");
const temp = await mkdtemp(join(tmpdir(), "artemis-151-parity-"));
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
  await product.getByRole("button", { name: "暂不", exact: true }).click();
  if (
    (await product
      .locator(".right-sidebar-toggle")
      .getAttribute("aria-expanded")) === "true"
  )
    await product.locator(".right-sidebar-toggle").click();
  const newWindow = app.waitForEvent("window");
  await app.evaluate(async ({ BrowserWindow }, path) => {
    globalThis.__referenceWindow = new BrowserWindow({
      width: 1440,
      height: 900,
      useContentSize: true,
      show: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    await globalThis.__referenceWindow.loadFile(path, { hash: "dock=closed" });
  }, root + "/docs/ui-prototype/apple-inspired-ui.html");
  const reference = await newWindow;
  reference.on("pageerror", (e) =>
    errors.push({ surface: "reference", message: e.message }),
  );
  await reference.waitForSelector(".composer");
  const pairs = {
    goalInput: ["#goalInput", ".goal-editor-input"],
    shell: [".app-shell", ".app-shell"],
    activity: [".activity-bar", ".activity-bar"],
    brand: [".activity-mark", ".artemis-mark"],
    activityButton: [".activity-button", ".activity-button"],
    sidebar: [".sidebar", ".sidebar"],
    sidebarHeader: [".sidebar-header", ".sidebar-header"],
    search: [".sidebar-search", ".sidebar-search"],
    searchInput: [".sidebar-search input", ".sidebar-search input"],
    tree: [".project-tree", ".project-tree"],
    group: [".group-row", ".project-group-row"],
    project: [".project-head", ".nested-project > .project-row"],
    thread: [".thread-wrap", ".project-thread-row"],
    footer: [".sidebar-footer", ".sidebar-footer"],
    header: [".workspace-header", ".workspace-header"],
    heading: [".workspace-heading", ".workspace-heading"],
    conversation: [
      ".conversation",
      '[data-artemis-component="conversation-surface"]',
    ],
    timeline: [".timeline", ".timeline"],
    composerWrap: [".composer-wrap", ".composer-wrap"],
    composer: [".composer", ".composer"],
    context: [
      ".composer-topbar",
      '[data-artemis-component="composer-surface"] > [data-part="context"]',
    ],
    contextButton: [".composer-topbar button", ".composer-context-trigger"],
    input: [".composer-input", ".composer-input"],
    textarea: [".composer textarea", ".composer textarea"],
    toolbar: [".composer-toolbar", ".composer-toolbar"],
    dock: [".workspace-dock", '[data-artemis-component="workspace-dock"]'],
    tabBar: [
      ".workspace-tab-bar",
      '[data-artemis-component="workspace-tab-bar"]',
    ],
    tab: [".dock-tab", '[data-artemis-component="workspace-tab"]'],
  };
  const props = [
    "fontSize",
    "fontWeight",
    "lineHeight",
    "backgroundColor",
    "color",
    "borderTopWidth",
    "borderTopColor",
    "borderRadius",
    "boxShadow",
    "padding",
    "margin",
    "gap",
    "minHeight",
    "gridTemplateColumns",
  ];
  async function measure(page, index) {
    return page.evaluate(
      ({ pairs, index, props }) =>
        Object.fromEntries(
          Object.entries(pairs).map(([name, sel]) => {
            const el = document.querySelector(sel[index]);
            if (!el) return [name, null];
            const s = getComputedStyle(el),
              r = el.getBoundingClientRect();
            return [
              name,
              {
                rect: { x: r.x, y: r.y, width: r.width, height: r.height },
                style: Object.fromEntries(props.map((k) => [k, s[k]])),
                text: el.textContent.slice(0, 180),
              },
            ];
          }),
        ),
      { pairs, index, props },
    );
  }
  const checks = [];
  const result = {
    candidateHead,
    platform: process.platform,
    architecture: process.arch,
    prototypeFiles: manifest.files.length,
    checks,
    engine: await product.evaluate(() => navigator.userAgent),
    data,
    temp,
    conditions:
      "Electron with isolated user data. Native titlebar retained above product content; reference uses equal content area. Both use the same Electron and CSS-pixel screenshots. Fixture data is isolated and no external account is used.",
    sizes: {},
    errors,
  };
  for (const [w, h] of [
    [1440, 900],
    [1280, 900],
    [1024, 900],
    [980, 900],
    [980, 680],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, { w, h, chromeInset }) => {
        globalThis.__productWindow.setContentSize(w, h + chromeInset);
        globalThis.__referenceWindow.setContentSize(w, h);
      },
      { w, h, chromeInset },
    );
    await reference.reload();
    while (await reference.locator(".attachments .x").count())
      await reference.locator(".attachments .x").first().click();
    await product.waitForTimeout(400);
    await reference.waitForTimeout(100);
    result.sizes[`${w}x${h}`] = {
      reference: await measure(reference, 0),
      product: await measure(product, 1),
    };
    await writeFile(join(out, "metrics.json"), JSON.stringify(result, null, 2));
    const comparison = result.sizes[`${w}x${h}`];
    for (const part of [
      "activity",
      "sidebar",
      "header",
      "conversation",
      "composer",
      "context",
      "textarea",
      "toolbar",
    ]) {
      for (const dimension of ["x", "y", "width", "height"]) {
        const expected = comparison.reference[part].rect[dimension],
          actual =
            comparison.product[part].rect[dimension] -
            (dimension === "y" ? chromeInset : 0);
        assert.ok(
          Math.abs(expected - actual) <= 0.5,
          `${w}x${h} ${part}.${dimension}: ${actual} != ${expected}`,
        );
      }
    }
    for (const part of ["activity", "sidebar", "conversation", "composer"]) {
      assert.equal(
        comparison.product[part].style.backgroundColor,
        comparison.reference[part].style.backgroundColor,
        `${part} background`,
      );
    }
    checks.push(`prototype geometry and backgrounds ${w}x${h}`);
    await reference.screenshot({
      path: join(out, `reference-${w}x${h}.png`),
      scale: "css",
    });
    await product.screenshot({
      path: join(out, `product-${w}x${h}.png`),
      clip: { x: 0, y: chromeInset, width: w, height: h },
      scale: "css",
    });
  }
  await app.evaluate(({ BrowserWindow }, chromeInset) => {
    globalThis.__productWindow.setContentSize(1440, 900 + chromeInset);
    globalThis.__referenceWindow.setContentSize(1440, 900);
  }, chromeInset);
  async function chooseTheme(theme) {
    await product
      .locator(".activity-bar")
      .getByRole("button", { name: "设置", exact: true })
      .click();
    await product.locator("#settings-tab-general-button").click();
    await product.getByRole("button", { name: /^界面主题/ }).click();
    await product
      .getByRole("option", {
        name: theme === "dark" ? "深色" : "浅色",
        exact: true,
      })
      .click();
    await product.waitForFunction(
      (theme) => document.documentElement.dataset.artemisTheme === theme,
      theme,
    );
    await product.locator(".settings-header").getByRole("button").click();
  }
  const productMedia = await product.context().newCDPSession(product);
  result.appearances = {};
  for (const theme of ["light", "dark"]) {
    for (const contrast of ["normal", "high"]) {
      await chooseTheme(theme);
      await productMedia.send("Emulation.setEmulatedMedia", {
        features: [
          {
            name: "prefers-contrast",
            value: contrast === "high" ? "more" : "no-preference",
          },
        ],
      });
      await product.waitForFunction(
        ({ theme, contrast }) =>
          document.documentElement.dataset.artemisTheme === theme &&
          document.documentElement.dataset.artemisContrast === contrast,
        { theme, contrast },
      );
      await reference.goto(
        "file://" +
          root +
          "/docs/ui-prototype/apple-inspired-ui.html#dock=closed&theme=" +
          theme,
      );
      await reference.reload();
      await reference.locator("html").evaluate((element, contrast) => {
        element.dataset.contrast = contrast;
      }, contrast);
      while (await reference.locator(".attachments .x").count())
        await reference.locator(".attachments .x").first().click();
      await product.waitForTimeout(300);
      const pair = {
        reference: await measure(reference, 0),
        product: await measure(product, 1),
      };
      result.appearances[`${theme}-${contrast}`] = pair;
      for (const part of ["activity", "sidebar", "conversation", "composer"]) {
        assert.equal(
          pair.product[part].style.backgroundColor,
          pair.reference[part].style.backgroundColor,
          `${theme}/${contrast} ${part} background`,
        );
      }
      await reference.screenshot({
        path: join(out, `reference-${theme}-${contrast}.png`),
        scale: "css",
      });
      await product.screenshot({
        path: join(out, `product-${theme}-${contrast}.png`),
        clip: { x: 0, y: chromeInset, width: 1440, height: 900 },
        scale: "css",
      });
      checks.push(`Appearance ${theme}/${contrast}`);
    }
  }
  await chooseTheme("light");
  await productMedia.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-contrast", value: "no-preference" }],
  });
  await product.waitForFunction(
    () => document.documentElement.dataset.artemisContrast === "normal",
  );
  await product.locator(".right-sidebar-toggle").click();
  await product.locator(".workspace-tab-add").click();
  await product
    .locator(".workspace-tab-menu")
    .getByRole("button", { name: "文件", exact: true })
    .click();
  await product
    .locator('[data-artemis-component="workspace-file-layout"]')
    .waitFor();
  await product
    .locator('[data-artemis-component="workspace-file-tree-row"]:visible')
    .filter({ hasText: "README.md" })
    .click();
  await reference.goto(
    "file://" + root + "/docs/ui-prototype/apple-inspired-ui.html#tab=files",
  );
  await reference.reload();
  await product.waitForTimeout(500);
  await reference.waitForTimeout(300);
  result.files = {
    reference: await measure(reference, 0),
    product: await measure(product, 1),
  };
  await product.screenshot({
    path: join(out, "product-files.png"),
    clip: { x: 0, y: chromeInset, width: 1440, height: 900 },
    scale: "css",
  });
  await reference.screenshot({
    path: join(out, "reference-files.png"),
    scale: "css",
  });
  async function captureDock(name) {
    await reference.goto(
      "file://" +
        root +
        "/docs/ui-prototype/apple-inspired-ui.html#tab=" +
        name,
    );
    await reference.reload();
    await product.waitForTimeout(500);
    await reference.waitForTimeout(150);
    await product.screenshot({
      path: join(out, "product-dock-" + name + ".png"),
      clip: { x: 0, y: chromeInset, width: 1440, height: 900 },
      scale: "css",
    });
    await reference.screenshot({
      path: join(out, "reference-dock-" + name + ".png"),
      scale: "css",
    });
    assert.equal(
      await product.getByRole("tabpanel").count(),
      1,
      `${name}: unique visible Dock panel`,
    );
    checks.push(`Dock ${name}`);
    result.docks ??= {};
    result.docks[name] = {
      reference: await measure(reference, 0),
      product: await measure(product, 1),
    };
    for (const part of ["dock", "tabBar"]) {
      for (const dimension of ["x", "y", "width", "height"]) {
        const pair = result.docks[name];
        const actual =
          pair.product[part].rect[dimension] -
          (dimension === "y" ? chromeInset : 0);
        assert.ok(
          Math.abs(pair.reference[part].rect[dimension] - actual) <= 0.5,
          `${name} ${part}.${dimension}`,
        );
      }
    }
  }
  await captureDock("files");
  for (const [name, label] of [
    ["review", "审查"],
    ["terminal", "终端"],
    ["browser", "浏览器"],
  ]) {
    await product.locator(".workspace-tab-add").click();
    await product
      .locator(".workspace-tab-menu")
      .getByRole("button", { name: label, exact: true })
      .click();
    await captureDock(name);
  }
  await product
    .locator(".workspace-heading")
    .getByRole("button", { name: /目标/ })
    .click();
  await captureDock("goal");
  // Exercise the actual goal editor; fixture is paused to avoid starting an agent run.
  const input = product.locator(".goal-editor-input");
  const original = await input.inputValue();
  await input.fill(original + "\n校验草稿");
  await product
    .locator(".goal-editor-footer")
    .getByRole("button", { name: "还原", exact: true })
    .click();
  if ((await input.inputValue()) !== original)
    throw Error("Goal revert failed");
  await input.fill(original + "\n已验证保存");
  await product
    .locator(".goal-editor-footer")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await product.locator(".goal-editor-saved").waitFor();
  checks.push("Goal save and revert");
  for (const [name, selector] of [
    ["sources", ".environment-view-all"],
    ["team", '.environment-activity-row:has-text("UI 实现团队")'],
    ["agent", '.environment-activity-row:has-text("布局检查")'],
  ]) {
    await product.locator(".environment-trigger").click();
    await product.locator(selector).click();
    await captureDock(name);
  }
  await product.locator(".workspace-tab-add").click();
  await product
    .locator(".workspace-tab-menu")
    .getByRole("button", { name: "文件", exact: true })
    .click();
  await product
    .locator('[data-artemis-component="workspace-file-tree-row"]:visible')
    .filter({ hasText: "README.md" })
    .click();
  await product
    .locator(".workspace-files-panel > .workspace-panel-toolbar")
    .getByRole("button", { name: /阅读/ })
    .click();
  await captureDock("markdown");
  await product
    .locator(".activity-bar")
    .getByRole("button", { name: "设置", exact: true })
    .click();
  await reference.locator("#settingsBtn").click();
  const settingsPairs = {
    panel: [".settings-panel", ".settings-panel"],
    surface: [".settings-panel", '[data-artemis-component="settings-surface"]'],
    header: [".settings-header", ".settings-header"],
    body: [
      ".settings-body",
      '[data-artemis-component="settings-surface"] > [data-part="body"]',
    ],
    navigation: [
      ".settings-tabs",
      '[data-artemis-component="settings-surface"] [data-part="navigation"]',
    ],
    tab: [
      ".settings-tab",
      '[data-artemis-component="settings-surface"] [data-part="navigation"] [data-part="tab"]',
    ],
    content: [
      ".settings-content",
      '[data-artemis-component="settings-surface"] > [data-part="body"] > [data-part="content"]',
    ],
  };
  Object.assign(pairs, settingsPairs);
  result.settings = {};
  for (const [index, name] of [
    "general",
    "providers",
    "im",
    "agents",
    "capabilities",
    "maintenance",
  ].entries()) {
    await product.locator("#settings-tab-" + name + "-button").click();
    await reference
      .locator(".settings-tab[data-settings-panel=" + name + "]")
      .click();
    await product.waitForTimeout(300);
    await reference.waitForTimeout(200);
    result.settings[name] = {
      reference: await measure(reference, 0),
      product: await measure(product, 1),
    };
    for (const part of ["panel", "header", "body", "navigation"]) {
      for (const dimension of ["x", "y", "width", "height"]) {
        const pair = result.settings[name],
          actual =
            pair.product[part].rect[dimension] -
            (dimension === "y" ? chromeInset : 0);
        assert.ok(
          Math.abs(pair.reference[part].rect[dimension] - actual) <= 0.5,
          `Settings ${name} ${part}.${dimension}`,
        );
      }
    }
    checks.push(`Settings ${name}`);
    await product.screenshot({
      path: join(out, "product-settings-" + name + ".png"),
      clip: { x: 0, y: chromeInset, width: 1440, height: 900 },
      scale: "css",
    });
    await reference.screenshot({
      path: join(out, "reference-settings-" + name + ".png"),
      scale: "css",
    });
  }

  await product.locator(".settings-header").getByRole("button").click();
  await reference.locator("#settingsClose").click();
  await product.locator(".right-sidebar-toggle").click();
  await reference.goto(
    "file://" + root + "/docs/ui-prototype/apple-inspired-ui.html#dock=closed",
  );
  await reference.reload();
  await product.locator(".environment-trigger").click();
  await reference.locator("#envTrigger").click();
  await product.waitForTimeout(300);
  await reference.waitForTimeout(300);
  await product.screenshot({
    path: join(out, "product-environment.png"),
    clip: { x: 0, y: chromeInset, width: 1440, height: 900 },
    scale: "css",
  });
  await reference.screenshot({
    path: join(out, "reference-environment.png"),
    scale: "css",
  });
  await product.keyboard.press("Escape");
  await reference.keyboard.press("Escape");
  for (const [index, name] of [
    "resources",
    "token-usage",
    "automations",
    "archive",
  ].entries()) {
    await product
      .locator(".activity-button")
      .nth(index + 1)
      .click();
    await reference.locator(".activity-button[data-goto=" + name + "]").click();
    await product.waitForTimeout(500);
    await reference.waitForTimeout(200);
    await product.screenshot({
      path: join(out, "product-" + name + ".png"),
      clip: { x: 0, y: chromeInset, width: 1440, height: 900 },
      scale: "css",
    });
    await reference.screenshot({
      path: join(out, "reference-" + name + ".png"),
      scale: "css",
    });
  }
  assert.deepEqual(
    errors,
    [],
    "Renderer and prototype must have no JavaScript errors",
  );
  assert.equal(
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
    candidateHead,
  );
  await writeFile(join(out, "metrics.json"), JSON.stringify(result, null, 2));
  console.log(
    "PASS native prototype parity: " + checks.length + " checks; " + out,
  );
} catch (e) {
  await product.screenshot({ path: join(out, "failure.png") }).catch(() => {});
  throw e;
} finally {
  await app.close();
}

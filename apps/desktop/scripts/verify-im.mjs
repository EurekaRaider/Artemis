import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ArtemisGateway } from "../../../packages/gateway/dist/index.js";

// Production Electron/preload/Pi with a loopback model and synthetic channel. No personal account or model key is used.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const electron = createRequire(import.meta.url)("electron");
const temporary = await mkdtemp(join(tmpdir(), "artemis-im-electron-"));
const data = join(temporary, "user-data");
const project = join(temporary, "project");
const output = resolve(process.argv[2] ?? join(root, "artifacts", "im"));
await mkdir(data);
await mkdir(project);
await mkdir(output, { recursive: true });
for (const file of [
  "result.json",
  "failure.log",
  "model-calls.json",
  "light.png",
  "dark.png",
  "after-delete.png",
  "slack.png",
])
  await rm(join(output, file), { force: true });
await writeFile(
  join(project, "README.md"),
  "IM_SMOKE_PROJECT: a project for verifying remote Artemis tasks.",
);
const db = new DatabaseSync(join(data, "artemis.sqlite"));
db.exec(
  "CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,path TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,hidden INTEGER NOT NULL DEFAULT 0)",
);
db.prepare("INSERT INTO projects VALUES(?,?,?,?,?,0)").run(
  "im-project",
  "IM verification project",
  project,
  new Date().toISOString(),
  new Date().toISOString(),
);
db.close();
const sent = [];
let receive;
const gateway = new ArtemisGateway({
  databasePath: join(temporary, "gateway.sqlite"),
  encryptionKey: "test-encryption-key-".repeat(3),
  adminToken: "test-administrator-".repeat(3),
  adapterFactory: (config, callback) => {
    receive = callback;
    return {
      start() {},
      stop() {},
      status: () => ({
        id: config.id,
        name: config.name,
        channel: config.channel,
        state: "connected",
      }),
      send: async (conversation, text) => {
        sent.push({ conversation, text });
        return `message-${sent.length}`;
      },
      attachment: async () => {
        throw new Error("No attachments in this UI case.");
      },
    };
  },
});
const gatewayUrl = `http://127.0.0.1:${await gateway.listen(0)}`;
await fetch(`${gatewayUrl}/v1/admin/connections`, {
  method: "PUT",
  headers: { Authorization: `Bearer ${"test-administrator-".repeat(3)}` },
  body: JSON.stringify({
    channel: "wecom",
    id: "wecom",
    name: "Test WeCom bot",
    tenantId: "test-tenant",
    botId: "test-bot",
    secret: "test-secret",
    enabled: true,
  }),
});
const modelCalls = [];
const model = createServer(async (request, response) => {
  try {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    modelCalls.push(body);
    const toolResult = body.messages?.findLast(
      (message) => message.role === "tool",
    );
    const completion = toolResult
      ? "IM_SMOKE_OK: project inspected through the remote file tool."
      : undefined;
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    });
    const event = (delta, finish_reason = null) =>
      response.write(
        `data: ${JSON.stringify({ id: "smoke-response", object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: "im-model", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
      );
    if (completion) event({ role: "assistant", content: completion });
    else
      event({
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: "read-smoke-file",
            type: "function",
            function: {
              name: "remote_read",
              arguments: JSON.stringify({ path: "README.md" }),
            },
          },
        ],
      });
    event({}, completion ? "stop" : "tool_calls");
    response.end("data: [DONE]\n\n");
  } catch (error) {
    response.writeHead(500);
    response.end(String(error));
  }
});
await new Promise((resolve) => model.listen(0, "127.0.0.1", resolve));
const modelUrl = `http://127.0.0.1:${model.address().port}/v1`;
const reserve = createServer();
await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
const port = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
const env = { ...process.env };
for (const key of [
  "ELECTRON_RUN_AS_NODE",
  "ARTEMIS_DEV_SERVER_URL",
  "ARTEMIS_SMOKE_SCREENSHOT",
  "ARTEMIS_SMOKE_VIEW",
])
  delete env[key];
const child = spawn(
  electron,
  [
    join(root, "apps/desktop"),
    `--user-data-dir=${data}`,
    "--disable-gpu",
    "--inspect=127.0.0.1:0",
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
  ],
  { cwd: join(root, "apps/desktop"), env, stdio: ["ignore", "pipe", "pipe"] },
);
let logs = "",
  socket;
child.stdout.on("data", (chunk) => (logs += chunk));
child.stderr.on("data", (chunk) => (logs += chunk));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (check, description, timeout = 30000) => {
  const start = Date.now();
  do {
    const value = await check();
    if (value) return value;
    await pause(200);
  } while (Date.now() - start < timeout);
  throw new Error(`Timed out: ${description}`);
};
let mainSocket;
try {
  const inspectorUrl = await until(
    () =>
      /Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/u.exec(logs)?.[1],
    "isolated Electron main inspector",
  );
  mainSocket = new WebSocket(inspectorUrl);
  await new Promise((resolve, reject) => {
    mainSocket.addEventListener("open", resolve, { once: true });
    mainSocket.addEventListener("error", reject, { once: true });
  });
  let mainSequence = 0;
  const mainEvaluate = (expression) =>
    new Promise((resolve, reject) => {
      const id = ++mainSequence;
      const timer = setTimeout(() => {
        mainSocket.removeEventListener("message", listener);
        reject(new Error("Main inspector timed out"));
      }, 10000);
      const listener = (event) => {
        const data = JSON.parse(event.data);
        if (data.id !== id) return;
        clearTimeout(timer);
        mainSocket.removeEventListener("message", listener);
        if (data.error || data.result.exceptionDetails)
          reject(
            new Error(
              JSON.stringify(data.error ?? data.result.exceptionDetails),
            ),
          );
        else resolve(data.result.result?.value);
      };
      mainSocket.addEventListener("message", listener);
      mainSocket.send(
        JSON.stringify({
          id,
          method: "Runtime.evaluate",
          params: { expression, returnByValue: true },
        }),
      );
    });
  const nativeContents = `process.getBuiltinModule('module').createRequire(${JSON.stringify(join(root, "apps/desktop/package.json"))})('electron').BrowserWindow.getAllWindows().find(w => !w.isDestroyed()).webContents`;
  const runtime = await mainEvaluate(
    "({electron:process.versions.electron,chrome:process.versions.chrome,platform:process.platform,arch:process.arch})",
  );
  const target = await until(async () => {
    try {
      return (
        await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      ).find((t) => t.type === "page" && t.url.includes("index.html"));
    } catch {
      return undefined;
    }
  }, "Electron renderer");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map(),
    exceptions = [],
    consoleIssues = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (
      message.method === "Runtime.consoleAPICalled" &&
      ["error", "warning"].includes(message.params.type)
    )
      consoleIssues.push({
        type: message.params.type,
        text: message.params.args
          .map((value) => value.value ?? value.description ?? "")
          .join(" "),
      });
    if (message.method === "Runtime.exceptionThrown")
      exceptions.push(message.params.exceptionDetails);
    const entry = pending.get(message.id);
    if (entry) {
      pending.delete(message.id);
      clearTimeout(entry.timer);
      message.error
        ? entry.reject(new Error(message.error.message))
        : entry.resolve(message.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 15000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text,
      );
    return result.result?.value;
  };
  const click = async (expression) => {
    const rect = await evaluate(
      `(()=>{const e=${expression};if(!e)throw new Error('Missing control');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
    );
    await send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      button: "left",
      clickCount: 1,
      ...rect,
    });
    await send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      button: "left",
      clickCount: 1,
      ...rect,
    });
    await pause(150);
  };
  const button = (text) =>
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
  const openView = async (view) => {
    if (
      !(await evaluate(`Boolean(document.querySelector('#im-nav-${view}'))`))
    ) {
      await click("document.querySelector('.im-common-trigger')");
      const labels = {
        gateway: "Gateway 与设备",
        pairing: "配对与账号",
        permissions: "项目授权",
        spaces: "群协作空间",
      };
      await click(button(labels[view]));
    } else await click(`document.querySelector('#im-nav-${view}')`);
  };
  const fill = async (selector, text) => {
    await click(`document.querySelector(${JSON.stringify(selector)})`);
    await send("Input.insertText", { text });
  };
  await send("Runtime.enable");
  await send("Page.enable");
  await until(
    () =>
      evaluate("Boolean(window.artemis && document.querySelector('button'))"),
    "desktop ready",
  );
  assert.match(await evaluate("document.title"), /Artemis/u);
  await evaluate('window.artemis.setLanguage("zh-CN")');
  await send("Page.reload");
  await until(
    () =>
      evaluate("Boolean(window.artemis && document.querySelector('button'))"),
    "locale reload",
  );
  await click(
    "Array.from(document.querySelectorAll('button')).find(b=>['Settings','设置'].includes(b.getAttribute('aria-label')))",
  );
  await until(
    () =>
      evaluate("Boolean(document.querySelector('#settings-tab-im-button'))"),
    "settings tabs",
  );
  await click("document.querySelector('#settings-tab-im-button')");
  await until(
    () => evaluate("Boolean(document.querySelector('.im-setup-steps'))"),
    "IM guide",
  );
  assert.equal(
    await evaluate("document.querySelectorAll('.im-setup-steps li').length"),
    6,
  );
  const wizardCapture = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(
    join(output, "wizard.png"),
    Buffer.from(wizardCapture.data, "base64"),
  );
  await click(button("1. 准备 Gateway"));
  await openView("spaces");
  await click("document.querySelector('#im-spaces summary')");
  assert.equal(
    await evaluate(
      "Array.from(document.querySelectorAll('label')).some(label=>label.textContent.includes('协作空间管理凭据'))",
    ),
    true,
  );
  assert.equal(
    await evaluate(
      "document.body.textContent.includes('groups 给出实际群 ID')",
    ),
    true,
  );
  await openView("gateway");
  const initial = await evaluate("window.artemis.getImStatus()");
  assert.equal(initial.settings.enabled, false);
  assert.equal(initial.settings.grants.length, 0);
  assert.equal(
    await evaluate("document.body.textContent.includes('npm ci')"),
    false,
  );
  await click(button("一键启动并注册"));
  const localStatus = await until(async () => {
    const status = await evaluate("window.artemis.getImStatus()");
    return status.localGateway?.state === "running" && status.settings.deviceId
      ? status
      : undefined;
  }, "built-in Gateway and automatic device registration");
  assert.equal(localStatus.settings.enabled, false);
  assert.deepEqual(localStatus.settings.grants, []);
  assert.ok(
    !(await evaluate("document.querySelector('#im-bot').textContent")).includes(
      "机器人配置的管理凭据",
    ),
  );
  await openView("slack");
  await click("document.querySelector('#im-bot details:last-child summary')");
  await evaluate(
    "window.__copiedImCommand=''; navigator.clipboard.writeText=async text=>{window.__copiedImCommand=text;}",
  );
  await click(button("复制 Slack 应用配置"));
  const manifest = JSON.parse(await evaluate("window.__copiedImCommand"));
  assert.equal(manifest.settings.socket_mode_enabled, true);
  assert.deepEqual(manifest.settings.event_subscriptions.bot_events, [
    "message.im",
    "app_mention",
  ]);
  assert.equal(
    await evaluate(
      "document.querySelectorAll('#im-bot input[type=password]').length",
    ),
    2,
  );
  assert.ok(
    !(await evaluate("document.querySelector('#im-bot').textContent")).includes(
      "事件回调地址：",
    ),
  );
  await openView("pairing");
  await click(button("生成一次性配对码"));
  await click(button("复制配对指令"));
  assert.match(
    await evaluate("window.__copiedImCommand"),
    /^pair [a-f0-9]{16}$/u,
  );
  await click(
    "document.querySelector('#im-test').closest('details').querySelector('summary')",
  );
  await click("document.querySelector('#im-test button')");
  assert.equal(await evaluate("window.__copiedImCommand"), "projects");
  await openView("slack");
  const slackScreenshot = await send("Page.captureScreenshot", {
    format: "png",
  });
  await writeFile(
    join(output, "slack.png"),
    Buffer.from(slackScreenshot.data, "base64"),
  );
  await openView("wecom");
  const records = [];
  for (const variant of [
    { theme: "light", width: 1280, height: 900 },
    { theme: "dark", width: 980, height: 760 },
  ]) {
    await evaluate(`window.artemis.setTheme(${JSON.stringify(variant.theme)})`);
    await send("Emulation.setDeviceMetricsOverride", {
      width: variant.width,
      height: variant.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await evaluate(
      "document.querySelector('.im-settings').scrollIntoView({block:'start'})",
    );
    await pause(250);
    const geometry = await evaluate(
      "({width:innerWidth,height:innerHeight,nativeWidth:outerWidth,nativeHeight:outerHeight,scrollWidth:document.documentElement.scrollWidth})",
    );
    assert.ok(geometry.scrollWidth <= geometry.width + 1);
    const screenshot = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(
      join(output, `${variant.theme}.png`),
      Buffer.from(screenshot.data, "base64"),
    );
    records.push({ ...variant, geometry });
  }
  await click(button("返回设置指引"));
  await click("document.querySelectorAll('.im-setup-steps button')[1]");
  assert.equal(await evaluate("document.activeElement.id"), "im-device");
  assert.equal(await evaluate(`${button("注册当前设备")}.disabled`), true);
  await evaluate(
    "document.querySelector('#im-device input[type=url]').focus(); document.querySelector('#im-device input[type=url]').select()",
  );
  await send("Input.insertText", { text: gatewayUrl });

  await fill(
    '#im-device input[type="password"]',
    "test-administrator-".repeat(3),
  );
  await click(button("注册当前设备"));
  await until(
    async () =>
      (await evaluate("window.artemis.getImStatus()")).settings.deviceId !==
      localStatus.settings.deviceId,
    "device registration",
  );
  assert.equal(
    await evaluate(
      "document.querySelector('#im-device input[type=password]').value",
    ),
    "",
  );
  await openView("wecom");
  await click(button("刷新机器人连接状态"));
  await until(
    async () =>
      (await evaluate("window.artemis.getImStatus()")).connections?.[0]
        ?.state === "connected",
    "bot refresh while paused",
  );
  await openView("pairing");
  await click(button("生成一次性配对码"));
  const pairCode = await until(
    () =>
      evaluate(
        "/\\/pair ([a-f0-9]{16})/.exec(document.querySelector('#im-pair').innerText)?.[1]",
      ),
    "pair code",
  );
  const identity = {
    channel: "wecom",
    connectionId: "wecom",
    tenantId: "test-tenant",
    appId: "test-bot",
    userId: "alice",
  };
  const message = (id, text) => ({
    version: 1,
    messageId: id,
    identity,
    conversation: { connectionId: "wecom", id: "alice", kind: "direct" },
    text,
    timestamp: Date.now(),
    mentioned: true,
    bot: false,
    attachments: [],
  });
  receive(message("pair", `/pair ${pairCode}`));
  await gateway.tick();
  await click(button("我已发送，刷新配对结果"));
  assert.equal(
    (await evaluate("window.artemis.getImStatus()")).identities.length,
    0,
  );
  await click(button("批准"));
  await until(
    () => evaluate("Boolean(document.querySelector('#im-bot'))"),
    "automatic management after approval",
  );
  assert.equal(
    (await evaluate("window.artemis.getImStatus()")).identities[0].userId,
    "alice",
  );
  // Exercise the real saved-credential form and the existing Gateway admin API.
  await click(button("更换"));
  assert.equal(
    await evaluate(
      "document.querySelector('#im-bot input[type=password]').value",
    ),
    "",
  );
  const credentialCapture = await send("Page.captureScreenshot", {
    format: "png",
  });
  await writeFile(
    join(output, "credentials.png"),
    Buffer.from(credentialCapture.data, "base64"),
  );
  await fill("#im-bot input[type=password]", "synthetic-rotated-secret");
  await click("document.querySelectorAll('#im-bot input[type=password]')[1]");
  await send("Input.insertText", { text: "test-administrator-".repeat(3) });
  await click(button("保存并连接机器人"));
  await until(
    () => evaluate("!document.querySelector('#im-bot input[type=password]')"),
    "saved credential form collapses",
  );
  assert.equal(
    await evaluate(
      "Boolean(document.querySelector('#im-bot').textContent.includes('synthetic-rotated-secret'))",
    ),
    false,
  );
  await openView("spaces");
  await click("document.querySelector('#im-spaces summary')");
  await fill(
    "#im-spaces input[type=password]",
    "test-administrator-".repeat(3),
  );
  await click(button("查看连接、成员和投递诊断"));
  await until(
    () => evaluate("Boolean(document.querySelector('.im-diagnostics'))"),
    "real member and group diagnostics",
  );
  assert.equal(
    await evaluate(
      "document.querySelector('#im-spaces input[type=password]').value",
    ),
    "",
  );
  assert.ok(
    (
      await evaluate("document.querySelector('.im-diagnostics').textContent")
    ).includes("alice"),
  );
  const diagnosticsCapture = await send("Page.captureScreenshot", {
    format: "png",
  });
  await writeFile(
    join(output, "diagnostics.png"),
    Buffer.from(diagnosticsCapture.data, "base64"),
  );
  await openView("wecom");
  // Inline confirmation must not close the real settings dialog on Escape.
  await click(button("解除绑定"));
  assert.equal(
    await evaluate("document.activeElement.textContent.trim()"),
    "确认解除",
  );
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await pause(100);
  assert.equal(
    await evaluate("document.activeElement.textContent.trim()"),
    "解除绑定",
  );
  assert.equal(
    await evaluate("Boolean(document.querySelector('.settings-panel'))"),
    true,
  );
  for (const variant of [
    {
      name: "manage-light",
      theme: "light",
      width: 1280,
      height: 900,
      contrast: "no-preference",
    },
    {
      name: "manage-dark-high",
      theme: "dark",
      width: 1280,
      height: 900,
      contrast: "more",
    },
    {
      name: "compact",
      theme: "light",
      width: 720,
      height: 640,
      contrast: "no-preference",
    },
    {
      name: "zoom-budget",
      theme: "dark",
      width: 640,
      height: 450,
      contrast: "no-preference",
    },
  ]) {
    await evaluate(`window.artemis.setTheme(${JSON.stringify(variant.theme)})`);
    await send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-contrast", value: variant.contrast }],
    });
    await send("Emulation.setDeviceMetricsOverride", {
      width: variant.width,
      height: variant.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await pause(250);
    const geometry = await evaluate(
      `(() => { const panel = document.querySelector('.im-settings'); const detail = document.querySelector('.im-detail'); return { width: innerWidth, height: innerHeight, compact: panel.dataset.compact, contrast: document.documentElement.dataset.artemisContrast, panelWidth: panel.clientWidth, panelScrollWidth: panel.scrollWidth, detailWidth: detail.clientWidth, detailScrollWidth: detail.scrollWidth, dialogWidth: document.querySelector('.settings-panel').getBoundingClientRect().width }; })()`,
    );
    assert.equal(
      geometry.contrast,
      variant.contrast === "more" ? "high" : "normal",
    );
    assert.ok(
      geometry.panelScrollWidth <= geometry.panelWidth + 1,
      JSON.stringify(geometry),
    );
    assert.ok(
      geometry.detailScrollWidth <= geometry.detailWidth + 1,
      JSON.stringify(geometry),
    );
    const screenshot = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(
      join(output, `${variant.name}.png`),
      Buffer.from(screenshot.data, "base64"),
    );
    records.push({ ...variant, geometry });
    if (geometry.compact === "true") {
      await openView("spaces");
      assert.equal(
        await evaluate("document.querySelector('#im-spaces details').open"),
        false,
      );
      await openView("wecom");
    }
  }
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Emulation.setEmulatedMedia", { features: [] });
  await pause(250);
  await send("Emulation.clearDeviceMetricsOverride");
  await mainEvaluate(`${nativeContents}.setZoomFactor(2)`);
  await pause(300);
  assert.equal(await mainEvaluate(`${nativeContents}.getZoomFactor()`), 2);
  await openView("spaces");
  assert.equal(
    await evaluate("document.querySelector('#im-spaces details').open"),
    false,
  );
  await openView("wecom");
  await evaluate(
    "document.querySelector('#im-bot').scrollIntoView({block:'start'})",
  );
  const zoomGeometry = await evaluate(
    `(() => { const p = document.querySelector('.im-settings'); const d = document.querySelector('.im-detail'); return { width: innerWidth, height: innerHeight, compact: p.dataset.compact, panelWidth: p.clientWidth, panelScrollWidth: p.scrollWidth, detailWidth: d.clientWidth, detailScrollWidth: d.scrollWidth }; })()`,
  );
  assert.equal(zoomGeometry.compact, "true");
  assert.ok(zoomGeometry.panelScrollWidth <= zoomGeometry.panelWidth + 1);
  const zoomCapture = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(
    join(output, "native-zoom-200.png"),
    Buffer.from(zoomCapture.data, "base64"),
  );
  records.push({
    name: "native-zoom-200",
    zoomFactor: 2,
    geometry: zoomGeometry,
  });
  await mainEvaluate(`${nativeContents}.setZoomFactor(1)`);
  await pause(200);
  await openView("permissions");
  await click("document.querySelector('#im-permissions input[type=checkbox]')");
  await click(button("保存项目授权"));
  await click("document.querySelector('.im-header [role=switch]')");
  await until(
    async () =>
      (await evaluate("window.artemis.getImStatus()")).settings.grants
        .length === 1,
    "saved project grant",
  );
  await evaluate(
    `window.artemis.saveProviderConnection(${JSON.stringify({ id: "im-provider", name: "IM verification model", baseUrl: modelUrl, api: "openai-completions", models: [{ id: "im-model", name: "IM model", reasoning: false, input: ["text"], contextWindow: 32000, maxTokens: 1000 }] })}, 'test-placeholder')`,
  );
  await evaluate(
    `window.artemis.setModelSelection(${JSON.stringify({ providerId: "im-provider", modelId: "im-model", thinkingLevel: "off" })})`,
  );
  await evaluate(
    "window.artemis.saveGlobalAgents('PRIVATE_IM_SMOKE_GLOBAL_INSTRUCTIONS')",
  );
  assert.equal(
    await evaluate(
      "document.querySelector('.im-header [role=switch]').checked",
    ),
    true,
  );
  await until(
    async () =>
      (await evaluate("window.artemis.getImStatus()")).settings.enabled,
    "enable IM",
  );
  await evaluate(
    "window.__copiedImCommand=''; navigator.clipboard.writeText=async text=>{window.__copiedImCommand=text;}",
  );
  await openView("pairing");
  await click("document.querySelector('#im-test button')");
  assert.equal(await evaluate("window.__copiedImCommand"), "/projects");
  receive(message("new-task", "/new Explain README.md"));
  receive(message("new-task", "/new Explain README.md"));
  await until(
    () => sent.some((item) => item.text.includes("IM_SMOKE_OK")),
    "Pi task final reply",
    60000,
  );
  const snapshot = await evaluate("window.artemis.getSnapshot()");
  const remote = snapshot.threads.filter((thread) =>
    thread.title.startsWith("企业微信 · "),
  );
  assert.equal(remote.length, 1);
  const events = await evaluate(
    `window.artemis.getThreadEvents(${JSON.stringify(remote[0].id)})`,
  );
  assert.ok(events.some((event) => event.payload.type === "turn.completed"));
  assert.ok(events.some((event) => event.payload.type === "tool.completed"));
  assert.ok(
    modelCalls.some((call) =>
      call.messages?.some(
        (item) =>
          item.role === "tool" &&
          JSON.stringify(item.content).includes("IM_SMOKE_PROJECT"),
      ),
    ),
  );
  assert.ok(
    !JSON.stringify(modelCalls).includes(
      "PRIVATE_IM_SMOKE_GLOBAL_INSTRUCTIONS",
    ),
  );
  assert.ok(
    modelCalls.every((call) =>
      (call.tools ?? []).every(
        (tool) =>
          !["shell", "write", "read", "save_memory"].includes(
            tool.function.name,
          ),
      ),
    ),
  );
  await click(
    "Array.from(document.querySelectorAll('button')).find(b=>['关闭','Close'].includes(b.textContent.trim()))",
  );
  assert.ok(
    (await evaluate("document.body.innerText")).includes(remote[0].title),
    "IM-created task appears in the sidebar without a reload",
  );
  await click("document.querySelector('.thread-action')");
  await click("document.querySelector('.thread-menu .danger')");
  await click("document.querySelector('.confirmation-dialog .primary-button')");
  await until(
    async () =>
      (await evaluate("window.artemis.getSnapshot()")).threads.length === 0,
    "delete the IM task through the desktop UI",
  );
  assert.ok(
    !(await evaluate("document.body.innerText")).includes(remote[0].title),
  );
  const imState = new DatabaseSync(join(data, "im.sqlite"), { readOnly: true });
  try {
    assert.equal(
      imState
        .prepare(
          "SELECT count(*) AS count FROM im_state WHERE (namespace IN ('bindings','subscriptions') AND id=?) OR (namespace IN ('selections','actions') AND json_extract(value,'$.threadId')=?)",
        )
        .get(remote[0].id, remote[0].id).count,
      0,
      "deletion removes the task's active IM state",
    );
  } finally {
    imState.close();
  }
  receive(message("new-task", "/new Explain README.md"));
  receive(message("after-delete", "Explain README.md after deletion"));
  receive(message("after-delete", "Explain README.md after deletion"));
  await until(
    () => sent.filter((item) => item.text.includes("IM_SMOKE_OK")).length === 2,
    "ordinary message starts a replacement task after deletion",
    60000,
  );
  const replacement = (await evaluate("window.artemis.getSnapshot()")).threads;
  assert.equal(
    replacement.length,
    1,
    "redeliveries do not recreate deleted tasks",
  );
  assert.notEqual(replacement[0].id, remote[0].id);
  assert.equal(
    replacement[0].title,
    "企业微信 · Explain README.md after deletion",
  );
  assert.ok(
    (await evaluate("document.body.innerText")).includes(replacement[0].title),
    "replacement task appears without a reload or an explicit /new command",
  );
  assert.ok(!sent.some((item) => item.text.includes("任务不可访问")));
  const afterDelete = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(
    join(output, "after-delete.png"),
    Buffer.from(afterDelete.data, "base64"),
  );
  assert.deepEqual(exceptions, []);
  assert.deepEqual(
    consoleIssues.filter((issue) => issue.type === "error"),
    [],
  );
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        passed: true,
        runtime,
        checks: [
          "six setup steps and navigation",
          "built-in Gateway starts and registers automatically without grants or administrator form",
          "Slack selection, manifest copy and two-token form",
          "Slack pairing and first-task commands omit slash",
          "light/dark/high-contrast/compact/200-percent CSS viewport-budget layout",
          "real device pairing approval and automatic management transition",
          "inline unpair Escape restores focus without closing settings",
          "native webContents 200-percent zoom, compact navigation and no IM horizontal overflow",
          "registration clears credentials",
          "saved credentials replace through real admin API, secrets remain empty on entry and clear after save",
          "real member/group diagnostics and administrator credential clearing",
          "pairing refresh works while paused",
          "project authorization UI",
          "copy control payload",
          "real Electron task and Pi remote_read",
          "duplicate IM delivery creates one task",
          "private global instructions excluded",
          "final reply and desktop task agree",
          "desktop deletion clears persisted IM selections and bindings",
          "ordinary follow-up creates a visible replacement with a Chinese channel title",
          "redelivery after deletion does not recreate or duplicate a task",
        ],
        records,
        taskId: remote[0].id,
        replacementTaskId: replacement[0].id,
        modelCalls: modelCalls.length,
        consoleIssues,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, output }));
} catch (error) {
  await writeFile(
    join(output, "model-calls.json"),
    JSON.stringify(modelCalls, null, 2),
  );
  await writeFile(
    join(output, "failure.log"),
    `${error.stack}\n${logs.slice(-12000)}`,
  );
  throw error;
} finally {
  socket?.close();
  mainSocket?.close();
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    child.once("exit", resolve);
    setTimeout(resolve, 3000);
  });
  await gateway.close();
  await new Promise((resolve) => model.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}

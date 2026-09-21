import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { GatewayStore } from "../../../packages/gateway/dist/store.js";
import {
  imIdentityKey,
  imConversationKey,
  imAuthorizationFingerprint,
  imAuthorizationImpactVersion,
  imPolicyVersion,
} from "../../../packages/protocol/dist/index.js";

// Real production main/preload/renderer and local Gateway. Only the observed
// channel roster is synthetic, seeded while the app is stopped. No adapter,
// account credential, external message or production user data is used.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const electron = createRequire(import.meta.url)("electron");
const temporary = await realpath(
  await mkdtemp(join(tmpdir(), "artemis-native-im-")),
);
const data = join(temporary, "user-data");
const output = resolve(
  process.argv.slice(2).find((arg) => !arg.startsWith("--")) ??
    join(temporary, "evidence"),
);
await mkdir(data);
await mkdir(output, { recursive: true });
for (const file of ["result.json", "failure.log", "failure-dom.txt"])
  await rm(join(output, file), { force: true });
const database = new DatabaseSync(join(data, "artemis.sqlite"));
database.exec(
  "CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,path TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,hidden INTEGER NOT NULL DEFAULT 0)",
);
for (const id of ["project-a", "project-b"]) {
  const path = join(temporary, id);
  await mkdir(path);
  await writeFile(
    join(path, "README.md"),
    "Synthetic group authorization verification.",
  );
  database
    .prepare("INSERT INTO projects VALUES(?,?,?,?,?,0)")
    .run(id, id, path, new Date().toISOString(), new Date().toISOString());
}
database.close();
const env = { ...process.env };
for (const key of Object.keys(env))
  if (
    key === "ELECTRON_RUN_AS_NODE" ||
    key.startsWith("ARTEMIS_SMOKE_") ||
    key === "ARTEMIS_DEV_SERVER_URL"
  )
    delete env[key];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, name, timeout = 30000) {
  const deadline = Date.now() + timeout;
  do {
    const value = await check();
    if (value) return value;
    await pause(100);
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${name}`);
}
async function cdp(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  const exceptions = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown")
      exceptions.push(message.params.exceptionDetails);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    message.error
      ? entry.reject(new Error(message.error.message))
      : entry.resolve(message.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 30000);
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
  await send("Runtime.enable");
  return { send, evaluate, exceptions, close: () => socket.close() };
}
let live;
async function launch() {
  const child = spawn(
    electron,
    [
      join(root, "apps/desktop"),
      `--user-data-dir=${data}`,
      "--inspect=127.0.0.1:0",
      "--remote-debugging-port=0",
      "--remote-debugging-address=127.0.0.1",
    ],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let logs = "";
  child.stdout.on("data", (chunk) => (logs += chunk));
  child.stderr.on("data", (chunk) => (logs += chunk));
  const mainUrl = await until(
    () =>
      /Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/u.exec(logs)?.[1],
    "main inspector",
  );
  const browserUrl = await until(
    () =>
      /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+)\/\S+/u.exec(logs)?.[1],
    "renderer inspector",
  );
  const main = await cdp(mainUrl);
  const target = await until(
    async () =>
      (
        await (
          await fetch(browserUrl.replace("ws:", "http:") + "/json/list")
        ).json()
      ).find(
        (target) => target.type === "page" && target.url.includes("index.html"),
      ),
    "production renderer",
  );
  const page = await cdp(target.webSocketDebuggerUrl);
  await until(
    () =>
      page.evaluate("!!window.artemis && !!document.querySelector('button')"),
    "desktop ready",
  );
  const electronExpression = `process.getBuiltinModule('module').createRequire(${JSON.stringify(join(root, "apps/desktop/package.json"))})('electron')`;
  const windowExpression = `${electronExpression}.BrowserWindow.getAllWindows().find(window=>!window.isDestroyed())`;
  live = {
    page,
    main,
    child,
    windowExpression,
    logs: () => logs,
    async close() {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      void main.evaluate(`${electronExpression}.app.quit()`).catch(() => {});
      main.close();
      page.close();
      await Promise.race([
        exited,
        pause(10000).then(() => {
          if (child.exitCode === null) child.kill("SIGTERM");
        }),
      ]);
    },
  };
  return live;
}
const identity = {
  channel: "slack",
  connectionId: "synthetic-bot",
  tenantId: "synthetic-team",
  appId: "synthetic-app",
  userId: "synthetic-owner",
};
const conversation = {
  connectionId: identity.connectionId,
  kind: "group",
  id: "synthetic-room",
};
const checks = [];
const modelCalls = [];
const model = createServer(async (request, response) => {
  try {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    modelCalls.push(body);
    const result = body.messages?.findLast(
      (message) => message.role === "tool",
    );
    const reader = body.tools?.find((tool) =>
      ["read", "remote_read"].includes(tool.function?.name),
    );
    assert.ok(result || reader, "Pi must expose an authorized read tool");
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const event = (delta, finish_reason = null) =>
      response.write(
        `data: ${JSON.stringify({ id: "synthetic-response", object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: "im-model", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
      );
    event(
      result
        ? {
            role: "assistant",
            content: "IM_NATIVE_PI_OK: scoped project read completed.",
          }
        : {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: "read-synthetic-file",
                type: "function",
                function: {
                  name: reader.function.name,
                  arguments: JSON.stringify({ path: "README.md" }),
                },
              },
            ],
          },
    );
    event({}, result ? "stop" : "tool_calls");
    response.end("data: [DONE]\n\n");
  } catch (error) {
    response.writeHead(500);
    response.end(String(error));
  }
});
await new Promise((resolve) => model.listen(0, "127.0.0.1", resolve));
try {
  let app = await launch();
  await app.page.evaluate('window.artemis.setLanguage("zh-CN")');
  const initialized = await app.page.evaluate(
    'window.artemis.manageIm({action:"setup-local"})',
  );
  const deviceId = initialized.settings.deviceId;
  await app.close();
  live = undefined;
  // No encrypted connection is read or written; this key is used only to open
  // the stopped synthetic database for public identity/observation fixtures.
  const store = new GatewayStore(
    join(data, "im-gateway", "gateway.sqlite"),
    "synthetic-public-fixture-key-".repeat(2),
  );
  store.put("identities", imIdentityKey(identity), { deviceId, identity });
  for (const id of ["synthetic-room", "other-room"]) {
    const target = { ...conversation, id };
    store.put("observed-groups", imConversationKey(target), {
      conversation: target,
      name: "合成研发群",
      platform: "slack",
      identities: [identity],
      lastSeenAt: Date.now(),
    });
  }
  store.close();
  app = await launch();
  await app.page.evaluate('window.artemis.manageIm({action:"setup-local"})');
  const call = (method, value) =>
    app.page.evaluate(`window.artemis.${method}(${JSON.stringify(value)})`);
  const click = async (expression) => {
    await until(
      () => app.page.evaluate(`!!(${expression}) && !(${expression}).disabled`),
      expression,
    );
    const point = await app.page.evaluate(
      `(()=>{const element=${expression};element.scrollIntoView({block:'center'});const r=element.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
    await app.page.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      button: "left",
      clickCount: 1,
      ...point,
    });
    await app.page.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      button: "left",
      clickCount: 1,
      ...point,
    });
  };
  const button = (label) =>
    `Array.from(document.querySelectorAll('dialog.im-group-dialog button')).find(b=>b.textContent.trim()===${JSON.stringify(label)})`;
  await click(
    "Array.from(document.querySelectorAll('button')).find(b=>['Settings','设置'].includes(b.getAttribute('aria-label')))",
  );
  await click("document.querySelector('#settings-tab-im-button')");
  await click(
    "Array.from(document.querySelectorAll('.im-channel-row')).find(b=>b.textContent.includes('群聊项目授权'))",
  );
  await click(
    "Array.from(document.querySelectorAll('.im-group-management nav button')).find(b=>b.textContent.includes('synthetic-room'))",
  );
  await click(button("为此群授权"));
  assert.equal(await app.page.evaluate(`(${button("下一步")}).disabled`), true);
  await click(
    "document.querySelector('.im-group-body button[aria-haspopup=listbox]')",
  );
  await click(
    "Array.from(document.querySelectorAll('[role=option]')).find(b=>b.textContent.includes('project-a'))",
  );
  await click(button("下一步"));
  await click(button("下一步"));
  for (const theme of ["light", "dark"]) {
    await call("setTheme", theme);
    for (const [width, height, zoom] of [
      [980, 680, 1],
      [1440, 900, 1],
      [980, 680, 2],
    ]) {
      await app.main.evaluate(
        `${app.windowExpression}.setSize(${width},${height});${app.windowExpression}.webContents.setZoomFactor(${zoom})`,
      );
      await until(
        () => app.page.evaluate(`Math.abs(innerWidth-${width / zoom})<5`),
        "real zoom layout",
      );
      const geometry = await app.page.evaluate(
        "(()=>{const d=document.querySelector('.im-group-dialog'),b=document.querySelector('.im-group-body'),r=d.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,overflow:b.scrollWidth>b.clientWidth,dialogCount:document.querySelectorAll('dialog[open]').length}})()",
      );
      assert.ok(
        geometry.x >= 0 &&
          geometry.y >= 0 &&
          geometry.right <= geometry.width &&
          geometry.bottom <= geometry.height &&
          !geometry.overflow,
        JSON.stringify(geometry),
      );
      const capture = await app.main.evaluate(
        `(async()=>(await ${app.windowExpression}.webContents.capturePage()).toDataURL())()`,
      );
      await writeFile(
        join(output, `${theme}-${width}-${zoom}.png`),
        Buffer.from(capture.split(",")[1], "base64"),
      );
      checks.push({ theme, width, height, zoom, geometry });
    }
  }
  // Escape keeps the dirty draft in the same shell; returning restores it.
  await app.page.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27,
  });
  await app.page.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27,
  });
  await click(button("继续编辑"));
  await click("document.querySelector('.im-group-body input[type=checkbox]')");
  await click(button("确认并应用"));
  const created = await until(async () => {
    const status = await call("getImStatus");
    return status.authorizationOperations?.find(
      (op) => op.state === "complete",
    );
  }, "completed authorization");
  assert.equal(created.command.projectId, "project-a");
  assert.equal(created.group.nativeGroup.enabled, true);
  const retry = await call("manageIm", {
    action: "retry-group-authorization",
    operationId: created.command.operationId,
  });
  assert.deepEqual(retry, created);
  // Exercise narrow commands through real IPC after the rendered create flow.
  async function change(intent, projectId = "project-a") {
    const status = await call("getImStatus");
    const grant = status.settings.grants.find((g) => g.projectId === projectId);
    const group = status.spaces.find((g) => g.id === created.group.id);
    const scope = grant?.security?.scopes.find(
      (s) => s.audience === `space:${group.id}`,
    );
    const policy = grant ? undefined : created.command.policy;
    const command = {
      ...created.command,
      operationId: randomUUID(),
      intent,
      projectId,
      gatewayUrl: status.settings.gatewayUrl,
      expectedPolicyVersion: imPolicyVersion(grant),
      expectedGroupVersion: group.revision,
      expectedScopeVersion: scope?.revision ?? null,
      expectedDeviceEnabled: status.settings.enabled,
      expectedImpactVersion: imAuthorizationImpactVersion(
        status.settings,
        projectId,
        !!policy,
        intent !== "pause",
      ),
      policy,
      scope: { ...(scope ?? created.command.scope), confirmedAt: Date.now() },
      enableService: intent !== "pause",
    };
    command.confirmationFingerprint = imAuthorizationFingerprint(command);
    const result = await call("manageIm", {
      action: "authorize-group",
      command,
    });
    assert.equal(result.state, "complete", JSON.stringify(result));
    return result;
  }
  assert.equal((await change("pause")).group.nativeGroup.enabled, false);
  assert.equal((await change("restore")).group.nativeGroup.enabled, true);
  const before = await call("getImStatus");
  const oldThread = before.remoteTasks.find(
    (t) =>
      t.group?.spaceId === created.group.id && t.currentGroupEntry === true,
  )?.threadId;
  await change("rebind", "project-b");
  const after = await call("getImStatus");
  const newThread = after.remoteTasks.find(
    (t) =>
      t.group?.spaceId === created.group.id && t.currentGroupEntry === true,
  )?.threadId;
  assert.ok(oldThread && newThread && oldThread !== newThread);
  assert.equal(
    after.settings.grants
      .find((g) => g.projectId === "project-a")
      .groups.includes(`space:${created.group.id}`),
    false,
  );
  const provider = {
    id: "im-provider",
    name: "Synthetic verification model",
    baseUrl: `http://127.0.0.1:${model.address().port}/v1`,
    api: "openai-completions",
    models: [
      {
        id: "im-model",
        name: "IM model",
        reasoning: false,
        input: ["text"],
        contextWindow: 32000,
        maxTokens: 1000,
      },
    ],
  };
  await app.page.evaluate(
    `window.artemis.saveProviderConnection(${JSON.stringify(provider)}, "test-placeholder")`,
  );
  await call("setModelSelection", {
    providerId: "im-provider",
    modelId: "im-model",
    thinkingLevel: "off",
  });
  const input = await call("manageIm", {
    action: "native-group-input",
    threadId: newThread,
    messageId: randomUUID(),
    destination: "local",
    text: "Read README.md and summarize the synthetic project.",
  });
  await until(
    async () =>
      JSON.stringify(await call("getThreadEvents", input.threadId)).includes(
        "IM_NATIVE_PI_OK",
      ),
    "production Pi scoped read",
    60000,
  );
  assert.ok(
    modelCalls.some((body) =>
      body.messages?.some(
        (message) =>
          message.role === "tool" &&
          JSON.stringify(message.content).includes(
            "Synthetic group authorization verification",
          ),
      ),
    ),
  );
  assert.deepEqual(app.page.exceptions, []);
  await app.close();
  live = undefined;
  app = await launch();
  const restored = await app.page.evaluate("window.artemis.getImStatus()");
  assert.equal(
    restored.authorizationOperations.filter((op) => op.state === "complete")
      .length,
    4,
  );
  assert.equal(
    restored.settings.grants
      .find((g) => g.projectId === "project-b")
      .groups.includes(`space:${created.group.id}`),
    true,
  );
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        status: "passed",
        checks,
        authorization: [
          "rendered explicit project selection",
          "same-shell Escape discard",
          "create",
          "same-ID replay",
          "pause",
          "restore",
          "rebind fresh context",
          "restart persistence",
          "production Pi scoped read via loopback model",
        ],
        evidenceBoundary:
          "Production Electron/main/preload/local Gateway with synthetic roster. Pi executed a real scoped read using a loopback model. No real channel delivery, external model, packaged installation, native screen reader or cross-platform acceptance is claimed.",
      },
      null,
      2,
    ),
  );
  console.log(`Native IM verification passed: ${output}`);
} catch (error) {
  await writeFile(
    join(output, "model-calls.json"),
    JSON.stringify(modelCalls, null, 2),
  );
  if (live)
    await writeFile(
      join(output, "failure-dom.txt"),
      await live.page
        .evaluate("document.body.innerText")
        .catch(() => "unavailable"),
    );
  await writeFile(
    join(output, "failure.log"),
    `${error.stack}\n${live?.logs() ?? ""}`,
  );
  throw error;
} finally {
  await live?.close();
  await new Promise((resolve) => model.close(resolve));
}

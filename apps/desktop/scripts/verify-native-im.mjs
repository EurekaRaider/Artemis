import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdir, mkdtemp, realpath, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  imIdentityKey,
  imConversationKey,
} from "../../../packages/protocol/dist/index.js";

// Production Electron/preload/Pi with a loopback model and synthetic channel. No personal account or model key is used.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const electron = createRequire(import.meta.url)("electron");
const temporary = await realpath(
  await mkdtemp(join(tmpdir(), "artemis-im-electron-")),
);
const data = join(temporary, "user-data");
const project = join(temporary, "project");

const output = resolve(process.argv[2] ?? join(root, "artifacts", "native-im"));
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
for (const directory of [".git", "src", "docs", "packages", "scripts"]) {
  await mkdir(join(project, directory));
}
await writeFile(join(project, ".env"), "SYNTHETIC_TEST_VALUE=private");
await writeFile(join(project, "src", "index.ts"), "export const demo = true;");
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

const model = createServer(async (request, response) => {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  const slow = raw.includes("CANCEL_ME");
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  const emit = (delta, finish_reason = null) =>
    response.write(
      `data: ${JSON.stringify({ id: "qa", object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: "im-model", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
    );
  emit({
    role: "assistant",
    content: slow
      ? "Working on cancellation test."
      : "IM_FINAL_OK: **Project reply** returned successfully.",
  });
  const timer = setTimeout(
    () => {
      emit({}, "stop");
      response.end("data: [DONE]\n\n");
    },
    slow ? 30000 : 2500,
  );
  response.on("close", () => clearTimeout(timer));
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
let currentAction = "starting";
let failureSnapshot;
let debugDump;
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
        reject(new Error(`${method} timed out while ${currentAction}`));
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
  debugDump = async () => {
    await writeFile(
      join(output, "debug.json"),
      JSON.stringify(
        {
          text: await evaluate("document.body.innerText"),
          snapshot: await evaluate("window.artemis.getSnapshot()"),
          status: await evaluate("window.artemis.getImStatus()"),
        },
        null,
        2,
      ),
    );
    const shot = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(
      join(output, "failure.png"),
      Buffer.from(shot.data, "base64"),
    );
  };
  const click = async (expression) => {
    currentAction = expression;
    await until(
      // Also wait out disabled controls: row actions briefly disable while
      // their immediate save is in flight.
      () =>
        evaluate(
          `(()=>{const e=${expression};return !!e && e.getClientRects().length > 0 && !e.disabled})()`,
        ),
      `control: ${expression}`,
    );
    const rect = await evaluate(
      `(()=>{const e=${expression};if(!e)throw new Error('Missing control');e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
    );
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...rect });
    await pause(150);
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
    `Array.from(document.querySelectorAll('button')).find(b=>b.getClientRects().length && (b.textContent.trim()===${JSON.stringify(text)} || b.getAttribute('aria-label')===${JSON.stringify(text)}))`;
  await send("Runtime.enable");
  await send("Page.enable");
  await until(
    () =>
      evaluate("Boolean(window.artemis && document.querySelector('button'))"),
    "desktop ready",
  );
  await evaluate("window.artemis.setLanguage('zh-CN')");
  await mainEvaluate(
    `(()=>{const C=process.getBuiltinModule('node:sqlite').DatabaseSync;const original=C.prototype.prepare;C.prototype.prepare=function(sql){if(sql.includes('INSERT INTO state('))globalThis.__nativeGatewayDb=this;return original.call(this,sql)};globalThis.__restoreNativeStore=()=>{C.prototype.prepare=original};})()`,
  );
  await evaluate("window.artemis.manageIm({action:'setup-local'})");
  const status = await evaluate("window.artemis.getImStatus()");
  const identity = {
    channel: "slack",
    connectionId: "demo-bot",
    tenantId: "demo-team",
    appId: "demo-app",
    userId: "demo-owner",
  };
  const conversation = {
    connectionId: "demo-bot",
    id: "demo-room",
    kind: "group",
  };
  // Seed authenticated discovery only in this throwaway profile. This is UI
  // verification, not proof of a real platform's bot-to-bot capability.
  await mainEvaluate(
    `(()=>{const db=globalThis.__nativeGatewayDb;if(!db)throw Error('Missing isolated store');const put=(ns,id,value)=>db.prepare('INSERT OR REPLACE INTO state(namespace,id,value) VALUES(?,?,?)').run(ns,id,JSON.stringify(value));put('identities',${JSON.stringify(imIdentityKey(identity))},${JSON.stringify({ identity, deviceId: status.settings.deviceId })});put('observed-groups',${JSON.stringify(imConversationKey(conversation))},${JSON.stringify({ conversation, name: "Design group", identities: [identity], lastSeenAt: Date.now() })});globalThis.__restoreNativeStore();delete globalThis.__restoreNativeStore;})()`,
  );
  await evaluate(
    "(async()=>{const s=await window.artemis.getImStatus();return window.artemis.saveImSettings({...s.settings,enabled:true})})()",
  );
  await evaluate("window.artemis.manageIm({action:'refresh'})");

  await evaluate(
    `window.artemis.saveProviderConnection(${JSON.stringify({ id: "im-provider", name: "QA model", baseUrl: modelUrl, api: "openai-completions", models: [{ id: "im-model", name: "QA model", reasoning: false, input: ["text"], contextWindow: 32000, maxTokens: 1000 }] })},'synthetic-key')`,
  );
  await evaluate(
    `window.artemis.setModelSelection({providerId:"im-provider",modelId:"im-model",thinkingLevel:"off"})`,
  );
  await evaluate(
    `window.artemis.manageIm(${JSON.stringify({ action: "authorize-native-group", conversation, owner: identity, name: "Demo team", confirmed: true, grant: { projectId: "im-project", mode: "plan", security: { version: 2, revision: "draft", confirmedAt: Date.now(), scopes: [{ audience: "owner", readPaths: ["README.md"], writePaths: [] }] }, expiresAt: Date.now() + 3600000 } })})`,
  );
  const group = (await evaluate("window.artemis.getImStatus()")).remoteTasks[0];
  await mainEvaluate(
    `(()=>{const C=process.getBuiltinModule('node:sqlite').DatabaseSync;const db=new C(${JSON.stringify(join(data, "im.sqlite"))});db.prepare('INSERT INTO im_state(namespace,id,value) VALUES(?,?,?)').run('member-labels',${JSON.stringify(JSON.stringify([status.settings.deviceId, status.settings.deviceId]))},JSON.stringify({name:'Lark',deviceName:'Artemis'}));db.close()})()`,
  );
  const roster = {
    complete: true,
    members: [
      {
        identity: { ...identity, userId: "demo-owner" },
        name: "Alex",
        kind: "human",
        presence: "active",
        presenceCheckedAt: Date.now(),
      },
      {
        identity: { ...identity, userId: "unpaired-teammate" },
        name: "Morgan",
        kind: "human",
        presence: "away",
        presenceCheckedAt: Date.now(),
      },
      {
        identity: { ...identity, userId: "demo-bot" },
        name: "Artemis",
        kind: "bot",
        self: true,
      },
      {
        identity: { ...identity, userId: "demo-solar" },
        name: "Solar",
        kind: "bot",
      },
    ],
  };
  await mainEvaluate(
    `globalThis.__nativeGatewayDb.prepare('INSERT OR REPLACE INTO state(namespace,id,value) VALUES(?,?,?)').run('native-group-info',${JSON.stringify(group.group.spaceId)},${JSON.stringify(JSON.stringify({ roster, next: Date.now() + 3600000 }))})`,
  );
  await evaluate("window.artemis.manageIm({action:'refresh'})");
  const inject = async (text) => {
    const id = crypto.randomUUID();
    const event = {
      version: 1,
      messageId: id,
      identity: { ...identity, userId: "unpaired-teammate" },
      conversation,
      text,
      timestamp: Date.now(),
      mentioned: true,
      bot: false,
      attachments: [],
    };
    await mainEvaluate(
      `globalThis.__nativeGatewayDb.prepare('INSERT INTO queue(bucket,id,recipient,payload) VALUES(?,?,?,?)').run('incoming',${JSON.stringify(id)},${JSON.stringify(identity.connectionId)},${JSON.stringify(JSON.stringify(event))})`,
    );
  };
  await inject("Explain the project");
  const thread = await until(
    async () =>
      (await evaluate("window.artemis.getSnapshot()")).threads.find((t) =>
        t.title.includes("Explain the project"),
      ),
    "IM task creation",
  );
  assert.equal(thread.projectId, "im-project");
  await until(
    () =>
      evaluate(
        `window.artemis.getThreadEvents(${JSON.stringify(thread.id)}).then(events=>events.some(e=>e.payload.type==='turn.completed'))`,
      ),
    "unviewed IM task completes",
  );
  await until(
    () =>
      mainEvaluate(
        `process.getBuiltinModule('module').createRequire(${JSON.stringify(join(root, "apps/desktop/package.json"))})('electron').app.dock.getBadge()==='1'`,
      ),
    "Dock shows one unread actual task",
  );
  if (
    await evaluate(
      "document.querySelector('.project-group-select').getAttribute('aria-expanded')==='false'",
    )
  )
    await click("document.querySelector('.project-group-select')");
  if (
    await evaluate(
      "document.querySelector('.project-toggle').getAttribute('aria-expanded')==='false'",
    )
  )
    await click("document.querySelector('.project-toggle')");
  await mainEvaluate(
    `${nativeContents}.getOwnerBrowserWindow().show();${nativeContents}.getOwnerBrowserWindow().focus();process.getBuiltinModule('module').createRequire(${JSON.stringify(join(root, "apps/desktop/package.json"))})('electron').app.focus({steal:true})`,
  );
  await until(
    () => mainEvaluate(`${nativeContents}.getOwnerBrowserWindow().isFocused()`),
    "native window focused",
  );
  await click(
    `Array.from(document.querySelectorAll('.thread-select')).find(b=>b.textContent.includes('Slack · Explain the project'))`,
  );
  await until(
    () =>
      evaluate(
        `document.querySelector('.conversation')?.innerText.includes('IM_FINAL_OK')`,
      ),
    "normal session response",
  );
  await until(
    () =>
      evaluate(
        `window.artemis.getThreadEvents(${JSON.stringify(thread.id)}).then(events=>events.some(e=>e.payload.type==='turn.completed'))`,
      ),
    "turn completed",
  );
  await until(
    () => evaluate(`!document.querySelector('button[title="停止"]')`),
    "stop control removed",
  );
  await until(
    () =>
      mainEvaluate(
        `process.getBuiltinModule('module').createRequire(${JSON.stringify(join(root, "apps/desktop/package.json"))})('electron').app.dock.getBadge()===''`,
      ),
    "Dock badge clears after reading IM task",
  );
  const state = await evaluate(
    `({text:document.body.innerText,html:document.querySelector('.conversation').innerHTML,buttons:[...document.querySelectorAll('button')].map(b=>b.getAttribute('aria-label'))})`,
  );
  assert.ok(state.text.includes("IM verification project"));
  assert.ok(!state.text.includes("显示此机器人参与的消息和任务"));
  assert.ok(!state.text.includes("思考中"));
  assert.ok(!state.text.includes("[IM provenance"));
  assert.ok(!state.text.includes("Lark"));
  assert.ok(state.text.includes("群协作成员 · 4"));
  const memberGeometry = await evaluate(
    `Array.from(document.querySelectorAll('.im-member-kind')).map(icon=>{const a=icon.getBoundingClientRect(),b=icon.closest('strong').querySelector(':scope > span:not([data-artemis-component])').getBoundingClientRect();return Math.abs(a.y+a.height/2-b.y-b.height/2)})`,
  );
  assert.ok(
    memberGeometry.every((delta) => delta <= 1),
    JSON.stringify(memberGeometry),
  );
  const compact = await evaluate(
    `({rows:[...document.querySelectorAll('.im-native-members [role=listitem]')].map(e=>e.getBoundingClientRect().height),button:(()=>{const r=document.querySelector('.im-native-members .im-member-mention').getBoundingClientRect();return [r.width,r.height]})()})`,
  );
  assert.deepEqual(compact.button, [24, 24]);
  assert.ok(
    compact.rows.every((height) => height === 26),
    JSON.stringify(compact),
  );
  const assignmentGeometry = await evaluate(
    `[...document.querySelectorAll('.im-member-permission-toggle')].map(b=>{const r=b.getBoundingClientRect(),row=b.closest('[role=listitem]').getBoundingClientRect();return {right:row.right-r.right,icon:b.querySelector('svg').getAttribute('data-artemis-icon')}})`,
  );
  assert.ok(
    assignmentGeometry.every(
      (g) => g.right <= 4 && ["send", "block"].includes(g.icon),
    ),
    JSON.stringify(assignmentGeometry),
  );
  for (const name of ["Alex", "Artemis"]) {
    const point = await evaluate(
      `(()=>{const row=[...document.querySelectorAll('.im-native-members [role=listitem]')].find(e=>e.textContent.includes('${name}'));const r=row.getBoundingClientRect();return {x:r.x+30,y:r.y+r.height/2}})()`,
    );
    await send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      button: "right",
      clickCount: 1,
      ...point,
    });
    await send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      button: "right",
      clickCount: 1,
      ...point,
    });
    assert.equal(
      await evaluate(`!!document.querySelector('.im-member-permission-menu')`),
      false,
    );
  }

  assert.equal(
    await evaluate(
      `document.querySelectorAll('.im-member-kind[data-state=online]').length`,
    ),
    1,
  );
  assert.equal(
    await evaluate(
      `document.querySelectorAll('.im-member-kind[data-state=unknown]').length`,
    ),
    1,
  );
  for (const [state, token] of [
    ["active", "--success"],
    ["away", "--custom-agent-yellow"],
    ["unknown", "--muted-2"],
  ]) {
    assert.equal(
      await evaluate(`(() => {
      const icon = document.querySelector('.im-member-kind[data-state="${state}"]');
      if (!icon) return false;
      const probe = document.createElement('span');
      probe.style.color = 'var(${token})';
      document.body.append(probe);
      const matches = getComputedStyle(icon).color === getComputedStyle(probe).color;
      probe.remove();
      return matches;
    })()`),
      true,
      `member ${state} color`,
    );
  }

  assert.equal(
    await evaluate(
      `document.querySelectorAll('.im-group-members [data-artemis-icon=bot]').length`,
    ),
    2,
  );
  assert.ok(!state.text.includes("untrusted data"));
  assert.ok(state.html.includes("<strong>Project reply</strong>"));
  await until(
    () =>
      mainEvaluate(
        `globalThis.__nativeGatewayDb.prepare("SELECT payload FROM queue WHERE bucket='outgoing'").all().some(r=>JSON.parse(r.payload).text.includes('IM_FINAL_OK'))`,
      ),
    "final reply in authorized gateway queue",
  );
  const openMemberMenu = async () => {
    const point = await evaluate(
      `(()=>{const row=[...document.querySelectorAll('.im-native-members [role=listitem]')].find(e=>e.textContent.includes('Morgan'));const r=row.getBoundingClientRect();return {x:r.x+30,y:r.y+r.height/2}})()`,
    );
    await send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      button: "right",
      clickCount: 1,
      ...point,
    });
    await send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      button: "right",
      clickCount: 1,
      ...point,
    });
    await until(
      () => evaluate(`!!document.querySelector('[role=menuitemcheckbox]')`),
      "member context menu",
    );
  };
  await openMemberMenu();
  assert.ok(
    await evaluate(
      `document.querySelector('[role=menuitemcheckbox]').getAttribute('aria-label').includes('禁止 Morgan 派工')`,
    ),
  );
  await click(`document.querySelector('[role=menuitemcheckbox]')`);
  await until(
    () => evaluate(`!document.querySelector('[role=menuitemcheckbox]')`),
    "permission saved",
  );
  assert.ok(
    await evaluate(
      `document.querySelector('.im-member-permission-toggle[aria-label="允许 Morgan 派工"]').getAttribute('aria-pressed')==='true'`,
    ),
  );
  await click(
    `document.querySelector('.im-member-permission-toggle[aria-label="允许 Solar 派工"]')`,
  );
  await until(
    () =>
      evaluate(
        `!!document.querySelector('.im-member-permission-toggle[aria-label="禁止 Solar 派工"]:not(:disabled)')`,
      ),
    "bot blocked by status button",
  );
  await click(
    `document.querySelector('.im-member-permission-toggle[aria-label="禁止 Solar 派工"]')`,
  );
  await until(
    () =>
      evaluate(
        `!!document.querySelector('.im-member-permission-toggle[aria-label="允许 Solar 派工"]:not(:disabled)')`,
      ),
    "bot allowed by status button",
  );
  await inject("Blocked request");
  await until(
    () =>
      mainEvaluate(
        `globalThis.__nativeGatewayDb.prepare("SELECT payload FROM queue WHERE bucket='outgoing'").all().some(r=>JSON.parse(r.payload).text.includes('已禁止'))`,
      ),
    "blocked member denied",
  );
  await openMemberMenu();
  assert.ok(
    await evaluate(
      `document.querySelector('[role=menuitemcheckbox]').getAttribute('aria-label').includes('允许 Morgan 派工')`,
    ),
  );
  const menuSize = await evaluate(
    `(()=>{const r=document.querySelector('[role=menu]').getBoundingClientRect();return {width:r.width,height:r.height}})()`,
  );
  assert.ok(
    menuSize.width <= 176 && menuSize.height <= 40,
    JSON.stringify(menuSize),
  );
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape" });
  await click(
    `document.querySelector('.im-member-permission-toggle[aria-label="允许 Morgan 派工"]')`,
  );
  await until(
    () =>
      evaluate(
        `!!document.querySelector('.im-member-permission-toggle[aria-label="禁止 Morgan 派工"]:not(:disabled)')`,
      ),
    "permission restored",
  );
  await inject("Follow up");
  await until(
    () =>
      evaluate(
        `window.artemis.getThreadEvents(${JSON.stringify(thread.id)}).then(events=>events.filter(e=>e.payload.type==='turn.completed').length===2)`,
      ),
    "same session second turn",
  );
  assert.equal(
    (await evaluate("window.artemis.getImStatus()")).remoteTasks.filter(
      (t) => t.parentThreadId,
    ).length,
    1,
  );
  await inject("/new CANCEL_ME");
  const cancelThread = await until(
    async () =>
      (await evaluate("window.artemis.getSnapshot()")).threads.find((t) =>
        t.title.includes("CANCEL_ME"),
      ),
    "cancellable task",
  );
  await click(
    `Array.from(document.querySelectorAll('.thread-select')).find(b=>b.textContent.includes('Slack · CANCEL_ME'))`,
  );
  await until(
    () =>
      evaluate(
        `document.querySelector('.conversation')?.innerText.includes('Working on cancellation test')`,
      ),
    "active cancellation task",
  );
  const buttons = await evaluate(
    `[...document.querySelectorAll('button')].filter(b=>b.getClientRects().length).map(b=>({label:b.getAttribute('aria-label'),title:b.getAttribute('title'),text:b.textContent}))`,
  );
  await writeFile(
    join(output, "buttons.json"),
    JSON.stringify(buttons, null, 2),
  );
  await click(`document.querySelector('button[title="停止"]')`);
  await until(
    () =>
      evaluate(
        `window.artemis.getThreadEvents(${JSON.stringify(cancelThread.id)}).then(events=>events.some(e=>e.payload.type==='turn.completed' && e.payload.reason==='cancelled'))`,
      ),
    "cancellation completion",
  );
  await until(
    () => evaluate(`!document.body.innerText.includes('思考中')`),
    "cancel clears thinking",
  );
  assert.ok(
    !(await evaluate("document.body.innerText")).includes(
      "Task has no active turn",
    ),
  );
  await click(
    `Array.from(document.querySelectorAll('.thread-select')).find(b=>b.textContent.includes('Slack · Explain the project'))`,
  );
  const records = [];
  for (const theme of ["light", "dark"]) {
    await evaluate(`window.artemis.setTheme(${JSON.stringify(theme)})`);
    for (const width of [1280, 720]) {
      await mainEvaluate(
        `${nativeContents}.getOwnerBrowserWindow().setMinimumSize(640,600);${nativeContents}.getOwnerBrowserWindow().setContentSize(${width},900)`,
      );
      await until(() => evaluate(`innerWidth===${width}`), "viewport");
      await until(
        () =>
          evaluate(
            "document.getAnimations().every(a=>a.playState!=='running'||a.effect.getComputedTiming().iterations===Infinity)",
          ),
        "animations settled",
      );
      await pause(300);
      await evaluate(
        "document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))",
      );
      assert.ok(
        await evaluate("document.documentElement.scrollWidth<=innerWidth+1"),
      );
      const shot = await send("Page.captureScreenshot", { format: "png" });
      const file = `${theme}-${width}.png`;
      await writeFile(join(output, file), Buffer.from(shot.data, "base64"));
      records.push(file);
    }
  }
  await mainEvaluate(
    `${nativeContents}.getOwnerBrowserWindow().setContentSize(1280,900)`,
  );
  await until(() => evaluate(`innerWidth===1280`), "wide viewport restored");
  await click(`document.querySelector('.rail-brand')`);
  await until(
    () =>
      evaluate(
        `document.querySelector('.left-sidebar-toggle')?.getAttribute('aria-expanded')==='true'`,
      ),
    "sidebar opened",
  );
  await until(
    () =>
      evaluate(
        `document.getAnimations().every(a=>a.playState!=='running'||a.effect.getComputedTiming().iterations===Infinity)`,
      ),
    "sidebar transition finished",
  );
  const openProjectMenu = async () => {
    await click(`document.querySelector('.project-action')`);
    await until(
      () => evaluate(`!!document.querySelector('.project-menu')`),
      "project menu",
    );
  };
  await openProjectMenu();
  await click(
    `[...document.querySelectorAll('.project-menu button')].find(b=>b.textContent.includes('归档全部'))`,
  );
  await until(
    () => evaluate(`!!document.querySelector('.confirmation-dialog')`),
    "archive confirmation",
  );
  await click(`document.querySelector('.confirmation-dialog .primary-button')`);
  await until(
    () =>
      evaluate(
        `window.artemis.getSnapshot().then(s=>s.threads.filter(t=>t.projectId===${JSON.stringify(thread.projectId)}).every(t=>t.archived))`,
      ),
    "all project threads archived",
  );
  await openProjectMenu();
  await click(
    `[...document.querySelectorAll('.project-menu button')].find(b=>b.textContent.includes('删除全部'))`,
  );
  await until(
    () => evaluate(`!!document.querySelector('.confirmation-dialog')`),
    "delete confirmation",
  );
  assert.ok(
    await evaluate(
      `document.querySelector('#confirmation-message').textContent.includes('包括已归档')`,
    ),
  );
  await click(`document.querySelector('.confirmation-dialog .primary-button')`);
  await until(
    () =>
      evaluate(
        `window.artemis.getSnapshot().then(s=>!s.threads.some(t=>t.projectId===${JSON.stringify(thread.projectId)}))`,
      ),
    "all project threads deleted",
  );
  assert.equal(exceptions.length, 0);
  assert.equal(consoleIssues.length, 0, JSON.stringify(consoleIssues));
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        passed: true,
        runtime,
        records,
        checks: [
          "project assignment",
          "normal timeline",
          "markdown",
          "terminal state",
          "final gateway reply",
          "stop click",
          "native Dock 1 to empty after viewing",
          "light/dark",
          "desktop/narrow",
          "no renderer errors",
          "member permission toggle",
          "compact permission menu",
          "project archive all",
          "project delete all including archived",
        ],
        realSlackDelivery: false,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, output }));
} catch (error) {
  await debugDump?.();
  await writeFile(
    join(output, "failure.log"),
    `${error.stack}\n${logs.slice(-12000)}`,
  );
  throw error;
} finally {
  model.close();
  socket?.close();
  mainSocket?.close();
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    child.once("exit", resolve);
    setTimeout(resolve, 3000);
  });
  await rm(temporary, { recursive: true, force: true });
}

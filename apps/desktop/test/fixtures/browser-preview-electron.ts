import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  app,
  BrowserWindow,
  ipcMain,
  nativeImage,
  webContents,
} from "electron";
import { ComputerBrowserDriver } from "../../src/main/computer-use/browser-driver.js";
import { BrowserSessionHost } from "../../src/main/workspace/browser-session-host.js";
import { IPC } from "../../src/shared/api.js";
import {
  browserPreviewCommandSchema,
  browserSessionCommandSchema,
} from "@artemis/protocol";

async function main() {
  const output = process.argv[2]!;
  app.setPath("userData", join(output, "profile"));
  await app.whenReady();
  let fixed = false;
  const server = createServer((request, response) => {
    if (request.url === "/failed") {
      request.socket.destroy();
      return;
    }
    if (request.url?.startsWith("/missing")) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end(
      `<!doctype html><meta name="viewport" content="width=device-width"><style>body{font:18px system-ui;background:#f3f6fa;margin:0;padding:32px}button{padding:16px;background:#163351;color:white;border:0;border-radius:8px}@media(max-width:500px){body{background:#dbeafe}}</style><h1>Preview fixture</h1><button id="save" onclick="document.title='Clicked'">Save</button><p id="layout"></p><script>const layout=()=>document.getElementById('layout').textContent=innerWidth;addEventListener('resize',layout);layout(); ${fixed ? "console.info('verified')" : "console.error('fixture error token=hidden');fetch('/missing?token=private');fetch('/failed').catch(()=>{});setTimeout(()=>{throw new Error('fixture exception')},100);"}</script>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/`;
  const window = new BrowserWindow({
    show: true,
    width: 1180,
    height: 900,
    webPreferences: {
      preload: join(output, "preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  let takeovers = 0;
  const driver = new ComputerBrowserDriver(
    async () => {
      throw new Error("Open UI first");
    },
    () => {
      takeovers += 1;
    },
  );
  const errors: string[] = [];
  const browsers = new BrowserSessionHost({
    navigationAllowed: (value) => /^(https?:|about:blank)/u.test(value),
    register: (contents, threadId) => driver.register(contents, threadId),
    input: (threadId, contentsId, input) =>
      driver.humanInput(threadId, contentsId, input),
    changed: (snapshot) =>
      window.webContents.send(IPC.browserSession, snapshot),
  });
  ipcMain.handle(IPC.browserSession, (event, input) => {
    assert.equal(event.sender, window.webContents);
    assert.equal(event.senderFrame, event.sender.mainFrame);
    return browsers.command(
      browserSessionCommandSchema.parse(input),
      event.sender,
    );
  });
  window.webContents.on("console-message", (event) => {
    if (event.level === "error") errors.push(event.message);
  });
  ipcMain.handle(
    "fixture-register",
    (_event, threadId: string, contentsId: number) =>
      driver.register(webContents.fromId(contentsId)!, threadId),
  );
  ipcMain.handle(
    "fixture-preview",
    (_event, threadId: string, contentsId: number, input: unknown) =>
      driver.preview(
        threadId,
        contentsId,
        browserPreviewCommandSchema.parse(input),
      ),
  );
  await window.loadFile(join(output, "index.html"), { query: { url } });
  const js = <T = any>(code: string): Promise<T> =>
    window.webContents.executeJavaScript(code);
  async function wait(code: string) {
    for (let i = 0; i < 100; i++) {
      if (await js(code)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    console.error("Renderer errors", errors);
    console.error("DOM", await js("document.body.innerText"));
    await writeFile(
      join(output, "failure.png"),
      (await window.webContents.capturePage()).toPNG(),
    );
    throw new Error(`Timed out: ${code}`);
  }
  const click = (text: string) =>
    js(
      `(()=>{const el=[...document.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')===${JSON.stringify(text)} || b.textContent.trim()===${JSON.stringify(text)}));if(!el)throw Error('Missing button: '+${JSON.stringify(text)});el.click()})()`,
    );
  const preset = async (label: string) => {
    await js(
      "document.querySelector('.browser-preview-preset [data-part=trigger]').click()",
    );
    await js(
      `(()=>{const item=[...document.querySelectorAll('.browser-preview-preset [role=option]')].find(el=>el.getAttribute('aria-label')===${JSON.stringify(label)} || el.textContent.replace('✓','').trim()===${JSON.stringify(label)});if(!item)throw Error('Missing preset');item.click()})()`,
    );
  };
  await wait(
    `!![...document.querySelectorAll('.browser-preview-toolbar button')].find(b=>b.getAttribute('aria-label')==='批注' && !b.disabled)`,
  );
  async function checkTooltips(width: number) {
    window.setSize(width, 900);
    await new Promise((resolve) => setTimeout(resolve, 200));
    for (const label of ["批注", "截图到草稿", "调试"]) {
      const selector = `.browser-preview-main-toolbar button[aria-label="${label}"]`;
      const point = await js<{ x: number; y: number }>(
        `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`,
      );
      window.webContents.sendInputEvent({ type: "mouseMove", ...point });
      await wait(
        `!![...document.querySelectorAll('[role="tooltip"]')].find(el=>el.textContent===${JSON.stringify(label)} && getComputedStyle(el).visibility==='visible')`,
      );
      assert(
        await js(
          `(()=>{const r=document.querySelector('[role="tooltip"]').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.top>=0})()`,
        ),
        "tooltip fits window",
      );
      await writeFile(
        join(output, `tooltip-${width}-${label}.png`),
        (await window.webContents.capturePage()).toPNG(),
      );
      window.webContents.sendInputEvent({ type: "mouseMove", x: 1, y: 1 });
      await js(`document.querySelector(${JSON.stringify(selector)}).focus()`);
      await wait(`!!document.querySelector('[role="tooltip"]')`);
      await js(`document.activeElement.blur()`);
      await wait(`!document.querySelector('[role="tooltip"]')`);
    }
  }
  await checkTooltips(1180);
  await checkTooltips(420);
  window.setSize(1180, 900);
  const contentsId = browsers.get("fixture", "preview").window.webContents.id;
  const guest = webContents.fromId(contentsId)!;
  const signal = new AbortController().signal;
  await driver.preview("fixture", contentsId, { action: "reload" });
  await wait(`!!document.querySelector('.browser-preview-error-dot')`);
  await new Promise((resolve) => setTimeout(resolve, 600));
  const logs = await driver.preview("fixture", contentsId, {
    action: "snapshot",
  });
  assert(
    logs.entries.some((entry) => entry.status === 404),
    JSON.stringify(logs.entries),
  );
  assert(
    logs.entries.some((entry) => entry.text.includes("fixture exception")),
  );
  assert(
    logs.entries.some(
      (entry) =>
        entry.source === "network" &&
        entry.level === "error" &&
        entry.url?.endsWith("/failed"),
    ),
    "failed request captured",
  );
  assert(!JSON.stringify(logs).includes("hidden"));
  assert(!JSON.stringify(logs).includes("private"));

  await click("调试");
  await wait(`!!document.querySelector('.browser-preview-log')`);
  assert(
    !(await js(
      `document.querySelector('.browser-preview-log').textContent.includes('font-weight: bold')`,
    )),
  );
  await click("截图到草稿");
  await wait(`document.body.dataset.hasImage==='true'`);
  assert.equal(
    await js(
      `document.querySelector('textarea[aria-label="Chat draft"]').value`,
    ),
    "",
    "plain screenshot adds only the attachment",
  );
  await writeFile(
    join(output, "screenshot-draft.png"),
    (await window.webContents.capturePage()).toPNG(),
  );
  await click("调试");
  await preset("1440 × 1100");
  await wait(`document.querySelector('.browser-preview-resize') !== null`);
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(await guest.executeJavaScript("innerWidth"), 1440);
  let screenshot = await driver.preview("fixture", contentsId, {
    action: "screenshot",
  });
  const image = nativeImage.createFromBuffer(
    Buffer.from(screenshot.image!.data, "base64"),
  );
  console.log("virtual viewport screenshot size", image.getSize());
  assert.equal(image.getSize().width, 1440);
  assert.equal(image.getSize().height, 1100);
  const target = await driver.open(
    { target: `browser:${contentsId}` },
    { threadId: "fixture", turnId: "turn", mode: "work" },
    signal,
  );
  const observed = await driver.observe(target, true, signal);
  const save = observed.elements.find(
    (element) => element.role === "button" && element.label === "Save",
  );
  assert(save);
  const beforeAiClick = takeovers;
  await driver.act(target, { type: "click", elementId: save.id }, signal);
  assert.equal(
    takeovers,
    beforeAiClick,
    "AI synthetic click does not trigger user takeover",
  );
  await wait(
    `document.querySelector('.browser-address-input').value === ${JSON.stringify(url)}`,
  );
  assert.equal(guest.getTitle(), "Clicked");
  await preset("390 × 844");
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(await guest.executeJavaScript("innerWidth"), 390);
  const before = await guest.executeJavaScript("document.title");
  await click("批注");
  const point = await guest.executeJavaScript(
    `(()=>{const r=document.querySelector('button').getBoundingClientRect();return {x:r.x+5,y:r.y+5}})()`,
  );
  const state = await driver.preview("fixture", contentsId, {
    action: "snapshot",
  });
  await js(
    `(()=>{const p=document.querySelector('.browser-preview-picker'),r=p.getBoundingClientRect();p.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.x+${point.x * state.viewport!.scale},clientY:r.y+${point.y * state.viewport!.scale}}))})()`,
  );
  await wait(`!!document.querySelector('.browser-preview-annotation')`);
  assert.equal(guest.getTitle(), before);
  assert.match(
    await js(
      `document.querySelector('.browser-preview-annotation').textContent`,
    ),
    /BUTTON/,
  );
  await click("加入草稿");
  await wait(
    `document.querySelector('textarea[aria-label="Chat draft"]').value.includes('BUTTON#save')`,
  );
  assert.match(
    await js(
      `document.querySelector('textarea[aria-label="Chat draft"]').value`,
    ),
    /BUTTON#save/,
  );
  await writeFile(
    join(output, "browser-narrow.png"),
    (await window.webContents.capturePage()).toPNG(),
  );
  await driver.preview("fixture", contentsId, { action: "devtools" });
  await assert.rejects(
    driver.preview("fixture", contentsId, { action: "screenshot" }),
    /DevTools/,
  );
  guest.closeDevTools();
  await new Promise((resolve) => setTimeout(resolve, 400));
  await driver.preview("fixture", contentsId, { action: "snapshot" });
  fixed = true;
  await driver.preview("fixture", contentsId, { action: "clear" });
  await driver.preview("fixture", contentsId, { action: "reload" });
  await new Promise((resolve) => setTimeout(resolve, 800));
  const verified = await driver.preview("fixture", contentsId, {
    action: "snapshot",
  });
  assert(!verified.entries.some((entry) => entry.level === "error"));
  assert.equal(await guest.executeJavaScript("innerWidth"), 390);
  await driver.preview("fixture", contentsId, { action: "screenshot" });
  assert.equal(
    await guest.executeJavaScript("innerWidth"),
    390,
    "screenshot preserves layout",
  );
  await js(
    `document.querySelector('.composer-context-picker [aria-haspopup="listbox"]').click()`,
  );
  await wait(`!!document.querySelector('[role="option"] small')`);
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.match(
    await js(`document.querySelector('[role="listbox"]').textContent`),
    /权限与 Work 相同/,
  );
  await writeFile(
    join(output, "mode-descriptions.png"),
    (await window.webContents.capturePage()).toPNG(),
  );
  await js(
    `document.querySelector('.composer-context-picker [aria-haspopup="listbox"]').click()`,
  );
  window.setSize(700, 850);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(
    await guest.executeJavaScript("innerWidth"),
    390,
    "host resize preserves virtual layout",
  );
  await writeFile(
    join(output, "browser-small-window.png"),
    (await window.webContents.capturePage()).toPNG(),
  );
  window.setSize(420, 850);
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(
    await js<number>(
      "document.querySelector('.browser-preview-main-toolbar').getBoundingClientRect().height",
    ),
    38,
  );
  assert(
    await js<boolean>(
      "(()=>{const r=document.querySelector('.browser-preview-main-toolbar').getBoundingClientRect();return [...document.querySelectorAll('.browser-preview-main-toolbar button')].filter(b=>b.getBoundingClientRect().width).every(b=>b.getBoundingClientRect().right<=r.right+1)})()",
    ),
    "narrow toolbar fits",
  );
  await click("响应式尺寸");
  await new Promise((resolve) => setTimeout(resolve, 250));
  await writeFile(
    join(output, "browser-420.png"),
    (await window.webContents.capturePage()).toPNG(),
  );
  await click("响应式尺寸");
  await js(
    "document.documentElement.dataset.artemisTheme='dark';document.documentElement.style.colorScheme='dark'",
  );
  await new Promise((resolve) => setTimeout(resolve, 250));
  await writeFile(
    join(output, "browser-dark.png"),
    (await window.webContents.capturePage()).toPNG(),
  );
  await js(
    "document.documentElement.dataset.artemisTheme='light';document.documentElement.style.colorScheme='light'",
  );
  await preset("跟随面板");
  await new Promise((resolve) => setTimeout(resolve, 300));
  const panelWidth = await js<number>(
    "document.querySelector('.browser-frame').clientWidth",
  );
  assert.equal(
    await guest.executeJavaScript("innerWidth"),
    panelWidth,
    "default follows panel",
  );
  window.setSize(980, 900);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(
    await guest.executeJavaScript("innerWidth"),
    await js<number>("document.querySelector('.browser-frame').clientWidth"),
    "follow mode tracks window resize",
  );
  await driver.preview("fixture", contentsId, {
    action: "viewport",
    viewport: { width: 1024, height: 768, scale: 0.5 },
  });
  assert.equal(
    await guest.executeJavaScript("innerWidth"),
    1024,
    "custom viewport",
  );
  const customImage = await driver.preview("fixture", contentsId, {
    action: "screenshot",
  });
  await writeFile(
    join(output, "custom-1024.jpg"),
    Buffer.from(customImage.image!.data, "base64"),
  );
  await preset("390 × 844");
  await new Promise((resolve) => setTimeout(resolve, 250));
  await js("document.querySelector('[data-remount]').click()");
  await wait(
    `!![...document.querySelectorAll('.browser-preview-toolbar button')].find(b=>b.getAttribute('aria-label')==='批注' && !b.disabled)`,
  );
  const reopened = browsers.get("fixture", "preview").window.webContents;
  assert.equal(
    reopened.id,
    contentsId,
    "React remount keeps the original browser instance",
  );
  assert.equal(
    await reopened.executeJavaScript("innerWidth"),
    390,
    "tab restores its own preference",
  );
  assert(!guest.isDestroyed(), "original tab survives remount");
  browsers.clearThread("fixture");
  const closedAt = Date.now();
  while (!guest.isDestroyed() && Date.now() - closedAt < 1000)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert(guest.isDestroyed(), "closing its task releases the original tab");
  await assert.rejects(
    driver.preview("fixture", contentsId, { action: "snapshot" }),
    /owned/,
  );
  assert.equal(
    await js<number>(
      "document.querySelector('.browser-preview-main-toolbar').getBoundingClientRect().height",
    ),
    38,
    "single compact toolbar row",
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        passed: true,
        platform: process.platform,
        screenshots: true,
        viewport: verified.viewport,
        checks: [
          "hover and keyboard tooltips at 1180 and 420 pixels",
          "1440 and 390 CSS layouts",
          "unscaled screenshot",
          "AI element click",
          "annotation blocks click",
          "draft with image",
          "console exception and 404",
          "DevTools pause and reconnect",
          "fix then same-condition recheck",
          "mode descriptions",
          "custom 1024 viewport and default follows window",
          "screenshot and host resize preserve virtual layout",
          "tab preference and instance preservation, then task cleanup",
          "failed network request",
        ],
        rendererErrors: errors,
      },
      null,
      2,
    ),
  );
  driver.dispose();
  browsers.dispose();
  window.destroy();
  server.close();
  app.quit();
}
main().catch((error) => {
  console.error(error);
  app.exit(1);
});

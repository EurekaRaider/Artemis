import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { app, BrowserWindow, ipcMain, type WebContents } from "electron";
import type { ComputerPreviewState } from "@artemis/protocol";
import type { ComputerPreviewHost } from "../../src/main/computer-use/preview-host.js";
import { ComputerPreviewWindow } from "../../src/main/computer-use/preview-window.js";
import { PreviewStream } from "../../src/main/computer-use/preview-stream.js";
import { IPC } from "../../src/shared/api.js";
import type { ComputerPreviewCommand } from "@artemis/protocol";

async function main() {
  const [evidence, preload, artwork, mainPreload] = process.argv.slice(2);
  app.setPath("userData", join(evidence!, "profile"));
  await app.whenReady();
  const main = new BrowserWindow({
    show: false,
    width: 492,
    height: 321,
    useContentSize: true,
    frame: false,
    backgroundColor: "#181818",
    webPreferences: {
      sandbox: true,
      ...(mainPreload ? { preload: mainPreload } : {}),
    },
  });
  const commands: { action: string; token?: string }[] = [];
  let progress = 0;
  const task = setInterval(() => progress++, 10);
  const state: ComputerPreviewState = {
    version: 1,
    sessionId: "synthetic-preview",
    threadId: "synthetic-task",
    target: {
      id: "desktop:fixture",
      kind: "desktop",
      name: "Synthetic preview interaction",
    },
    state: "live",
    timestamp: 0,
    sequence: 0,
    actualFps: 0,
  };
  let currentState = state;
  const source = new BrowserWindow({
    show: false,
    width: 1280,
    height: 816,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      offscreen: { useSharedTexture: true },
    },
  });
  const stream = new PreviewStream(
    state.sessionId,
    (visible) => {
      if (visible) {
        source.webContents.startPainting();
        source.webContents.invalidate();
      } else source.webContents.stopPainting();
    },
    (error) => {
      throw error;
    },
  );
  source.webContents.setFrameRate(60);
  source.webContents.on("paint", (event) => {
    if (event.texture)
      stream.push({
        textureInfo: event.texture.textureInfo,
        capturedAt: Date.now(),
        release: () => event.texture!.release(),
      });
  });
  // Optional artwork is the already user-provided reference, rendered by the demo page.
  const content = artwork
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="210 80 218 170" preserveAspectRatio="xMidYMid slice" width="100%" height="100%"><image width="492" height="322" href="data:image/png;base64,${(await readFile(artwork)).toString("base64")}"/></svg>`
    : '<div style="height:100%;background:linear-gradient(160deg,#b2d9e6 0 42%,#899c65 42% 60%,#5d856d 60%);display:grid;place-items:center;color:#fff;font:24px system-ui">Artemis</div>';
  // Keep fresh frames available when consumers switch on platforms that avoid
  // repainting an unchanged offscreen page after invalidate().
  await source.loadURL(
    `data:text/html,${encodeURIComponent("<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}#tick{position:absolute;right:0;bottom:0;width:1px;height:1px}</style>" + content + '<div id="tick"></div><script>let n=0;function tick(){document.getElementById("tick").style.backgroundColor=`rgb(${n++%256},128,128)`;requestAnimationFrame(tick)}tick()</script>')}`,
  );
  const floating = new ComputerPreviewWindow({
    main: () => main,
    locale: () => "zh-CN",
    host: () =>
      ({
        command(
          input: { action: string; token?: string },
          contents: WebContents,
        ) {
          commands.push(input);
          if (input.action === "subscribe")
            stream.subscribe(input.token!, contents);
          if (input.action === "unsubscribe") stream.unsubscribe(input.token!);
          if (input.action === "hide") {
            stream.removeContents(contents);
            currentState = { ...state, state: "hidden" };
            floating.update([currentState]);
            main.webContents.send(IPC.computerPreviews, [currentState]);
          }
        },
        removeContents(contents: WebContents) {
          stream.removeContents(contents);
        },
      }) as unknown as ComputerPreviewHost,
  });
  ipcMain.handle(IPC.computerPreviews, () => [currentState]);
  ipcMain.handle(
    IPC.computerPreview,
    (event, input: ComputerPreviewCommand) => {
      assert.equal(event.sender, main.webContents);
      commands.push(input);
      if (input.action === "subscribe")
        stream.subscribe(input.token, event.sender);
      if (input.action === "unsubscribe") stream.unsubscribe(input.token);
      if (input.action === "hide") {
        stream.removeContents(event.sender);
        currentState = { ...state, state: "hidden" };
        main.webContents.send(IPC.computerPreviews, [currentState]);
      }
      if (input.action === "show") {
        currentState = state;
        main.webContents.send(IPC.computerPreviews, [state]);
      }
    },
  );
  if (mainPreload) await main.loadFile(join(evidence!, "card.html"));
  // The production window resolves its dedicated preload beside this fixture.
  assert(preload?.endsWith("computer-preview-preload.cjs"));
  floating.setThread(state.threadId);
  floating.update([state]);
  const window = BrowserWindow.getAllWindows().find(
    (value) => value !== main && value !== source,
  )!;
  const until = async (condition: () => boolean | Promise<boolean>) => {
    const deadline = performance.now() + 5000;
    while (!(await condition())) {
      assert(
        performance.now() < deadline,
        "floating preview interaction timed out",
      );
      await delay(10);
    }
  };
  await until(() => window.isVisible());
  await until(() =>
    window.webContents.executeJavaScript(
      "document.querySelector('canvas').width > 300",
    ),
  );
  const layout = await window.webContents.executeJavaScript(`(() => {
    const close=document.getElementById('hide'), picture=document.querySelector('canvas');
    return {closeLabel:close.getAttribute('aria-label'),closeBounds:close.getBoundingClientRect().toJSON(),pictureBounds:picture.getBoundingClientRect().toJSON(),hasToolbar:!!document.querySelector('header,footer,#name,#control,#expand,#badge'),background:getComputedStyle(document.body).backgroundColor};
  })()`);
  assert.equal(layout.hasToolbar, false);
  assert.equal(layout.background, "rgba(0, 0, 0, 0)");
  assert(
    layout.closeBounds.x + layout.closeBounds.width / 2 ===
      layout.pictureBounds.x &&
      layout.closeBounds.y + layout.closeBounds.height / 2 ===
        layout.pictureBounds.y,
    "X is centered on the picture's upper-left vertex",
  );
  const hover = async (
    target: BrowserWindow,
    selector: string,
    x: number,
    y: number,
    visible: boolean,
  ) => {
    const bounds = target.getBounds();
    target.webContents.sendInputEvent({
      type: "mouseMove",
      x,
      y,
      globalX: bounds.x + x,
      globalY: bounds.y + y,
    });
    await until(() =>
      target.webContents.executeJavaScript(
        `(() => { const close=document.querySelector(${JSON.stringify(selector)});const blur=getComputedStyle(close.parentElement,'::after');return getComputedStyle(close).opacity === '${visible ? 1 : 0}' && blur.opacity === '${visible ? 1 : 0}' && blur.backdropFilter === 'blur(10px)';})()`,
      ),
    );
  };
  await hover(window, "#hide", -10, -10, false);
  await writeFile(
    join(evidence!, "floating.png"),
    (await window.webContents.capturePage())
      .resize({ width: window.getBounds().width })
      .toPNG(),
  );
  await hover(window, "#hide", 120, 60, true);
  await writeFile(
    join(evidence!, "floating-hover.png"),
    (await window.webContents.capturePage())
      .resize({ width: window.getBounds().width })
      .toPNG(),
  );
  await window.webContents.executeJavaScript(
    "document.getElementById('computer-preview-floating-canvas').click()",
  );
  await until(() => commands.some((value) => value.action === "expand"));
  const before = progress;
  await window.webContents.executeJavaScript(
    "document.getElementById('hide').click()",
  );
  await until(() => !window.isVisible());
  await delay(100);
  assert(
    progress > before,
    "the synthetic task keeps running after closing PiP",
  );
  floating.update([state]);
  currentState = state;
  main.webContents.send(IPC.computerPreviews, [state]);
  await until(() => window.isVisible());
  const resized = { ...window.getBounds(), width: 416, height: 268 };
  // Exercise the same private pointer commands sent by the production preload.
  const beforeDrag = window.getBounds();
  window.webContents.sendInputEvent({
    type: "mouseDown",
    x: 180,
    y: 120,
    globalX: beforeDrag.x + 180,
    globalY: beforeDrag.y + 120,
    button: "left",
    clickCount: 1,
  });
  window.webContents.sendInputEvent({
    type: "mouseMove",
    x: 80,
    y: 100,
    globalX: beforeDrag.x + 80,
    globalY: beforeDrag.y + 100,
  });
  await until(
    () =>
      window.getBounds().x < beforeDrag.x &&
      window.getBounds().y < beforeDrag.y,
  );
  window.webContents.sendInputEvent({
    type: "mouseUp",
    x: 80,
    y: 100,
    globalX: beforeDrag.x + 80,
    globalY: beforeDrag.y + 100,
    button: "left",
    clickCount: 1,
  });
  const expandCount = commands.filter(
    (value) => value.action === "expand",
  ).length;
  assert.equal(expandCount, 1, "dragging the picture does not expand it");
  const size = window.getBounds(),
    resizeX = size.width - 12,
    resizeY = size.height - 12;
  window.webContents.sendInputEvent({
    type: "mouseDown",
    x: resizeX,
    y: resizeY,
    globalX: size.x + resizeX,
    globalY: size.y + resizeY,
    button: "left",
    clickCount: 1,
  });
  window.webContents.sendInputEvent({
    type: "mouseMove",
    x: resizeX + 48,
    y: resizeY + 24,
    globalX: size.x + resizeX + 48,
    globalY: size.y + resizeY + 24,
  });
  await until(
    () =>
      window.getBounds().width === resized.width &&
      window.getBounds().height === resized.height,
  );
  window.webContents.sendInputEvent({
    type: "mouseUp",
    x: resizeX + 48,
    y: resizeY + 24,
    globalX: size.x + resizeX + 48,
    globalY: size.y + resizeY + 24,
    button: "left",
    clickCount: 1,
  });
  await delay(100);
  if (mainPreload) {
    main.show();
    main.focus();
    main.webContents.send(IPC.computerPreviews, [state]);
    await until(() =>
      main.webContents.executeJavaScript(
        "document.querySelector('canvas')?.width > 300",
      ),
    );
    await hover(main, ".computer-preview-close", 10, 300, false);
    await writeFile(
      join(evidence!, "card.png"),
      (await main.webContents.capturePage()).resize({ width: 492 }).toPNG(),
    );
    await hover(main, ".computer-preview-close", 180, 100, true);
    await writeFile(
      join(evidence!, "card-hover.png"),
      (await main.webContents.capturePage()).resize({ width: 492 }).toPNG(),
    );
    const countBefore = progress;
    await main.webContents.executeJavaScript(
      "document.querySelector('.computer-preview-close').click()",
    );
    await until(() =>
      main.webContents.executeJavaScript("!document.querySelector('canvas')"),
    );
    await delay(100);
    assert(progress > countBefore, "the in-app X also leaves the task running");
  }
  const result = {
    platform: process.platform,
    electron: process.versions.electron,
    layout,
    pictureClickRequestsExpand: true,
    closeHidesOnlyPreview: true,
    taskContinues: true,
    canShowAgain: true,
    pictureDragDoesNotExpand: true,
    customResize: true,
    hoverOnlyCloseAndBlur: true,
  };
  await writeFile(
    join(evidence!, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
  clearInterval(task);
  floating.dispose();
  stream.close();
  source.destroy();
  main.destroy();
  app.exit(0);
}
main().catch(async (error) => {
  console.error(error);
  const windows = await Promise.all(
    BrowserWindow.getAllWindows().map(async (window) => ({
      bounds: window.getBounds(),
      visible: window.isVisible(),
      page: await window.webContents
        .executeJavaScript(
          `({hidden:document.hidden,text:document.body.innerText,canvases:[...document.querySelectorAll('canvas')].map(c=>({width:c.width,height:c.height,bounds:c.getBoundingClientRect().toJSON()}))})`,
        )
        .catch(String),
    })),
  );
  await writeFile(
    join(process.argv[2]!, "diagnostic.json"),
    JSON.stringify(windows, null, 2),
  );
  app.exit(1);
});

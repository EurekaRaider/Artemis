import assert from "node:assert/strict";
import { app, BrowserWindow, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { BrowserSessionHost } from "../../src/main/workspace/browser-session-host.js";
import { ComputerBrowserDriver } from "../../src/main/computer-use/browser-driver.js";
import { ComputerNativeDriver } from "../../src/main/computer-use/native-driver.js";
import { NativePreviewSource } from "../../src/main/computer-use/native-preview.js";
import { PreviewStream } from "../../src/main/computer-use/preview-stream.js";
import { IPC } from "../../src/shared/api.js";
import { browserSessionCommandSchema } from "@artemis/protocol";

async function main() {
  const [evidence, preload, helper, module, duration] = process.argv.slice(2);
  app.setPath("userData", join(evidence!, "profile"));
  await app.whenReady();
  const failures: string[] = [],
    reports: { fps: number; p95Ms: number; sequence: number }[] = [];
  const humanInputs: unknown[] = [];
  const nativeToken = randomUUID(),
    nativeReports: typeof reports = [],
    memorySamples: unknown[] = [];
  const sink = new BrowserWindow({
    x: 80,
    y: 100,
    width: 1280,
    height: 720,
    useContentSize: true,
    frame: false,
    title: "Artemis GPU preview verification",
    webPreferences: {
      preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  const driver = new ComputerBrowserDriver(
    async () => browsers.forThread("fixture")!.window.webContents,
    () => {},
  );
  const browsers = new BrowserSessionHost({
    navigationAllowed: (url) => /^(http:|about:blank)/u.test(url),
    register: (contents, threadId) => driver.register(contents, threadId),
    input: async (threadId, contentsId, input) => {
      humanInputs.push(input);
      try {
        await driver.humanInput(threadId, contentsId, input);
      } catch (error) {
        failures.push(String(error));
        throw error;
      }
    },
    changed: (snapshot) => {
      if (!sink.isDestroyed())
        sink.webContents.send(IPC.browserSession, snapshot);
    },
  });
  ipcMain.handle(IPC.browserSession, (event, input) => {
    assert.equal(event.sender, sink.webContents);
    assert.equal(event.senderFrame, event.sender.mainFrame);
    return browsers.command(
      browserSessionCommandSchema.parse(input),
      event.sender,
    );
  });
  ipcMain.on(IPC.computerPreviewReport, (event, _token, report) => {
    if (event.sender === sink.webContents) {
      if (_token === nativeToken) nativeReports.push(report);
      else reports.push(report);
    }
  });
  sink.webContents.on("console-message", (event) => {
    if (event.level === "error") failures.push(event.message);
  });
  const content = `<style>body{margin:0;background:#142846;color:#fff;font:32px system-ui}input{font:24px system-ui;margin:20px;width:400px}#moving{width:160px;height:160px;background:#4dd9ba;animation:move 2s linear infinite alternate}@keyframes move{to{transform:translate(1050px,300px) rotate(180deg)}}</style><h1>Artemis continuous GPU preview</h1><input aria-label="Chinese input"><div id="moving"></div><script>window.originalInstance=Math.random();</script>`;
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(content);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  const tab = await browsers.open(
    "fixture",
    "original",
    `http://127.0.0.1:${address.port}/`,
  );
  await tab.window.webContents.executeJavaScript(
    "window.inputEvents=[];for(const name of ['mousedown','mouseup','focus','input'])document.addEventListener(name,e=>window.inputEvents.push({type:e.type,target:e.target.outerHTML,x:e.clientX,y:e.clientY}),true)",
  );
  const identity = await tab.window.webContents.executeJavaScript(
    "window.originalInstance",
  );
  await sink.loadFile(join(evidence!, "index.html"));
  await delay(2000);
  sink.setTitle("Artemis GPU preview verification");
  const mounted = await browsers.open("fixture", "original");
  assert.equal(mounted.window.webContents.id, tab.window.webContents.id);
  assert.equal(
    await mounted.window.webContents.executeJavaScript(
      "window.originalInstance",
    ),
    identity,
  );
  const foreign = await browsers.open("other-task", "other");
  assert.equal(
    browsers.owned("other-task", tab.window.webContents.id),
    undefined,
  );
  assert.notEqual(foreign.window.webContents.id, tab.window.webContents.id);
  const inputBounds = await tab.window.webContents.executeJavaScript(
    "(()=>{const r=document.querySelector('input').getBoundingClientRect();return {x:r.x+30,y:r.y+15}})()",
  );
  sink.webContents.sendInputEvent({
    type: "mouseDown",
    ...inputBounds,
    button: "left",
    clickCount: 1,
  });
  sink.webContents.sendInputEvent({
    type: "mouseUp",
    ...inputBounds,
    button: "left",
    clickCount: 1,
  });
  await delay(200);
  sink.webContents.insertText("你好 Artemis");
  await delay(500);
  const entered = await tab.window.webContents.executeJavaScript(
    "document.querySelector('input').value",
  );
  if (entered !== "你好 Artemis") {
    const image = await sink.webContents.capturePage();
    await writeFile(join(evidence!, "input-failure.png"), image.toPNG());
    console.log(
      JSON.stringify({
        humanInputs,
        inputBounds,
        inputEvents:
          await tab.window.webContents.executeJavaScript("window.inputEvents"),
        sourceFocus: await tab.window.webContents.executeJavaScript(
          "document.activeElement.outerHTML",
        ),
        sinkFocus: await sink.webContents.executeJavaScript(
          "document.activeElement.outerHTML",
        ),
        failures,
        reports,
      }),
    );
  }
  assert.equal(entered, "你好 Artemis", "production canvas text forwarding");
  const native = new ComputerNativeDriver(
    helper!,
    () => {},
    () => "Stop",
    undefined,
    () => {},
  );
  const readiness = await native.permissions();
  let nativeResult: unknown = { completed: false, readiness };
  let nativeSource: NativePreviewSource | undefined;
  const nativeStream = new PreviewStream(
    randomUUID(),
    () => {},
    (error) => failures.push(String(error)),
  );
  let nativeCount = 0,
    nativeErrors: string[] = [];
  let leaseReleased = false;
  if (readiness.accessibility && readiness.screenRecording) {
    const target = {
      id: "desktop:com.github.Electron",
      kind: "desktop" as const,
      name: "Preview fixture",
      bundleId: "com.github.Electron",
    };
    const context = {
      threadId: "native-fixture",
      turnId: "turn",
      mode: "work" as const,
    };
    await native.open(
      { target: target.bundleId },
      context,
      new AbortController().signal,
    );
    await native.observe(target, false, new AbortController().signal);
    assert.equal(
      (await native.previewIdentity(target)).pid,
      process.pid,
      "capture only this verification application's window",
    );
    const source = new NativePreviewSource(native, async () => ({
      path: helper!,
      previewPath: module!,
      release() {
        leaseReleased = true;
      },
    }));
    await sink.webContents.executeJavaScript(
      `{const canvas=document.createElement('canvas');canvas.id='native-fixture';canvas.style='position:fixed;right:20px;bottom:20px;width:360px;height:240px;background:#10141b';document.body.append(canvas);window.artemis.bindPreviewCanvas('${nativeToken}',canvas.id);}`,
    );
    nativeStream.subscribe(nativeToken, sink.webContents);
    nativeSource = source;
    await source.start(target, 1280, (frame) => {
      nativeCount++;
      if (frame.error) {
        nativeErrors.push(frame.error);
        frame.release();
        return;
      }
      nativeStream.push({
        textureInfo: {
          pixelFormat: "bgra",
          codedSize: { width: frame.width, height: frame.height },
          handle: {
            ...(frame.ioSurface ? { ioSurface: frame.ioSurface } : {}),
            ...(frame.ntHandle ? { ntHandle: frame.ntHandle } : {}),
          },
        },
        capturedAt: frame.capturedAt,
        release: frame.release,
      });
    });
  }
  const startingMetrics = app.getAppMetrics();
  const sample = () => {
    memorySamples.push({
      timestamp: Date.now(),
      main: process.memoryUsage(),
      processes: app.getAppMetrics(),
    });
    void writeFile(
      join(evidence!, "progress.json"),
      JSON.stringify({
        timestamp: Date.now(),
        reports: reports.slice(-10),
        nativeReports: nativeReports.slice(-10),
        nativeCount,
        nativeErrors,
        failures,
        memorySamples,
      }),
    );
  };
  sample();
  const sampleTimer = setInterval(sample, 15000);
  await delay(Number(duration ?? 12) * 1000);
  clearInterval(sampleTimer);
  sample();
  const stoppedAt = performance.now();
  nativeSource?.stop();
  nativeStream.close();
  await sink.webContents.executeJavaScript(
    `window.artemis.unbindPreviewCanvas('${nativeToken}');document.querySelector('#native-fixture')?.remove()`,
  );
  while (nativeSource && !leaseReleased && performance.now() - stoppedAt < 1000)
    await delay(10);
  const stopMs = performance.now() - stoppedAt;
  nativeResult = nativeSource
    ? {
        completed: !nativeErrors.length && nativeCount > 0,
        count: nativeCount,
        errors: nativeErrors,
        reports: nativeReports.slice(3),
        stopMs,
        leaseReleased,
      }
    : nativeResult;
  const animationReports = reports.slice(3);
  const screenshot = await sink.webContents.capturePage();
  await writeFile(join(evidence!, "browser.png"), screenshot.toPNG());
  const listeners = tab.window.webContents.listenerCount("paint");
  await sink.webContents.executeJavaScript(
    "document.querySelector('#root').style.display='none'",
  );
  const hiddenAt = performance.now();
  while (
    tab.window.webContents.isPainting() &&
    performance.now() - hiddenAt < 1000
  )
    await delay(10);
  const hiddenStopMs = performance.now() - hiddenAt;
  assert.equal(
    tab.window.webContents.isPainting(),
    false,
    "hidden final consumer stops painting within one second",
  );
  await sink.webContents.executeJavaScript(
    "document.querySelector('#root').style.display='block'",
  );
  await delay(1000);
  assert.equal(tab.window.webContents.isPainting(), true);
  assert.equal(tab.window.webContents.listenerCount("paint"), listeners);
  assert.equal(
    await tab.window.webContents.executeJavaScript("window.originalInstance"),
    identity,
  );
  await native.close();
  const result = {
    electron: process.versions.electron,
    animationReports,
    input: entered,
    stableInstance: true,
    hiddenStopsPainting: true,
    hiddenStopMs,
    listeners,
    startingMetrics,
    memorySamples,
    finalMetrics: app.getAppMetrics(),
    native: nativeResult,
    failures,
  };
  await writeFile(
    join(evidence!, "report.json"),
    JSON.stringify(result, null, 2),
  );
  const averageFps =
    animationReports.reduce((sum, r) => sum + r.fps, 0) /
    animationReports.length;
  assert(
    averageFps >= 55,
    `Preview average fps ${averageFps} below acceptance`,
  );
  assert(
    Math.max(...animationReports.map((r) => r.p95Ms)) <= 150,
    "Preview display latency exceeds acceptance",
  );
  assert.deepEqual(failures, [], "renderer and GPU stream errors");
  assert(
    nativeSource,
    "Native preview requires Screen Recording and Accessibility permissions",
  );
  assert.deepEqual(nativeErrors, [], "native capture errors");
  const nativeAverageFps =
    nativeReports.slice(3).reduce((sum, r) => sum + r.fps, 0) /
    Math.max(1, nativeReports.length - 3);
  assert(
    nativeAverageFps >= 55,
    `Native preview average fps ${nativeAverageFps} below acceptance`,
  );
  assert(
    Math.max(...nativeReports.slice(3).map((r) => r.p95Ms)) <= 150,
    "Native preview display latency exceeds acceptance",
  );
  assert(
    leaseReleased && stopMs <= 1000,
    `Native capture and GPU resources did not stop in time: ${stopMs}ms`,
  );
  console.log(
    JSON.stringify({
      averageFps:
        animationReports.reduce((sum, r) => sum + r.fps, 0) /
        animationReports.length,
      maximumP95Ms: Math.max(...animationReports.map((r) => r.p95Ms)),
      input: entered,
      native: {
        completed: nativeSource
          ? !nativeErrors.length && nativeCount > 0
          : false,
        count: nativeCount,
        errors: nativeErrors,
        averageFps:
          nativeReports.slice(3).reduce((sum, r) => sum + r.fps, 0) /
          Math.max(1, nativeReports.length - 3),
        maximumP95Ms: Math.max(0, ...nativeReports.map((r) => r.p95Ms)),
      },
      failures,
    }),
  );
  browsers.dispose();
  server.close();
  sink.destroy();
  app.quit();
}
void main().catch((error) => {
  console.error(error);
  app.exit(1);
});

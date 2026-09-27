import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { app, BrowserWindow } from "electron";
import { ComputerBrowserDriver } from "../../src/main/computer-use/browser-driver.js";
import { ComputerNativeDriver } from "../../src/main/computer-use/native-driver.js";
import { ComputerUseService } from "../../src/main/computer-use/service.js";

async function main() {
  const [helper, evidence, fixtureApp, fixtureBundle] = process.argv.slice(2);
  console.log("Computer Use: starting isolated Electron fixture");
  app.setPath("userData", `${evidence}/electron-profile`);
  app.disableHardwareAcceleration();
  await app.whenReady();
  console.log("Computer Use: Electron ready");
  const errors: string[] = [];
  const fixture = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(
      `<!doctype html><html><head><title>Computer Use fixture</title></head><body style="font:18px system-ui;padding:40px"><h1>Computer Use validation</h1><label>Name <input aria-label="Name"></label><button onclick="document.querySelector('output').textContent='Saved: '+document.querySelector('input').value">Save draft</button><output></output><p><a href="/next">Next page</a></p></body></html>`,
    );
  });
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  const address = fixture.address();
  assert(address && typeof address !== "string");
  const window = new BrowserWindow({
    show: false,
    width: 1000,
    height: 760,
    webPreferences: {
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  window.webContents.on("console-message", (event) => {
    if (event.level === "error") errors.push(event.message);
  });
  let service: ComputerUseService;
  const browser = new ComputerBrowserDriver(
    async () => window.webContents,
    (id) => service.stopThread(id, "User took control"),
  );
  browser.register(window.webContents, "fixture");
  const native = new ComputerNativeDriver(helper!, () => {});
  service = new ComputerUseService({
    drivers: { browser, desktop: native },
    authorize: async (target) =>
      target.kind === "browser" || target.bundleId === fixtureBundle,
    publish: () => {},
  });
  const context = {
    threadId: "fixture",
    turnId: "turn",
    mode: "execute" as const,
  };
  let nativeFixture: ChildProcess | undefined;
  try {
    let observation = await service.open(
      { target: "browser", url: `http://127.0.0.1:${address.port}/` },
      context,
    );
    assert(
      observation.image?.data &&
        observation.elements.some(
          (element) => element.label === "Computer Use validation",
        ),
    );
    const textbox = observation.elements.find(
      (element) => element.role === "textbox" && element.label === "Name",
    );
    assert(textbox);
    const filled = await service.act(
      {
        targetId: observation.target.id,
        observationId: observation.observationId,
        actions: [
          { type: "fill", elementId: textbox.id, text: "Artemis 测试" },
        ],
      },
      context,
    );
    assert.equal(filled.completed, 1);
    assert.notEqual(filled.stopped, "verification-failed");
    assert.equal(
      filled.elements.find((element) => element.id === textbox.id)?.value,
      "Artemis 测试",
    );
    const button = filled.elements.find(
      (element) => element.label === "Save draft" && element.role === "button",
    );
    assert(button);
    const clicked = await service.act(
      {
        targetId: filled.target.id,
        observationId: filled.observationId,
        actions: [
          { type: "click", elementId: button.id },
          { type: "key", key: "Tab" },
        ],
      },
      context,
    );
    assert.equal(clicked.completed, 1);
    assert.equal(clicked.stopped, "interface-changed");
    assert(
      clicked.elements.some((element) =>
        element.label.includes("Saved: Artemis 测试"),
      ),
    );
    await writeFile(
      `${evidence}/browser.png`,
      (await window.webContents.capturePage()).toPNG(),
    );
    const timings: number[] = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      observation = (await service.call(
        "computer_observe",
        { targetId: observation.target.id },
        context,
      )) as typeof observation;
      timings.push(performance.now() - start);
    }
    service.stopThread("fixture");
    await assert.rejects(
      service.act(
        {
          targetId: observation.target.id,
          observationId: observation.observationId,
          actions: [{ type: "key", key: "Enter" }],
        },
        context,
      ),
      /owned/,
    );
    assert.deepEqual(errors, []);
    const permissions = await native.permissions(); // Reads state only; never prompts or captures personal apps.
    let nativeVerified = false;
    if (permissions.accessibility && permissions.screenRecording) {
      nativeFixture = spawn(`${fixtureApp}/Contents/MacOS/fixture`, [], {
        stdio: "inherit",
      });
      const nativeContext = { ...context, turnId: "native-turn" };
      let nativeObservation;
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          nativeObservation = await service.open(
            { target: fixtureBundle! },
            nativeContext,
          );
          break;
        } catch (error) {
          if (attempt === 9) throw error;
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }
      assert(nativeObservation?.image);
      const input = nativeObservation.elements.find(
        (element) => element.role === "AXTextField",
      );
      assert(input);
      const filledNative = await service.act(
        {
          targetId: nativeObservation.target.id,
          observationId: nativeObservation.observationId,
          actions: [
            { type: "fill", elementId: input.id, text: "Artemis 原生验证" },
          ],
        },
        nativeContext,
      );
      assert.equal(
        filledNative.elements.find((element) => element.id === input.id)?.value,
        "Artemis 原生验证",
      );
      const save = filledNative.elements.find(
        (element) => element.label === "Save draft",
      );
      assert(save);
      const saved = await service.act(
        {
          targetId: filledNative.target.id,
          observationId: filledNative.observationId,
          actions: [{ type: "click", elementId: save.id }],
        },
        nativeContext,
      );
      assert(
        saved.elements.some((element) =>
          element.label.includes("Saved: Artemis 原生验证"),
        ),
      );
      await writeFile(
        `${evidence}/native.jpg`,
        Buffer.from(saved.image!.data, "base64"),
      );
      nativeVerified = true;
    }
    const result = {
      checks: [
        "real Chromium AX observation",
        "Unicode form fill and value verification",
        "element click",
        "batch stops on interface change",
        "task Stop rejects further input",
        "native private-pipe status",
      ],
      observeP95Ms: timings.toSorted((a, b) => a - b)[18],
      nativePermissions: permissions,
      nativeVerified,
      errors,
    };
    await writeFile(`${evidence}/result.json`, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally {
    nativeFixture?.kill();
    service.stopAll();
    native.dispose();
    window.destroy();
    fixture.close();
    app.quit();
  }
}
void main().catch((error) => {
  console.error(error);
  app.exit(1);
});

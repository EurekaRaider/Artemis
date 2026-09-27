import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { app, BrowserWindow, screen, type WebContents } from "electron";
import { ComputerBrowserDriver } from "../../src/main/computer-use/browser-driver.js";
import { ComputerNativeDriver } from "../../src/main/computer-use/native-driver.js";
import { ComputerUseService } from "../../src/main/computer-use/service.js";

async function main() {
  const [helper, evidence, fixtureApp, fixtureBundle] = process.argv.slice(2);
  console.log("Computer Use: starting isolated Electron fixture");
  app.setPath("userData", `${evidence}/electron-profile`);
  await app.whenReady();
  console.log("Computer Use: Electron ready");
  const errors: string[] = [];
  const fixture = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    if (_request.url === "/host") {
      response.end(
        `<!doctype html><textarea autofocus>Host draft</textarea><webview src="/" style="display:flex;width:950px;height:680px"></webview>`,
      );
      return;
    }
    response.end(
      `<!doctype html><html><head><title>Computer Use fixture</title></head><body style="font:18px system-ui;padding:40px"><h1>Computer Use validation</h1><label>Name <input aria-label="Name"></label><label>City <input aria-label="City"></label><label>Notes <textarea aria-label="Notes"></textarea></label><button onclick="document.querySelector('output').textContent='Saved: '+document.querySelector('input').value">Save draft</button><output></output><p><a href="/next">Next page</a></p></body></html>`,
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
      webviewTag: true,
    },
  });
  const attached = new Promise<WebContents>((resolve) =>
    window.webContents.once("did-attach-webview", (_event, guest) =>
      resolve(guest),
    ),
  );
  await window.loadURL(`http://127.0.0.1:${address.port}/host`);
  const page = await attached;
  let captureRecoveries = 0;
  const capturePage = page.capturePage.bind(page);
  page.capturePage = async (...args) => {
    try {
      return await capturePage(...args);
    } catch (error) {
      if (
        /UnknownVizError|Current display surface not available for capture/u.test(
          String(error),
        )
      )
        captureRecoveries++;
      throw error;
    }
  };
  if (page.isLoading())
    await new Promise<void>((resolve) =>
      page.once("did-finish-load", () => resolve()),
    );
  await window.webContents.executeJavaScript(
    'document.querySelector("textarea").focus()',
  );
  window.webContents.on("console-message", (event) => {
    if (event.level === "error") errors.push(event.message);
  });
  let service: ComputerUseService;
  const verifyCalculator = process.env.ARTEMIS_VERIFY_CALCULATOR === "1";
  const browser = new ComputerBrowserDriver(
    async () => page,
    (id) => service.stopThread(id, "User took control"),
  );
  browser.register(page, "fixture");
  const native = new ComputerNativeDriver(helper!, (reason) =>
    service.stopDesktop(reason),
  );
  service = new ComputerUseService({
    drivers: { browser, desktop: native },
    authorize: async (target) =>
      target.kind === "browser" ||
      target.bundleId === fixtureBundle ||
      (verifyCalculator && target.bundleId === "com.apple.calculator"),
    publish: () => {},
  });
  const context = {
    threadId: "fixture",
    turnId: "turn",
    mode: "execute" as const,
  };
  let nativeFixture: ChildProcess | undefined;
  try {
    // Reproduce the real dock's 640 ms opening transition while navigation
    // is already ready. The first observation must describe its final width.
    await window.webContents.executeJavaScript(`
      const guest = document.querySelector("webview");
      guest.style.transition = "width 640ms linear";
      guest.style.width = "600px";
    `);
    let observation = await service.open(
      { target: "browser", url: `http://127.0.0.1:${address.port}/` },
      context,
    );
    assert.equal(observation.width, 600);
    assert.equal(observation.target.name, "Computer Use fixture");
    await window.webContents.executeJavaScript(
      'document.querySelector("webview").style.transition = "none"',
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
    const cursorBefore = screen.getCursorScreenPoint();
    const batchStarted = performance.now();
    const filled = await service.act(
      {
        targetId: observation.target.id,
        observationId: observation.observationId,
        actions: [
          { type: "fill", elementId: textbox.id, text: "Artemis 测试" },
          {
            type: "fill",
            elementId: observation.elements.find(
              (e) => e.label === "City" && e.role === "textbox",
            )!.id,
            text: "上海",
          },
          {
            type: "fill",
            elementId: observation.elements.find(
              (e) => e.label === "Notes" && e.role === "textbox",
            )!.id,
            text: "后台输入",
          },
        ],
      },
      context,
    );
    const fillBatchMs = performance.now() - batchStarted;
    assert.equal(filled.completed, 3);
    assert.notEqual(filled.stopped, "verification-failed");
    assert.equal(window.isVisible(), false);
    assert.equal(window.isFocused(), false);
    assert.deepEqual(screen.getCursorScreenPoint(), cursorBefore);
    assert.equal(
      await window.webContents.executeJavaScript(
        'document.querySelector("textarea").value',
      ),
      "Host draft",
    );
    assert.equal(
      filled.elements.find((element) => element.id === textbox.id)?.value,
      "Artemis 测试",
    );
    const replaced = await service.act(
      {
        targetId: filled.target.id,
        observationId: filled.observationId,
        actions: [{ type: "fill", elementId: textbox.id, text: "替换旧值" }],
      },
      context,
    );
    assert.equal(
      replaced.elements.find((e) => e.id === textbox.id)?.value,
      "替换旧值",
    );
    const button = filled.elements.find(
      (element) => element.label === "Save draft" && element.role === "button",
    );
    assert(button);
    const clicked = await service.act(
      {
        targetId: replaced.target.id,
        observationId: replaced.observationId,
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
        element.label.includes("Saved: 替换旧值"),
      ),
    );
    await writeFile(
      `${evidence}/browser.png`,
      (await page.capturePage()).toPNG(),
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
    console.log(
      "Computer Use: GPU capture across navigation and webview visibility/size changes",
    );
    for (let i = 0; i < 12; i++) {
      await window.webContents.executeJavaScript(
        'document.querySelector("webview").style.display = "none"',
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      await window.webContents.executeJavaScript(
        `Object.assign(document.querySelector("webview").style, {display:"flex",width:"${i % 2 ? 950 : 600}px"})`,
      );
      observation = await service.open(
        {
          target: "browser",
          url: `http://127.0.0.1:${address.port}/?iteration=${i}`,
        },
        context,
      );
      assert(observation.image?.data);
      assert(
        observation.elements.some(
          (e) => e.label === "Name" && e.role === "textbox",
        ),
      );
      assert.equal(window.isVisible(), false);
      assert.equal(window.isFocused(), false);
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
      /paused/,
    );
    assert.deepEqual(errors, []);
    const permissions = await native.permissions(); // Reads state only; never prompts or captures personal apps.
    let nativeVerified = false;
    if (permissions.accessibility && permissions.screenRecording) {
      nativeFixture = spawn(`${fixtureApp}/Contents/MacOS/fixture`, [], {
        stdio: ["ignore", "pipe", "inherit"],
      });
      await new Promise<void>((resolve, reject) => {
        nativeFixture!.once("error", reject);
        nativeFixture!.stdout!.on("data", (chunk) => {
          if (String(chunk).includes("Synthetic app launching")) resolve();
        });
      });
      const nativeContext = { ...context, turnId: "native-turn" };
      console.log("Computer Use: opening delayed native fixture");
      const nativeObservation = await service.open(
        { target: fixtureBundle! },
        nativeContext,
      );
      assert(nativeObservation?.image);
      assert.equal(nativeObservation.foreground, false);
      console.log("Computer Use: native background fill and click");
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
      assert.equal(saved.foreground, false);
      console.log("Computer Use: native dynamic container batch");
      const toggle = saved.elements.find((e) => e.label === "Toggle container");
      assert(toggle);
      const dynamicBatch = await service.act(
        {
          targetId: saved.target.id,
          observationId: saved.observationId,
          actions: [
            { type: "click", elementId: toggle.id },
            { type: "fill", elementId: input.id, text: "稳定控件 ID" },
            { type: "click", elementId: save.id },
          ],
        },
        nativeContext,
      );
      assert.equal(dynamicBatch.completed, 3);
      assert(
        dynamicBatch.elements.some((e) =>
          e.label.includes("Saved: 稳定控件 ID"),
        ),
      );
      await assert.rejects(
        native.act(
          saved.target,
          { type: "key", key: "Enter" },
          new AbortController().signal,
        ),
        /foreground-required/,
      );
      assert.equal(
        (
          await native.observe(
            saved.target,
            false,
            new AbortController().signal,
          )
        ).foreground,
        false,
      );
      await writeFile(
        `${evidence}/native.jpg`,
        Buffer.from(saved.image!.data, "base64"),
      );
      nativeVerified = true;
    }
    let calculatorBatchMs: number | undefined;
    if (verifyCalculator && nativeVerified) {
      service.stopThread(context.threadId, "Turn ended");
      const calculatorContext = { ...context, turnId: "calculator-turn" };
      console.log("Computer Use: real Calculator seven-step batch");
      const calculator = await service.open(
        { target: "com.apple.calculator" },
        calculatorContext,
      );
      const clear = calculator.elements.find((e) =>
        /^(全部清除|清除|All Clear|Clear)$/iu.test(e.label),
      );
      assert(clear);
      const frames: unknown[] = [];
      const observe = native.observe.bind(native);
      native.observe = async (...args) => {
        const frame = await observe(...args);
        frames.push({ ...frame, image: undefined });
        return frame;
      };
      try {
        // Repeated reads used to shift every button ID when an unlabelled AX node appeared.
        for (let i = 0; i < 10; i++) {
          const fresh = await native.observe(
            calculator.target,
            false,
            new AbortController().signal,
          );
          for (const button of calculator.elements.filter(
            (e) => e.role === "AXButton",
          ))
            assert(
              fresh.elements.some(
                (e) => e.id === button.id && e.label === button.label,
              ),
            );
        }
        const actions = [
          /^2$/u,
          /^3$/u,
          /^(乘|Multiply)$/iu,
          /^1$/u,
          /^7$/u,
          /^(等于|Equals)$/iu,
        ].map((pattern) => {
          const button = calculator.elements.find(
            (e) => e.role === "AXButton" && pattern.test(e.label),
          );
          assert(button, String(pattern));
          return { type: "click" as const, elementId: button.id };
        });
        actions.unshift({ type: "click", elementId: clear.id });
        const start = performance.now();
        const calculated = await service.act(
          {
            targetId: calculator.target.id,
            observationId: calculator.observationId,
            actions,
          },
          calculatorContext,
        );
        calculatorBatchMs = performance.now() - start;
        assert.equal(
          calculated.completed,
          7,
          JSON.stringify({ stopped: calculated.stopped, frames }),
        );
        assert.equal(calculated.foreground, false);
        assert(
          calculated.elements.some((e) => e.value === "391"),
          JSON.stringify(calculated.elements),
        );
        if (calculated.image)
          await writeFile(
            `${evidence}/calculator.jpg`,
            Buffer.from(calculated.image.data, "base64"),
          );
      } finally {
        await writeFile(
          `${evidence}/calculator-frames.json`,
          JSON.stringify(frames, null, 2),
        );
        native.observe = observe;
      }
    }
    const result = {
      checks: [
        "real Chromium AX observation",
        "embedded webview fills three fields without system focus or pointer changes",
        "replaces an existing value instead of appending",
        "Unicode form fill and value verification",
        "element click",
        "batch stops on interface change",
        "task Stop rejects further input",
        "12 GPU captures across navigation and hidden/resized webview transitions",
        "native private-pipe status",
        ...(nativeVerified
          ? [
              "native delayed window readiness and background AX fill/click",
              "native foreground input denied without host approval",
              "native stable element IDs across transient unlabelled AX containers",
            ]
          : []),
        ...(calculatorBatchMs === undefined
          ? []
          : [
              "real Calculator clear + 23 × 17 = 391 in one seven-step background batch",
            ]),
      ],
      observeP95Ms: timings.toSorted((a, b) => a - b)[18],
      fillBatchMs,
      captureRecoveries,
      calculatorBatchMs,
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

import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { dirname, join } from "node:path";
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { app, BrowserWindow, screen, type WebContents } from "electron";
import { ComputerBrowserDriver } from "../../src/main/computer-use/browser-driver.js";
import { ComputerNativeDriver } from "../../src/main/computer-use/native-driver.js";
import { ComputerUseService } from "../../src/main/computer-use/service.js";
import { verifyNativeSecurity } from "./computer-use-native-security.js";

async function main() {
  const [helper, evidence, fixtureApp, fixtureBundle] = process.argv.slice(2);
  console.log("Computer Use: starting isolated Electron fixture");
  app.setPath("userData", `${evidence}/electron-profile`);
  await app.whenReady();
  if (process.env.ARTEMIS_VERIFY_ELECTRON === "1")
    app.setAccessibilitySupportEnabled(true);
  console.log("Computer Use: Electron ready");
  const nativeSecurityChecks =
    process.platform === "win32"
      ? await verifyNativeSecurity(helper!, evidence!)
      : [];
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
  let nativeForegroundGranted = false;
  let foregroundRequests = 0;
  let longNativeBatchMs: number | undefined;
  const verifyCalculator = process.env.ARTEMIS_VERIFY_CALCULATOR === "1";
  const verifyElectron = process.env.ARTEMIS_VERIFY_ELECTRON === "1";
  const electronBundle =
    process.platform === "darwin"
      ? execFileSync(
          "/usr/libexec/PlistBuddy",
          [
            "-c",
            "Print:CFBundleIdentifier",
            join(dirname(dirname(process.execPath)), "Info.plist"),
          ],
          { encoding: "utf8" },
        ).trim()
      : "";
  const inputDiagnostics: Record<string, unknown>[] = [];
  const browser = new ComputerBrowserDriver(
    async () => page,
    (threadId, targetId) =>
      service.stopTargets(
        (target) => target.id === targetId,
        threadId,
        "User took control",
      ),
  );
  browser.register(page, "fixture");
  const native = new ComputerNativeDriver(
    helper!,
    (reason) => service.stopDesktop(reason),
    undefined,
    undefined,
    (event) => inputDiagnostics.push(event),
  );
  service = new ComputerUseService({
    drivers: { browser, desktop: native },
    authorize: async (target) =>
      target.kind === "browser" ||
      (target.appId ?? target.bundleId) === fixtureBundle ||
      (verifyElectron && target.bundleId === electronBundle) ||
      (verifyCalculator && target.bundleId === "com.apple.calculator"),
    foregroundGranted: (target) =>
      (target.appId ?? target.bundleId) === fixtureBundle &&
      nativeForegroundGranted,
    authorizeForeground: async (target) => {
      const allowed =
        (target.appId ?? target.bundleId) === fixtureBundle ||
        (verifyElectron && target.bundleId === electronBundle);
      if (allowed) {
        nativeForegroundGranted = true;
        foregroundRequests++;
      }
      return allowed;
    },
    publish: () => {},
  });
  const context = {
    threadId: "fixture",
    turnId: "turn",
    mode: "work" as const,
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
      nativeFixture = spawn(
        process.platform === "win32"
          ? fixtureApp!
          : `${fixtureApp}/Contents/MacOS/fixture`,
        [],
        {
          stdio: [
            process.platform === "win32" ? "pipe" : "ignore",
            "pipe",
            "inherit",
          ],
        },
      );
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
      assert(
        !JSON.stringify(nativeObservation).includes("PRIVATE_FIXTURE_VALUE"),
      );
      if (process.platform === "win32") {
        assert.equal(nativeObservation.target.appId, fixtureBundle);
        assert.equal(nativeObservation.target.bundleId, undefined);
      }
      console.log("Computer Use: native background fill and click");
      const input = nativeObservation.elements.find(
        (element) =>
          element.role ===
          (process.platform === "win32" ? "UIA:50004" : "AXTextField"),
      );
      assert(input);
      let editingObservation = nativeObservation;
      if (process.platform === "win32") {
        await assert.rejects(
          native.act(
            nativeObservation.target,
            { type: "fill", elementId: input.id, text: "Unapproved" },
            new AbortController().signal,
          ),
          /foreground-required/,
        );
        const unchanged = await native.observe(
          nativeObservation.target,
          false,
          new AbortController().signal,
        );
        assert.equal(unchanged.foreground, false);
        assert.equal(
          unchanged.elements.find((element) => element.id === input.id)?.value,
          "",
        );
        const button = unchanged.elements.find(
          (element) => element.label === "Save draft",
        );
        assert(button);
        await assert.rejects(
          native.act(
            nativeObservation.target,
            { type: "click", elementId: button.id },
            new AbortController().signal,
          ),
          /foreground-required/,
        );
        editingObservation = await service.act(
          {
            targetId: nativeObservation.target.id,
            observationId: nativeObservation.observationId,
            actions: [{ type: "key", key: "Tab" }],
          },
          nativeContext,
        );
      }
      const filledNative = await service.act(
        {
          targetId: editingObservation.target.id,
          observationId: editingObservation.observationId,
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
      assert.equal(filledNative.foreground, process.platform === "win32");
      const clickObservation = filledNative;
      const save = clickObservation.elements.find(
        (element) => element.label === "Save draft",
      );
      assert(save);
      const saved = await service.act(
        {
          targetId: clickObservation.target.id,
          observationId: clickObservation.observationId,
          actions: [{ type: "click", elementId: save.id }],
        },
        nativeContext,
      );
      assert(
        saved.elements.some((element) =>
          element.label.includes("Saved: Artemis 原生验证"),
        ),
      );
      assert.equal(saved.foreground, process.platform === "win32");
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
        process.platform === "win32",
      );
      await writeFile(
        `${evidence}/native.jpg`,
        Buffer.from(saved.image!.data, "base64"),
      );
      console.log(
        "Computer Use: three foreground input batches without human input",
      );
      let foreground = dynamicBatch;
      for (let round = 0; round < 3; round++) {
        foreground = await service.act(
          {
            targetId: foreground.target.id,
            observationId: foreground.observationId,
            actions: [
              { type: "key", key: "Tab" },
              { type: "scroll", direction: "down", amount: 1 },
            ],
          },
          nativeContext,
        );
        assert.equal(foreground.completed, 2);
        assert.equal(service.status().state, "observing");
      }
      if (process.platform === "win32") {
        console.log(
          "Computer Use: long native batch and four scroll directions",
        );
        const began = performance.now();
        foreground = await service.act(
          {
            targetId: foreground.target.id,
            observationId: foreground.observationId,
            actions: Array.from({ length: 16 }, () => ({
              type: "key" as const,
              key: "Tab" as const,
            })),
          },
          nativeContext,
        );
        longNativeBatchMs = performance.now() - began;
        assert.equal(foreground.completed, 16);
        foreground = await service.act(
          {
            targetId: foreground.target.id,
            observationId: foreground.observationId,
            actions: (["up", "down", "left", "right"] as const).map(
              (direction) => ({
                type: "scroll" as const,
                direction,
                amount: 1,
              }),
            ),
          },
          nativeContext,
        );
        assert.equal(foreground.completed, 4);
        const field = foreground.elements.find(
          (element) => element.id === input.id,
        );
        assert(field?.bounds);
        foreground = await service.act(
          {
            targetId: foreground.target.id,
            observationId: foreground.observationId,
            actions: [
              {
                type: "click_at",
                x: field.bounds.x + field.bounds.width / 2,
                y: field.bounds.y + field.bounds.height / 2,
              },
            ],
          },
          nativeContext,
        );
        assert.equal(foreground.completed, 1);
        console.log("Computer Use: stale window movement and modal boundaries");
        const move = foreground.elements.find(
          (element) => element.label === "Move window",
        );
        assert(move);
        await native.act(
          foreground.target,
          { type: "click", elementId: move.id },
          new AbortController().signal,
          true,
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
        await assert.rejects(
          native.act(
            foreground.target,
            { type: "key", key: "Tab" },
            new AbortController().signal,
            true,
          ),
          /Window moved/,
        );
        foreground = (await service.call(
          "computer_observe",
          { targetId: foreground.target.id },
          nativeContext,
        )) as typeof foreground;
        const modal = foreground.elements.find(
          (element) => element.label === "Open modal",
        );
        assert(modal);
        await native.act(
          foreground.target,
          { type: "click", elementId: modal.id },
          new AbortController().signal,
          true,
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
        await assert.rejects(
          native.act(
            foreground.target,
            { type: "key", key: "Tab" },
            new AbortController().signal,
            true,
          ),
          /Modal window changed/,
        );
        foreground = (await service.call(
          "computer_observe",
          { targetId: foreground.target.id },
          nativeContext,
        )) as typeof foreground;
        const close = foreground.elements.find(
          (element) => element.label === "Close modal",
        );
        assert(close);
        await native.act(
          foreground.target,
          { type: "click", elementId: close.id },
          new AbortController().signal,
          true,
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
        foreground = (await service.call(
          "computer_observe",
          { targetId: foreground.target.id },
          nativeContext,
        )) as typeof foreground;
        console.log(
          "Computer Use: native Stop button and external input takeover",
        );
        const helperPid = inputDiagnostics.find(
          (event) => event.event === "helper-start",
        )?.pid;
        assert.equal(typeof helperPid, "number");
        nativeFixture!.stdin!.write("stop:" + helperPid + "\n");
        for (
          let attempt = 0;
          service.status().state !== "paused" && attempt < 40;
          attempt++
        )
          await new Promise((resolve) => setTimeout(resolve, 25));
        assert.equal(service.status().state, "paused");
        assert.match(service.status().reason ?? "", /Stop button/);
        await assert.rejects(
          service.act(
            {
              targetId: foreground.target.id,
              observationId: foreground.observationId,
              actions: [{ type: "key", key: "Tab" }],
            },
            nativeContext,
          ),
          /paused/,
        );
        service.resumeThread(context.threadId);
        foreground = (await service.open(
          { target: fixtureBundle! },
          nativeContext,
        )) as typeof foreground;
        assert.equal(foregroundRequests, 1);
        await service.act(
          {
            targetId: foreground.target.id,
            observationId: foreground.observationId,
            actions: [{ type: "key", key: "Tab" }],
          },
          nativeContext,
        );
        nativeFixture!.stdin!.write("input-key\n");
        for (
          let attempt = 0;
          service.status().state !== "paused" && attempt < 40;
          attempt++
        )
          await new Promise((resolve) => setTimeout(resolve, 25));
        assert.equal(service.status().state, "paused");
        assert.match(service.status().reason ?? "", /User input/);
      }
      nativeVerified = true;
    }
    let electronVerified = false;
    if (verifyElectron && nativeVerified) {
      // A bundle ID can name several running Electron processes. Never let this
      // test select an unrelated development app's windows.
      const electronPids = JSON.parse(
        execFileSync(
          `${fixtureApp}/Contents/MacOS/fixture`,
          ["--running-app-pids", electronBundle],
          { encoding: "utf8" },
        ),
      );
      assert.deepEqual(
        electronPids,
        [process.pid],
        "Close other Electron development fixtures before running this opt-in test",
      );
      service.stopThread(context.threadId, "Turn ended");
      window.setTitle("Artemis Chromium native input fixture");
      window.showInactive();
      // Give WindowServer time to register this formerly hidden test window
      // before asking ScreenCaptureKit for its first native observation.
      await new Promise((resolve) => setTimeout(resolve, 300));
      const electronContext = { ...context, turnId: "electron-native-turn" };
      let current = await service.open(
        { target: electronBundle },
        electronContext,
      );
      console.log(
        "Computer Use: native coordinate/key/scroll input in the isolated Electron window",
      );
      for (let round = 0; round < 3; round++) {
        const input = current.elements.find(
          (e) => e.role === "AXTextArea" && e.bounds,
        );
        assert(input?.bounds, "The synthetic host textarea must be accessible");
        const { x, y, width, height } = input.bounds;
        current = await service.act(
          {
            targetId: current.target.id,
            observationId: current.observationId,
            actions: [
              { type: "click_at", x: x + width / 2, y: y + height / 2 },
            ],
          },
          electronContext,
        );
        assert.equal(current.completed, 1);
        for (const action of [
          { type: "key", key: "Tab" },
          { type: "scroll", direction: "down", amount: 1 },
        ] as const) {
          current = await service.act(
            {
              targetId: current.target.id,
              observationId: current.observationId,
              actions: [action],
            },
            electronContext,
          );
          assert.equal(current.completed, 1);
        }
        assert.equal(service.status().state, "observing");
      }
      electronVerified = true;
      window.hide();
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
        ...nativeSecurityChecks,
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
              process.platform === "win32"
                ? "native UIA private password exclusion and legacy foreground requirement"
                : "native delayed window readiness and background AX fill/click",
              "native foreground input denied without host approval",
              "native stable element IDs across transient unlabelled containers",
              "three native foreground key/scroll batches without false takeover",
            ]
          : []),
        ...(process.platform === "win32" && nativeVerified
          ? [
              "16 native actions in one batch",
              "four native scroll directions and coordinate click",
              "window movement and modal stale observations rejected",
              "native Stop button and resume reuse authorization",
              "external keyboard input pauses native control",
            ]
          : []),
        ...(electronVerified
          ? [
              "three native coordinate/key/scroll rounds in the isolated Electron window",
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
      platform: process.platform,
      architecture: process.arch,
      longNativeBatchMs,
      foregroundRequests,
      nativePermissions: permissions,
      nativeVerified,
      electronVerified,
      errors,
    };
    await writeFile(`${evidence}/result.json`, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally {
    await writeFile(
      `${evidence}/input-diagnostics.json`,
      JSON.stringify(inputDiagnostics, null, 2),
    );
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

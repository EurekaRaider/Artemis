import assert from "node:assert/strict";
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { app, BrowserWindow, screen, type WebContents } from "electron";
import { ComputerBrowserDriver } from "../../src/main/computer-use/browser-driver.js";
import { ComputerUseService } from "../../src/main/computer-use/service.js";
import type { ComputerAction, ComputerObservation } from "@artemis/protocol";

async function main() {
  const evidence = process.argv[2]!;
  app.setPath("userData", `${evidence}/profile`);
  await app.whenReady();
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(
      request.url === "/host"
        ? '<textarea autofocus>Host draft</textarea><webview src="/" style="display:flex;width:800px;height:600px"></webview>'
        : `<!doctype html><title>Browser input regression</title>
        <style>body{font:18px system-ui;padding:24px;background:white;color:black}label{display:block;margin:15px}</style>
        <label>Project name <input aria-label="Project name"></label>
        <label>Priority <select aria-label="Priority"><option value="standard">Standard</option><optgroup label="Priorities"><option value="high">High</option><option disabled>Unavailable</option></optgroup></select></label>
        <label><input type="checkbox">Research</label>
        <label><input type="checkbox">Design</label>
        <label>Read only <input aria-label="Read only" readonly value="Keep me"></label>
        <button disabled>Disabled button</button>
        <button id="covered" onclick="window.wrongClick=true">Covered button</button>
        <div id="overlay" style="display:none;position:fixed;inset:0;z-index:10" onclick="window.wrongClick=true"></div>
        <button onclick="document.querySelector('output').textContent='Created: '+document.querySelector('input').value+' / '+document.querySelector('select').value">Create launch plan</button><output></output>
        <div id="shadow"></div><div style="height:1000px"></div><button onclick="window.offscreenClicked=true">Offscreen button</button>
        <script>window.changes=[];for(const name of ['input','change'])document.querySelector('select').addEventListener(name,e=>changes.push(e.type));
          document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='<input aria-label="Shadow field">';</script>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
      backgroundThrottling: false,
    },
  });
  const attached = new Promise<WebContents>((resolve) =>
    window.webContents.once("did-attach-webview", (_event, page) =>
      resolve(page),
    ),
  );
  await window.loadURL(`http://127.0.0.1:${address.port}/host`);
  const page = await attached;
  if (page.isLoading())
    await new Promise<void>((resolve) =>
      page.once("did-finish-load", () => resolve()),
    );
  let service: ComputerUseService;
  const driver = new ComputerBrowserDriver(
    async () => page,
    (threadId, targetId) =>
      service.stopTargets(
        (target) => target.id === targetId,
        threadId,
        "User took control",
      ),
  );
  service = new ComputerUseService({
    drivers: { browser: driver, desktop: driver },
    authorize: async () => true,
    publish: () => {},
  });
  const context = {
    threadId: "fixture",
    turnId: "turn",
    mode: "work" as const,
  };
  const cursor = screen.getCursorScreenPoint();
  try {
    let observation: ComputerObservation = await service.open(
      { target: "browser", url: `http://127.0.0.1:${address.port}/` },
      context,
    );
    const element = (label: string, role: string) => {
      const found = observation.elements.find(
        (e) => e.label.trim() === label && e.role === role,
      );
      assert(found, `Missing ${role}: ${label}`);
      return found.id;
    };
    const act = async (actions: ComputerAction[]) => {
      const result = await service.act(
        {
          targetId: observation.target.id,
          observationId: observation.observationId,
          actions,
        },
        context,
      );
      observation = result;
      return result;
    };
    const emptyFrame = observation.visualRevision;
    await act([
      {
        type: "fill",
        elementId: element("Project name", "textbox"),
        text: "Artemis Launch",
      },
    ]);
    assert.notEqual(
      observation.visualRevision,
      emptyFrame,
      "The returned screenshot must reflect the typed text",
    );
    // Native options have no DOM box, even though they appear in the AX tree.
    await act([{ type: "click", elementId: element("Priority", "combobox") }]);
    const selected = await act([
      { type: "click", elementId: element("High", "option") },
    ]);
    assert.equal(selected.completed, 1);
    assert.equal(
      await page.executeJavaScript("document.querySelector('select').value"),
      "high",
    );
    assert.deepEqual(await page.executeJavaScript("changes"), [
      "input",
      "change",
    ]);
    const disabledOption = await act([
      { type: "click", elementId: element("Unavailable", "option") },
    ]);
    assert.equal(disabledOption.stopped, "action-failed");
    assert.match(disabledOption.message!, /disabled/);
    const readOnly = await act([
      {
        type: "fill",
        elementId: element("Read only", "textbox"),
        text: "Wrong",
      },
    ]);
    assert.equal(readOnly.stopped, "action-failed");
    assert.equal(
      await page.executeJavaScript(
        "document.querySelector('[readonly]').value",
      ),
      "Keep me",
    );
    const disabled = await act([
      { type: "click", elementId: element("Disabled button", "button") },
    ]);
    assert.equal(disabled.stopped, "action-failed");
    assert.match(disabled.message!, /disabled/);
    await page.executeJavaScript(
      "document.querySelector('#overlay').style.display='block'",
    );
    observation = (await service.call(
      "computer_observe",
      { targetId: observation.target.id },
      context,
    )) as ComputerObservation;
    const covered = await act([
      { type: "click", elementId: element("Covered button", "button") },
    ]);
    assert.equal(covered.stopped, "action-failed");
    assert.match(covered.message!, /covered/);
    assert.equal(
      await page.executeJavaScript("Boolean(window.wrongClick)"),
      false,
    );
    await page.executeJavaScript("document.querySelector('#overlay').remove()");
    observation = (await service.call(
      "computer_observe",
      { targetId: observation.target.id },
      context,
    )) as ComputerObservation;
    await act([
      {
        type: "fill",
        elementId: element("Priority", "combobox"),
        text: "Standard",
      },
    ]);
    assert.equal(
      await page.executeJavaScript("document.querySelector('select').value"),
      "standard",
    );
    await act([
      {
        type: "fill",
        elementId: element("Priority", "combobox"),
        text: "High",
      },
    ]);
    assert.equal(
      await page.executeJavaScript("document.querySelector('select').value"),
      "high",
    );
    assert.equal(await page.executeJavaScript("getSelection().toString()"), "");
    // Browser default actions need actual virtual key codes, not only event.key.
    await act([
      { type: "click", elementId: element("Research", "checkbox") },
      { type: "key", key: "Space" },
    ]);
    assert.equal(
      await page.executeJavaScript(
        "document.querySelectorAll('[type=checkbox]')[0].checked",
      ),
      false,
    );
    assert.equal(
      observation.elements.find((e) => e.id === element("Research", "checkbox"))
        ?.checked,
      false,
    );
    await act([
      {
        type: "fill",
        elementId: element("Project name", "textbox"),
        text: "abc",
      },
      { type: "key", key: "ArrowLeft" },
      { type: "key", key: "Backspace" },
    ]);
    assert.equal(
      await page.executeJavaScript("document.querySelector('input').value"),
      "ac",
    );
    await act([
      {
        type: "fill",
        elementId: element("Project name", "textbox"),
        text: "Artemis Launch",
      },
      { type: "click", elementId: element("Research", "checkbox") },
      { type: "click", elementId: element("Design", "checkbox") },
    ]);
    await act([
      { type: "click", elementId: element("Create launch plan", "button") },
    ]);
    assert.equal(
      await page.executeJavaScript(
        "document.querySelector('output').textContent",
      ),
      "Created: Artemis Launch / high",
    );
    await writeFile(`${evidence}/form.png`, (await page.capturePage()).toPNG());
    const shadow = await act([
      {
        type: "fill",
        elementId: element("Shadow field", "textbox"),
        text: "Shadow text",
      },
    ]);
    assert.equal(shadow.completed, 1, shadow.message);
    assert.equal(
      await page.executeJavaScript(
        "document.querySelector('#shadow').shadowRoot.querySelector('input').value",
      ),
      "Shadow text",
    );
    const offscreen = await act([
      { type: "click", elementId: element("Offscreen button", "button") },
    ]);
    assert.equal(offscreen.completed, 1, offscreen.message);
    assert.equal(await page.executeJavaScript("window.offscreenClicked"), true);
    assert.equal(
      await window.webContents.executeJavaScript(
        "document.querySelector('textarea').value",
      ),
      "Host draft",
    );
    assert.equal(window.isVisible(), false);
    assert.equal(window.isFocused(), false);
    assert.deepEqual(screen.getCursorScreenPoint(), cursor);
    await writeFile(
      `${evidence}/browser.png`,
      (await page.capturePage()).toPNG(),
    );
    console.log(
      "PASS: native options, select fill, disabled/read-only/covered controls, checkbox state, keyboard defaults, form submission, Shadow DOM, offscreen click, background isolation",
    );
    await writeFile(
      `${evidence}/report.json`,
      JSON.stringify(
        {
          platform: process.platform,
          architecture: process.arch,
          checks: [
            "native option click after opening popup",
            "exact-label select fill with input/change events",
            "disabled option and button rejected",
            "read-only field unchanged",
            "covered control does not click overlay",
            "checkbox state returned",
            "Space/ArrowLeft/Backspace default actions",
            "returned screenshot updates after fill",
            "form submission",
            "Shadow DOM text field",
            "offscreen element scrolling",
            "host draft preserved",
            "window stays hidden and unfocused",
            "system pointer unchanged",
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    service.stopAll();
    driver.dispose();
    window.destroy();
    server.close();
  }
}
main().then(
  () => app.exit(0),
  (error) => {
    console.error(error);
    app.exit(1);
  },
);

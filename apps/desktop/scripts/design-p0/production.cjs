const { app, BrowserWindow, protocol, webContents } = require("electron");
const path = require("node:path");
const output = process.env.ARTEMIS_DESIGN_P0_OUTPUT;
if (!output) throw Error("ARTEMIS_DESIGN_P0_OUTPUT is required");
const { DesignPreviewHost } = require(
  path.join(output, "design-preview-host.cjs"),
);
const { exportStaticDesign } = require(path.join(output, "design-export.cjs"));
const fs = require("node:fs");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "artemis-design",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
app.setPath("userData", path.join(output, "production-profile"));
const checks = [];
const check = (name, value) => {
  checks.push({ name, passed: !!value });
  if (!value) throw Error(name);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  let host;
  try {
    const window = new BrowserWindow({
      show: true,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    await window.loadURL("data:text/html,Trusted");
    let permitted = true;
    host = new DesignPreviewHost(
      () => window,
      async () => {
        if (!permitted) throw Error("Read only");
      },
    );
    const revision = {
      documentId: "d",
      revisionId: "r",
      parentRevision: null,
      conflict: false,
      digest: "fixture",
      createdAt: new Date().toISOString(),
      content: {
        schemaVersion: 1,
        title: "Fixture",
        brief: "",
        basis: [],
        interactionNotes: "",
        variants: [
          {
            id: "a",
            name: "A",
            description: "",
            pages: [
              {
                id: "one",
                name: "One",
                html: '<html><head></head><body><button data-design-id="button" onclick="document.querySelector(\'output\').textContent=\'Clicked\'">Click</button><output></output><input data-design-id="input"></body></html>',
                parameters: [],
                data: {},
              },
            ],
          },
        ],
      },
    };
    let result = await host.inspect("t", revision, "a", "one", [
      { kind: "click", elementId: "button" },
      { kind: "input", elementId: "input", value: "Saved input" },
    ]);
    check(
      "native actual preview screenshot",
      result.screenshot.startsWith("data:image/png;base64,") && result.passed,
    );
    let preview = webContents
      .getAllWebContents()
      .find((w) => w.getURL().startsWith("artemis-design:"));
    let frame = preview.mainFrame.framesInSubtree.find((f) =>
      f.url.endsWith("/page"),
    );
    check(
      "script interaction",
      (await frame.executeJavaScript(
        'document.querySelector("output").textContent',
      )) === "Clicked",
    );
    check(
      "no desktop API",
      (await frame.executeJavaScript(
        'typeof require+":"+typeof window.artemis',
      )) === "undefined:undefined",
    );
    check(
      "trusted process isolated",
      preview.mainFrame.framesInSubtree.every(
        (f) => f.osProcessId !== window.webContents.getOSProcessId(),
      ),
    );
    const html = await host.staticSnapshot("t", host.state("t").instanceId);
    check("snapshot preserves runtime text", html.includes("Clicked"));
    check(
      "network and eval denied",
      await frame.executeJavaScript(
        '(async()=>{let blocked=0;try{await fetch("https://example.com")}catch{blocked++}try{eval("1")}catch{blocked++}return blocked===2})()',
      ),
    );

    const parallel = await Promise.all([
      host.inspect("t", revision, "a", "one", [
        { kind: "click", elementId: "button" },
      ]),
      host.inspect("t", revision, "a", "one", [
        { kind: "input", elementId: "input", value: "Saved input" },
      ]),
    ]);
    check(
      "parallel model inspections serialize on the single preview",
      parallel.every((result) => result.passed),
    );
    const exported = exportStaticDesign(html);
    const exportWindow = new BrowserWindow({
      show: true,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    await exportWindow.loadURL(
      "data:text/html," + encodeURIComponent(exported),
    );
    const exportFrame = exportWindow.webContents.mainFrame.framesInSubtree.find(
      (f) => f !== exportWindow.webContents.mainFrame,
    );
    let scriptDenied = false;
    try {
      await exportFrame.executeJavaScript("1 + 1");
    } catch {
      scriptDenied = true;
    }
    check("static export disallows script execution", scriptDenied);
    exportWindow.webContents.debugger.attach("1.3");
    let childSession;
    exportWindow.webContents.debugger.on(
      "message",
      (_event, method, params) => {
        if (
          method === "Target.attachedToTarget" &&
          params.targetInfo.type === "iframe"
        )
          childSession = params.sessionId;
      },
    );
    await exportWindow.webContents.debugger.sendCommand(
      "Target.setAutoAttach",
      { autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
    );
    for (let i = 0; i < 30 && !childSession; i++) await wait(100);
    check("static export child target is available", childSession);
    const { root: exportedRoot } =
      await exportWindow.webContents.debugger.sendCommand(
        "DOM.getDocument",
        { depth: -1, pierce: true },
        childSession,
      );
    const nodes = [];
    const pending = [exportedRoot];
    while (pending.length) {
      const node = pending.pop();
      nodes.push(node);
      pending.push(...(node.children ?? []), ...(node.shadowRoots ?? []));
      if (node.contentDocument) pending.push(node.contentDocument);
    }
    check(
      "static export has no scripts or handlers",
      nodes.every(
        (node) =>
          node.nodeName !== "SCRIPT" &&
          !(node.attributes ?? []).some(
            (value, i) => i % 2 === 0 && value.startsWith("on"),
          ),
      ),
    );
    fs.writeFileSync(
      path.join(output, "export-dom.json"),
      JSON.stringify(exportedRoot, null, 2),
    );
    const input = nodes.find((node) => node.nodeName === "INPUT");
    check(
      "static export preserves current form value",
      input?.attributes?.includes("Saved input"),
    );
    exportWindow.webContents.debugger.detach();
    exportWindow.destroy();
    preview = webContents
      .getAllWebContents()
      .find((w) => w.getURL().startsWith("artemis-design:"));
    frame = preview.mainFrame.framesInSubtree.find((f) =>
      f.url.endsWith("/page"),
    );
    const pids = preview.mainFrame.framesInSubtree.map((f) => f.osProcessId);
    void frame.executeJavaScript("while(true){}").catch(() => {});
    const watchdogDeadline = Date.now() + 10000;
    while (host.state("t").status !== "failed" && Date.now() < watchdogDeadline)
      await wait(100);
    check("watchdog stops loop", host.state("t").status === "failed");
    check(
      "trusted window survives",
      (await window.webContents.executeJavaScript("1+1")) === 2,
    );
    for (
      let i = 0;
      i < 30 &&
      pids.some((pid) => app.getAppMetrics().some((m) => m.pid === pid));
      i++
    )
      await wait(100);
    checks.push({
      pids,
      remaining: app.getAppMetrics().filter((m) => pids.includes(m.pid)),
    });
    check(
      "all preview PIDs terminated",
      pids.every((pid) => !app.getAppMetrics().some((m) => m.pid === pid)),
    );

    const multi = structuredClone(revision);
    multi.revisionId = "navigation";
    multi.content.variants[0].pages[0].html =
      '<button data-design-id="next" data-design-page="two">Next</button>';
    multi.content.variants[0].pages.push({
      id: "two",
      name: "Two",
      html: '<button data-design-id="finish" onclick="document.querySelector(&quot;output&quot;).textContent=&quot;Finished&quot;">Finish</button><output></output>',
      parameters: [],
      data: {},
    });
    result = await host.inspect("t", multi, "a", "one", [
      { kind: "click", elementId: "next" },
      { kind: "click", elementId: "finish" },
    ]);
    check(
      "navigation inspection binds evidence to destination page",
      result.pageId === "two" && result.passed,
    );
    check(
      "navigation continues actions on destination",
      (await host.staticSnapshot("t", host.state("t").instanceId)).includes(
        "Finished",
      ),
    );
    host.stop();
    const floodState = await host.show("t", revision, "a", "one");
    const floodContents = webContents
      .getAllWebContents()
      .find((w) => w.getURL().startsWith("artemis-design:"));
    const floodFrame = floodContents.mainFrame.framesInSubtree.find((f) =>
      f.url.endsWith("/page"),
    );
    await floodFrame.executeJavaScript(
      "parent.postMessage({type:'error',text:'x'.repeat(65536)},'*')",
    );
    await wait(100);
    check(
      "oversized bridge messages are discarded",
      (await floodContents.executeJavaScript(
        "window.designState.errors.length",
      )) === 0,
    );
    // Drive bursts from Main: background renderer timers may be throttled to
    // one tick per second on CI, which would never exceed the rate limit.
    for (let i = 0; i < 60 && host.state("t")?.status === "running"; i++) {
      await floodFrame.executeJavaScript(
        "for(let i=0;i<40;i++)parent.postMessage({type:'error',text:'flood'},'*');void 0",
      );
      await wait(100);
    }
    checks.push({ floodState: host.state("t") });
    check(
      "sustained bridge flood stops the preview",
      host.state("t")?.status === "failed" &&
        host.state("t")?.error.includes("rate limit"),
    );
    check(
      "trusted UI survives bridge flood",
      (await window.webContents.executeJavaScript("1+1")) === 2,
    );
    permitted = false;
    try {
      await host.show("t", revision, "a", "one");
      check("readonly denied", false);
    } catch {
      check("readonly denied", true);
    }
  } catch (error) {
    checks.push({ error: String(error), stack: error.stack });
  } finally {
    host?.stop();
    fs.writeFileSync(
      path.join(output, "production-report.json"),
      JSON.stringify(
        {
          head: process.env.ARTEMIS_DESIGN_P0_HEAD,
          dirty: process.env.ARTEMIS_DESIGN_P0_DIRTY === "true",
          platform: process.platform,
          arch: process.arch,
          checks,
        },
        null,
        2,
      ),
    );
    app.exit(checks.some((x) => x.error || x.passed === false) ? 1 : 0);
  }
});

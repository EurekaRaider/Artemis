// Standalone native P0 probe. Never installs handlers in the application session.
const {
  app,
  BrowserWindow,
  WebContentsView,
  protocol,
  session,
} = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "artemis-design",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
const output = process.env.ARTEMIS_DESIGN_P0_OUTPUT;
if (!output) throw new Error("ARTEMIS_DESIGN_P0_OUTPUT is required");
app.setPath("userData", path.join(output, "profile"));
const report = {
  electron: process.versions.electron,
  platform: process.platform,
  arch: process.arch,
  head: process.env.ARTEMIS_DESIGN_P0_HEAD,
  checks: [],
  frames: [],
};
const check = (name, condition) => {
  report.checks.push({ name, passed: Boolean(condition) });
  assert.ok(condition, name);
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const bounded = (promise, name) =>
  Promise.race([
    promise,
    wait(5000).then(() => {
      throw new Error(`Timeout: ${name}`);
    }),
  ]);
const windows = [];
let preview;
const timeout = setTimeout(() => {
  report.error = "P0 process deadline exceeded";
  finish(1);
}, 25000);
function finish(code) {
  clearTimeout(timeout);
  fs.writeFileSync(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2),
  );
  if (preview?.webContents && !preview.webContents.isDestroyed())
    preview.webContents.close();
  for (const window of windows) if (!window.isDestroyed()) window.destroy();
  app.exit(code);
}

app
  .whenReady()
  .then(async () => {
    const { DatabaseSync } = require("node:sqlite");
    const { DesignStore } = require(path.join(output, "design-store.cjs"));
    const { patchDesignSource, designParameterCss } = require(
      path.join(output, "design-source.cjs"),
    );
    const context = {
      projectId: "fixture",
      threadId: "fixture",
      workspaceBinding: output,
      mode: "execute",
    };
    const source = patchDesignSource(
      {
        html: '<!doctype html><p id="text">Original</p><span data-design-id="label" data-design-text="static">旧文字</span><script>document.getElementById("text").textContent="JavaScript executed"; window.probe={node:typeof require,process:typeof process,desktop:typeof window.artemis};</script>',
        parameters: [
          { name: "--design-gap", min: 0, max: 32, value: 8, unit: "px" },
        ],
      },
      [
        { type: "text", elementId: "label", text: "保存后重开" },
        { type: "parameter", name: "--design-gap", value: 16 },
      ],
    );
    let database = new DatabaseSync(path.join(output, "design.sqlite"));
    let store = new DesignStore(database, path.join(output, "blobs"));
    const revision = store.save(context, {
      operationId: "save",
      documentId: "fixture",
      baseRevision: null,
      source,
    });
    database.close();
    database = new DatabaseSync(path.join(output, "design.sqlite"));
    store = new DesignStore(database, path.join(output, "blobs"));
    const reopened = store.read(context, "fixture", revision.revisionId);
    database.close();
    report.stage = "trusted window";
    const trusted = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    windows.push(trusted);
    // Use the repository's unchanged production entry CSP, without launching real tasks.
    const entry = fs.readFileSync(
      path.join(__dirname, "../../dist-renderer/index.html"),
      "utf8",
    );
    const csp = entry.match(
      /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
    )[1];
    await bounded(
      trusted.loadURL(
        `data:text/html,${encodeURIComponent(`<meta http-equiv="Content-Security-Policy" content="${csp}"><p>Trusted interface</p>`)}`,
      ),
      "trusted load",
    );
    report.stage = "Browser control";
    const browser = new WebContentsView({
      webPreferences: {
        partition: "design-p0-browser",
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    trusted.contentView.addChildView(browser);
    await bounded(
      browser.webContents.loadURL("data:text/html,Browser control"),
      "Browser load",
    );
    report.stage = "preview";
    const isolated = session.fromPartition(`design-p0-${Date.now()}`);
    isolated.setPermissionCheckHandler(() => false);
    isolated.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
    isolated.on("will-download", (event) => event.preventDefault());
    const allowed = new Set([
      "artemis-design://preview/shell",
      "artemis-design://preview/page",
    ]);
    isolated.webRequest.onBeforeRequest((details, callback) =>
      callback({ cancel: !allowed.has(details.url) }),
    );
    const childPolicy =
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; worker-src 'none'; sandbox allow-scripts";
    isolated.protocol.handle("artemis-design", (request) => {
      if (!allowed.has(request.url)) return new Response("", { status: 404 });
      const shell = request.url.endsWith("/shell");
      const html = shell
        ? '<!doctype html><iframe sandbox="allow-scripts" src="artemis-design://preview/page"></iframe>'
        : reopened.html.replace(
            "</head>",
            `<style>${designParameterCss(reopened)}</style></head>`,
          );
      return new Response(html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": shell
            ? "default-src 'none'; frame-src artemis-design:; base-uri 'none'"
            : childPolicy,
        },
      });
    });
    preview = new WebContentsView({
      webPreferences: {
        session: isolated,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    trusted.contentView.addChildView(preview);
    preview.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    preview.webContents.on("will-navigate", (event) => event.preventDefault());
    let childLoadAllowed = true;
    preview.webContents.on("will-frame-navigate", (event) => {
      if (
        childLoadAllowed &&
        !event.isMainFrame &&
        event.url === "artemis-design://preview/page"
      ) {
        childLoadAllowed = false;
        return;
      }
      event.preventDefault();
    });
    preview.webContents.on("will-redirect", (event) => event.preventDefault());
    await bounded(
      preview.webContents.loadURL("artemis-design://preview/shell"),
      "preview load",
    );
    const frames = preview.webContents.mainFrame.framesInSubtree;
    report.frames = frames.map((frame) => ({
      url: frame.url,
      pid: frame.osProcessId,
    }));
    report.trustedPid = trusted.webContents.getOSProcessId();
    report.browserPid = browser.webContents.getOSProcessId();
    const page = frames.find(
      (frame) => frame.url === "artemis-design://preview/page",
    );
    check("generated child frame loaded", page);
    check(
      "preview process ownership distinct from trusted and Browser",
      frames.every(
        (frame) =>
          frame.osProcessId > 0 &&
          ![report.trustedPid, report.browserPid].includes(frame.osProcessId),
      ),
    );
    const state = await bounded(
      page.executeJavaScript(
        '({text:document.querySelector("#text").textContent,...window.probe})',
      ),
      "inline JavaScript",
    );
    report.page = state;
    check(
      "saved Chinese text renders after reopening SQLite",
      (await bounded(
        page.executeJavaScript(
          'document.querySelector("[data-design-id=label]").textContent',
        ),
        "reopened text",
      )) === "保存后重开",
    );
    check(
      "saved parameter renders after reopening SQLite",
      (await bounded(
        page.executeJavaScript(
          'getComputedStyle(document.documentElement).getPropertyValue("--design-gap").trim()',
        ),
        "reopened parameter",
      )) === "16px",
    );
    check(
      "inline JavaScript executes under separate CSP",
      state.text === "JavaScript executed",
    );
    check(
      "generated page has no Node or desktop API",
      state.node === "undefined" &&
        state.process === "undefined" &&
        state.desktop === "undefined",
    );
    check(
      "network fetch denied",
      await bounded(
        page.executeJavaScript(
          'fetch("https://example.com").then(()=>false,()=>true)',
        ),
        "blocked fetch",
      ),
    );
    check(
      "unsafe eval denied",
      await bounded(
        page.executeJavaScript(
          '(()=>{try{eval("1");return false}catch{return true}})()',
        ),
        "blocked eval",
      ),
    );
    // Probe an actual child-frame infinite loop. The caller never waits on it.
    void page.executeJavaScript("while(true){}").catch(() => {});
    await wait(250);
    check(
      "trusted interface responds during infinite loop",
      (await bounded(
        trusted.webContents.executeJavaScript("1+1"),
        "trusted heartbeat",
      )) === 2,
    );
    const owned = new Set(frames.map((frame) => frame.osProcessId));
    // forcefullyCrashRenderer only covers the top renderer. Record any separate child
    // PID: production must control every owned process before passing this gate.
    report.separateChildPids = [...owned].filter(
      (pid) => pid !== preview.webContents.getOSProcessId(),
    );
    preview.webContents.forcefullyCrashRenderer();
    preview.webContents.close();
    for (let attempt = 0; attempt < 30; attempt++) {
      const live = new Set(app.getAppMetrics().map((metric) => metric.pid));
      if (![...owned].some((pid) => live.has(pid))) break;
      await wait(100);
    }
    const live = new Set(app.getAppMetrics().map((metric) => metric.pid));
    check(
      "all owned preview renderer processes terminated",
      [...owned].every((pid) => !live.has(pid)),
    );
    check(
      "trusted interface responds after termination",
      (await bounded(
        trusted.webContents.executeJavaScript("2+2"),
        "trusted recovery",
      )) === 4,
    );
    check(
      "Browser responds after termination",
      (await bounded(
        browser.webContents.executeJavaScript("3+3"),
        "browser recovery",
      )) === 6,
    );
    browser.webContents.close();
    finish(0);
  })
  .catch((error) => {
    report.error = error.stack;
    finish(1);
  });

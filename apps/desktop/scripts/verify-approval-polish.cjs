const { app, BrowserWindow } = require("electron");
const { buildSync } = require("esbuild");
const fs = require("node:fs/promises");
const path = require("node:path");
const root = path.resolve(__dirname, "../../..");
const out = path.join(root, "artifacts/approval-polish");
app.setPath("userData", path.join(out, "preview-profile"));

function inspect() {
  const rect = (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  };
  const dots = [
    ...document.querySelectorAll(
      '.approval-card [data-part="status"],.user-input-status',
    ),
  ].map((e) => ({
    text: e.textContent,
    content: getComputedStyle(e, "::before").content,
    color: getComputedStyle(e, "::before").backgroundColor,
    width: getComputedStyle(e, "::before").width,
  }));
  const alignment = [...document.querySelectorAll(".user-input-option")]
    .filter((e) => e.getBoundingClientRect().height)
    .map((e) => {
      const r = e.getBoundingClientRect(),
        i = e.querySelector(".user-input-option-index").getBoundingClientRect();
      return Math.abs(r.top + r.height / 2 - i.top - i.height / 2);
    });
  const buttons = [
    ...document.querySelectorAll(".approval-action,.user-input-submit"),
  ]
    .filter((e) => e.getBoundingClientRect().height)
    .map((e) => ({
      label: e.textContent,
      height: e.getBoundingClientRect().height,
      font: getComputedStyle(e).fontSize,
    }));
  const cards = [
    ...document.querySelectorAll(".approval-card,.user-input-card"),
  ].map(rect);
  const disclosure = document.querySelector(
    '#collapsed [data-part="disclosure"]',
  );
  return {
    dots,
    alignment,
    buttons,
    cards,
    preserved: disclosure.textContent.includes("sudo -n true"),
    overflow: document.documentElement.scrollWidth > innerWidth,
  };
}

app
  .whenReady()
  .then(async () => {
    await fs.mkdir(out, { recursive: true });
    buildSync({
      entryPoints: [path.join(__dirname, "fixtures/approval-polish.tsx")],
      bundle: true,
      format: "esm",
      platform: "browser",
      jsx: "automatic",
      outdir: path.join(out, "bundle"),
      splitting: true,
      loader: { ".png": "file" },
      logLevel: "warning",
    });
    await fs.writeFile(
      path.join(out, "index.html"),
      '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="./bundle/approval-polish.css"><style>html,body{height:auto;overflow:auto}body{margin:0;background:var(--bg)}.polish-preview{width:640px;margin:24px auto;display:grid;gap:18px}.polish-preview section{container-type:inline-size}.polish-preview h2{font-size:13px;font-weight:500;color:var(--muted);margin:0 0 8px}.polish-preview .timeline{padding:0;max-width:none}.polish-preview .user-input-card{margin:0}</style></head><body><div id="root"></div><script type="module" src="./bundle/approval-polish.js"></script></body></html>',
    );
    const errors = [];
    const win = new BrowserWindow({
      width: 740,
      height: 1550,
      show: false,
      webPreferences: { contextIsolation: true, sandbox: true },
    });
    win.webContents.on("console-message", (_event, level, message) => {
      if (level >= 3) errors.push(message);
    });
    const results = [];
    for (const theme of ["light", "dark"]) {
      await win.loadFile(path.join(out, "index.html"), { query: { theme } });
      await new Promise((r) => setTimeout(r, 500));
      const evidence = await win.webContents.executeJavaScript(
        "(" + inspect.toString() + ")()",
      );
      if (
        evidence.dots.length !== 4 ||
        evidence.dots.some((d) => d.content !== '""' || d.width !== "7px")
      )
        throw Error("Missing state dots: " + JSON.stringify(evidence.dots));
      if (evidence.alignment.some((n) => n > 1))
        throw Error(
          "Off-center option indicators: " + JSON.stringify(evidence.alignment),
        );
      if (
        evidence.buttons.some(
          (b) => Math.abs(b.height - 28) > 1 || b.font !== "12px",
        )
      )
        throw Error(
          "Button sizing mismatch: " + JSON.stringify(evidence.buttons),
        );
      if (
        evidence.cards.length !== 4 ||
        !evidence.preserved ||
        evidence.overflow
      )
        throw Error("Content or overflow mismatch");
      await fs.writeFile(
        path.join(out, theme + "-components.png"),
        (await win.webContents.capturePage()).toPNG(),
      );
      await win.webContents.executeJavaScript(
        "document.querySelector('#multi').scrollIntoView()",
      );
      await fs.writeFile(
        path.join(out, theme + "-multi.png"),
        (await win.webContents.capturePage()).toPNG(),
      );
      await win.webContents.executeJavaScript(
        "document.querySelector('.polish-preview').style.width='300px';window.scrollTo(0,0)",
      );
      const narrow = await win.webContents.executeJavaScript(
        "(" + inspect.toString() + ")()",
      );
      if (
        narrow.alignment.some((n) => n > 1) ||
        narrow.cards.some((c) => c.width > 301)
      )
        throw Error("Narrow card alignment mismatch");
      await fs.writeFile(
        path.join(out, theme + "-narrow.png"),
        (await win.webContents.capturePage()).toPNG(),
      );
      await win.loadFile(path.join(out, "index.html"), {
        query: { theme, restricted: "1" },
      });
      await new Promise((r) => setTimeout(r, 500));
      const restricted = await win.webContents.executeJavaScript(
        "({ labels: [...document.querySelectorAll('#expanded .approval-action')].map(e => e.textContent), hint: !!document.querySelector('#expanded .approval-scope-hint') })",
      );
      if (restricted.labels.join(",") !== "拒绝,仅批准本次" || restricted.hint)
        throw Error("Unsupported always-allow must be hidden");
      await fs.writeFile(
        path.join(out, theme + "-restricted.png"),
        (await win.webContents.capturePage()).toPNG(),
      );
      results.push({ theme, ...evidence, narrow, restricted });
    }
    if (errors.length) throw Error(errors.join("\n"));
    await fs.writeFile(
      path.join(out, "geometry-report.json"),
      JSON.stringify({ results, errors }, null, 2),
    );
    console.log(JSON.stringify({ results, errors }, null, 2));
    win.destroy();
    app.quit();
  })
  .catch((e) => {
    console.error(e);
    app.exit(1);
  });

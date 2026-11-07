const { app, BrowserWindow } = require("electron");
const { buildSync } = require("esbuild");
const fs = require("node:fs/promises");
const path = require("node:path");
const root = path.resolve(__dirname, "../../../../..");
const out = path.join(
  root,
  "artifacts/verification/decision-card-layout",
  new Date().toISOString().replaceAll(":", "-"),
);
app.setPath("userData", path.join(out, "preview-profile"));

function inspect() {
  const rect = (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  };
  const statuses = [
    ...document.querySelectorAll(
      ".decision-waiting, .decision-result > summary strong",
    ),
  ].map((e) => e.textContent.trim());
  const alignment = [...document.querySelectorAll(".user-input-option")]
    .filter((e) => e.getBoundingClientRect().height)
    .map((e) => {
      const r = e.getBoundingClientRect(),
        i = e.querySelector(".decision-option-number").getBoundingClientRect();
      return Math.abs(r.top + r.height / 2 - i.top - i.height / 2);
    });
  const buttons = [...document.querySelectorAll(".decision-submit")]
    .filter((e) => e.getBoundingClientRect().height)
    .map((e) => ({
      label: e.textContent,
      height: e.getBoundingClientRect().height,
      font: getComputedStyle(e).fontSize,
    }));
  const cards = [
    ...document.querySelectorAll(".decision-card,.decision-result"),
  ].map(rect);
  const disclosure = document.querySelector("#collapsed .decision-result");
  return {
    statuses,
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
      entryPoints: [
        path.join(__dirname, "../../fixtures/decision-card-layout.tsx"),
      ],
      bundle: true,
      format: "esm",
      platform: "browser",
      jsx: "automatic",
      outdir: path.join(out, "bundle"),
      splitting: true,
      loader: {
        ".png": "file",
        ".svg": "file",
        ".woff2": "file",
        ".woff": "file",
        ".ttf": "file",
      },
      logLevel: "warning",
    });
    await fs.writeFile(
      path.join(out, "index.html"),
      '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="./bundle/decision-card-layout.css"><style>html,body{height:auto;overflow:auto}body{margin:0;background:var(--bg)}.decision-card-preview{width:640px;margin:24px auto;display:grid;gap:18px}.decision-card-preview section{container-type:inline-size}.decision-card-preview h2{font-size:13px;font-weight:500;color:var(--muted);margin:0 0 8px}.decision-card-preview .timeline{padding:0;max-width:none}.decision-card-preview .user-input-card{margin:0}</style></head><body><div id="root"></div><script type="module" src="./bundle/decision-card-layout.js"></script></body></html>',
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
        evidence.statuses.length !== 4 ||
        evidence.statuses.some((text) => !text)
      )
        throw Error(
          "Missing decision status: " + JSON.stringify(evidence.statuses),
        );
      if (evidence.alignment.some((n) => n > 1))
        throw Error(
          "Off-center option indicators: " + JSON.stringify(evidence.alignment),
        );
      if (evidence.buttons.some((b) => b.height < 30 || b.font !== "12px"))
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
        "document.querySelector('.decision-card-preview').style.width='300px';window.scrollTo(0,0)",
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
        "({ labels: [...document.querySelectorAll('#expanded .decision-option-copy strong')].map(e => e.textContent), hint: !!document.querySelector('#expanded .decision-option-copy small') })",
      );
      if (restricted.labels.join(",") !== "仅批准本次,拒绝" || restricted.hint)
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

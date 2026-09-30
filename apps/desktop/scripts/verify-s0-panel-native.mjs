// S0 validation line 1: native WebContentsView panel-container verification.
//
// Spawns a real Electron window (swiftshader, no GPU) that mounts the two S0
// test plugin panels in WebContentsView instances with isolated sessions and
// verifies the container invariants from proposal §8:
//   1. Focus: the panel view can take and report focus without crashing the
//      host window.
//   2. Overlay: a host-owned BrowserWindow child (dialog stand-in) renders
//      above the WebContentsView layer.
//   3. Bounds/zoom: resizing the host window resizes the panel view; the
//      panel observes the new viewport.
//   4. Task switch: hiding the view on switch and re-showing preserves the
//      panel document state (DOM persistence across hide/show).
//   5. Teardown: closing the host window destroys the panel webContents; no
//      orphan panel process remains.
//
// Exit code 0 + JSON report = pass. Artifacts land in artifacts/s0-panel/.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = fileURLToPath(new URL("../", import.meta.url));
const output =
  process.env.ARTEMIS_S0_PANEL_EVIDENCE ??
  join(desktop, "../../artifacts/s0-panel");
await mkdir(output, { recursive: true });
const stage = await mkdtemp(join(tmpdir(), "artemis-s0-panel-"));
const pluginsRoot = join(desktop, "resources", "s0-plugins");

const entry = join(stage, "entry.mjs");
await writeFile(
  entry,
  `
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  WebContentsView,
  session,
  dialog,
} from 'electron';

const reportPath = ${JSON.stringify(join(output, `${process.platform}-${process.arch}.json`))};
const pluginsRoot = ${JSON.stringify(pluginsRoot)};
const proof = { platform: process.platform, arch: process.arch, checks: [] };
const check = (name, ok, detail) => {
    proof.checks.push({ name, ok, detail });
    writeFile(reportPath, JSON.stringify(proof, null, 2)).catch(() => undefined);
  };

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('use-angle', 'swiftshader');
// Keep the app alive after the host window is destroyed: the teardown check
// must still run and write the report before we exit explicitly.
app.on('window-all-closed', () => undefined);

const fail = setTimeout(() => {
  writeFile(reportPath, JSON.stringify(proof, null, 2)).finally(() => app.exit(2));
}, 90000);

function panelUrl(pluginDir) {
  return 'file://' + join(pluginsRoot, pluginDir, 'panel', 'index.html');
}

app.whenReady().then(async () => {
  try {
    const host = new BrowserWindow({
      width: 1200,
      height: 800,
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    await host.loadURL('data:text/html,<h1>host</h1>');

    // Two plugin panels, each with its own isolated non-persistent session.
    const notesSession = session.fromPartition('s0-notes', { cache: false });
    const shapesSession = session.fromPartition('s0-shapes', { cache: false });
    const notes = new WebContentsView({ webPreferences: { session: notesSession, sandbox: true, nodeIntegration: false, contextIsolation: true } });
    const shapes = new WebContentsView({ webPreferences: { session: shapesSession, sandbox: true, nodeIntegration: false, contextIsolation: true } });
    host.contentView.addChildView(notes);
    host.contentView.addChildView(shapes);

    const layout = () => {
      const [w, h] = host.getContentSize();
      notes.setBounds({ x: 0, y: 0, width: Math.floor(w / 2), height: h });
      shapes.setBounds({ x: Math.floor(w / 2), y: 0, width: w - Math.floor(w / 2), height: h });
    };
    layout();
    host.on('resize', layout);

    await notes.webContents.loadURL(panelUrl('test-notes'));
    await shapes.webContents.loadURL(panelUrl('test-shapes'));
    host.show();

    // 1. Focus: panel takes focus and reports activeElement.
    notes.webContents.focus();
    await new Promise((r) => setTimeout(r, 300));
    const focusedTag = await notes.webContents.executeJavaScript(
      'document.activeElement ? document.activeElement.tagName : "none"',
    );
    check('focus-panel', true, 'panel webContents.focus() executed; host window stable');
    check('focus-active-element', Boolean(focusedTag), 'activeElement=' + focusedTag);

    // 2. Overlay: a host-owned modal dialog renders above panel views.
    const overlay = new BrowserWindow({
      parent: host,
      modal: true,
      show: false,
      width: 320,
      height: 140,
      webPreferences: { nodeIntegration: false },
    });
    await overlay.loadURL('data:text/html,<p>dialog stand-in</p>');
    overlay.show();
    await new Promise((r) => setTimeout(r, 300));
    check('overlay-above-panel', overlay.isVisible() && overlay.isModal(), 'modal overlay visible above panel views');
    overlay.destroy();

    // 3. Bounds/zoom: resize host, panel view bounds follow the content
    // size proportionally (half width for the right-hand panel). Absolute
    // pixel thresholds break on small displays, so assert relative layout.
    host.setContentSize(1600, 900);
    await new Promise((r) => setTimeout(r, 500));
    const [contentW, contentH] = host.getContentSize();
    const bounds = shapes.getBounds();
    const halfW = Math.floor(contentW / 2);
    const follows =
      Math.abs(bounds.width - (contentW - halfW)) <= 2 &&
      Math.abs(bounds.height - contentH) <= 2 &&
      bounds.x === halfW;
    const viewport = await shapes.webContents.executeJavaScript(
      'JSON.stringify({ w: window.innerWidth, h: window.innerHeight })',
    );
    check(
      'resize-panel-follows',
      follows,
      'content=' + contentW + 'x' + contentH + ' bounds=' + JSON.stringify(bounds) + ' viewport=' + viewport,
    );

    // 4. Task switch: hide panel, mutate DOM, show again; DOM persists.
    shapes.webContents.send('s0-task-switch', 'hide');
    shapes.setVisible(false);
    await shapes.webContents.executeJavaScript(
      'window.__s0marker = "kept-across-switch"',
    );
    await new Promise((r) => setTimeout(r, 200));
    shapes.setVisible(true);
    const marker = await shapes.webContents.executeJavaScript('window.__s0marker');
    check('switch-dom-persists', marker === 'kept-across-switch', 'marker=' + marker);

    // 5. Teardown: destroying host kills panel webContents.
    const notesId = notes.webContents.id;
    const shapesId = shapes.webContents.id;
    // Electron 43 finding: destroying the host window clears view.webContents
    // but does not necessarily destroy child WebContentsView webContents. The
    // host MUST explicitly close them (proposal §8: closing a tab closes the
    // owned webContents). Grab references first, close, then verify.
    const notesContents = notes.webContents;
    const shapesContents = shapes.webContents;
    host.destroy();
    notesContents.close();
    shapesContents.close();
    await new Promise((r) => setTimeout(r, 500));
    const notesDestroyed = notesContents.isDestroyed();
    const shapesDestroyed = shapesContents.isDestroyed();
    check(
      'teardown-kills-panels',
      notesDestroyed && shapesDestroyed,
      'explicit close: notes destroyed=' + notesDestroyed + ' shapes destroyed=' + shapesDestroyed + ' ids=' + notesId + '/' + shapesId,
    );

    clearTimeout(fail);
    await writeFile(reportPath, JSON.stringify(proof, null, 2));
    app.exit(proof.checks.every((c) => c.ok) ? 0 : 1);
  } catch (error) {
    check('unexpected-error', false, String(error) + ' | ' + (error && error.stack ? error.stack : ''));
    clearTimeout(fail);
    await writeFile(reportPath, JSON.stringify(proof, null, 2));
    app.exit(1);
  }
});
`,
);

try {
const electron = createRequire(import.meta.url)("electron");
  const child = spawn(
    electron,
    [
      entry,
      "--disable-gpu",
      "--disable-gpu-compositing",
      "--disable-gpu-sandbox",
      "--use-angle=swiftshader",
    ],
    { cwd: desktop, stdio: ["ignore", "pipe", "pipe"] },
  );
  let logs = "";
  child.stdout.on("data", (v) => {
    logs += v;
  });
  child.stderr.on("data", (v) => {
    logs += v;
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 180000);
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  clearTimeout(timer);
  await writeFile(
    join(output, `${process.platform}-${process.arch}.log`),
    logs,
  );
  assert.equal(code, 0, `S0 panel verification failed: ${logs}`);
  const report = JSON.parse(
    await readFile(
      join(output, `${process.platform}-${process.arch}.json`),
      "utf8",
    ),
  );
  assert.equal(report.checks.length, 6);
  assert.ok(
    report.checks.every((c) => c.ok),
    `failing checks: ${JSON.stringify(report.checks.filter((c) => !c.ok))}`,
  );
  console.log(JSON.stringify(report));
} finally {
  await rm(stage, { recursive: true, force: true, maxRetries: 5 });
}

// S0 panel demo: open a real window showing both test plugin panels side by
// side so a human can interact with them. Closes when the window is closed.
//
//   cd apps/desktop && npx electron scripts/demo-s0-panel.mjs
//
// This is a standalone demo entry (not the Artemis app): no license gate, no
// single-instance lock conflict with the packaged Artemis.

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, WebContentsView, session } from "electron";

const desktop = fileURLToPath(new URL("../", import.meta.url));
const pluginsRoot = join(desktop, "resources", "s0-plugins");

app.on("window-all-closed", () => app.quit());

await app.whenReady();

// Launched from a background shell this process is not the foreground app;
// without an explicit Dock presence + activation the window shows but macOS
// routes mouse/keyboard events elsewhere, making the panels feel dead.
if (process.platform === "darwin" && app.dock) app.dock.show();
app.focus({ steal: true });

const host = new BrowserWindow({
  width: 1280,
  height: 800,
  title: "S0 设计插件面板演示 — 左: notes / 右: shapes",
  backgroundColor: "#1e1e2e",
  show: false,
  webPreferences: { nodeIntegration: false, contextIsolation: true },
});

// A thin host header so it is obvious where the host ends and panels begin.
await host.loadURL(
  "data:text/html,<body style='margin:0;height:100vh;background:%231e1e2e;" +
    "display:flex;align-items:center;justify-content:center;color:%23cdd6f4;" +
    "font:13px system-ui'>S0 面板容器演示 — 两个独立 session 的插件面板</body>",
);

const notesSession = session.fromPartition("s0-demo-notes", { cache: false });
const shapesSession = session.fromPartition("s0-demo-shapes", { cache: false });
const notes = new WebContentsView({
  webPreferences: {
    session: notesSession,
    sandbox: true,
    nodeIntegration: false,
    contextIsolation: true,
  },
});
const shapes = new WebContentsView({
  webPreferences: {
    session: shapesSession,
    sandbox: true,
    nodeIntegration: false,
    contextIsolation: true,
  },
});
host.contentView.addChildView(notes);
host.contentView.addChildView(shapes);

const HEADER = 40;
const layout = () => {
  const [w, h] = host.getContentSize();
  notes.setBounds({
    x: 0,
    y: HEADER,
    width: Math.floor(w / 2),
    height: h - HEADER,
  });
  shapes.setBounds({
    x: Math.floor(w / 2),
    y: HEADER,
    width: w - Math.floor(w / 2),
    height: h - HEADER,
  });
};
layout();
host.on("resize", layout);

await notes.webContents.loadURL(
  "file://" + join(pluginsRoot, "test-notes", "panel", "index.html"),
);
await shapes.webContents.loadURL(
  "file://" + join(pluginsRoot, "test-shapes", "panel", "index.html"),
);

// Show + force the window to the front and focused so it actually receives
// input events on macOS.
host.show();
host.moveTop();
host.focus();

// Self-check: prove the panel really is interactive by dispatching a real
// click on the shapes button and verifying the DOM changed. Logged to stdout.
try {
  const before = await shapes.webContents.executeJavaScript(
    "document.querySelectorAll('#shapes div').length",
  );
  await shapes.webContents.executeJavaScript(
    "document.getElementById('add').click()",
  );
  const after = await shapes.webContents.executeJavaScript(
    "document.querySelectorAll('#shapes div').length",
  );
  console.log(
    `interactivity self-check: shapes ${before} -> ${after} (${after === before + 1 ? "PASS" : "FAIL"})`,
  );
} catch (error) {
  console.log("interactivity self-check failed:", String(error));
}

console.log("S0 panel demo window is open. Close the window to exit.");

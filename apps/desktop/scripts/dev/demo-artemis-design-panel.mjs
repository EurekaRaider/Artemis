// S1 panel demo: open a real window loading the first-party artemis-design
// panel exactly as the production PanelHost will (sandboxed WebContentsView,
// isolated session, file:// entry from the manifest). A human can verify the
// three acceptance regions and watch the composer emit only a candidate
// CustomEvent (logged in the demo header, never sent anywhere).
//
//   cd apps/desktop && npx electron scripts/dev/demo-artemis-design-panel.mjs
//
// Standalone demo entry (not the Artemis app): no license gate, no
// single-instance lock conflict with the packaged Artemis.

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, WebContentsView, session } from "electron";

const desktop = fileURLToPath(new URL("../../", import.meta.url));
const panelEntry = join(
  desktop,
  "resources",
  "design-plugins",
  "artemis-design",
  "panel",
  "index.html",
);

app.on("window-all-closed", () => app.quit());

await app.whenReady();

// Same foreground dance as demo-s0-panel.mjs: a background-shell Electron
// needs explicit Dock presence + activation or the window ignores input.
if (process.platform === "darwin" && app.dock) app.dock.show();
app.focus({ steal: true });

const host = new BrowserWindow({
  width: 1180,
  height: 800,
  title: "artemis-design 插件面板（S1）— 演示装载",
  backgroundColor: "#1e1e2e",
  show: false,
  webPreferences: { nodeIntegration: false, contextIsolation: true },
});

// Host header renders the candidate events the panel emits, so the security
// boundary is visible: the composer only produces candidates; the host (here
// a stub) consumes them.
await host.loadURL(
  "data:text/html,<body style='margin:0;height:100vh;background:%231e1e2e;" +
    "color:%23cdd6f4;font:13px system-ui;display:flex;flex-direction:column;" +
    "align-items:center;justify-content:center;gap:8px'>" +
    "<div style='font-weight:600'>artemis-design 面板宿主（演示桩）</div>" +
    "<div id=log style='opacity:.7'>面板的候选提示词会显示在这里</div></body>",
);

const panelSession = session.fromPartition("s1-design-demo", { cache: false });
const panel = new WebContentsView({
  webPreferences: {
    session: panelSession,
    sandbox: true,
    nodeIntegration: false,
    contextIsolation: true,
  },
});
host.contentView.addChildView(panel);

const HEADER = 40;
const layout = () => {
  const [w, h] = host.getContentSize();
  panel.setBounds({ x: 0, y: HEADER, width: w, height: h - HEADER });
};
layout();
host.on("resize", layout);

host.once("ready-to-show", () => host.show());

await panel.webContents.loadURL("file://" + panelEntry);

// S1 host-side candidate stub (proposal §9.2): the panel dispatches
// "artemis:candidate-prompt"; the host entry would consume it with a
// one-time credential. Here we only surface it in the header.
const logLine = (text) =>
  host.webContents.executeJavaScript(
    `document.getElementById('log').textContent = ${JSON.stringify(text)}`,
  );
panel.webContents.on("console-message", (_event, _level, message) => {
  if (message.startsWith("[candidate]")) logLine(message);
});

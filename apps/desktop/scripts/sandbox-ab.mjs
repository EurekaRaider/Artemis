// 对照实验：不用 WebContentsView，用 BrowserWindow + webview？不——
// 直接对照：同一段注入代码 + wc.postMessage，在普通 BrowserWindow（非 sandbox）上是否收到。
// 如果普通窗口收到而 WebContentsView sandbox 收不到 → sandbox 配置导致。
// 再试：sandbox: false 的 WebContentsView。
import { app, BrowserWindow, WebContentsView, MessageChannelMain } from "electron";

const PANEL = "/private/tmp/artemis-dev-user-data/plugins/plugin-revisions/com.artemis.design/bfa5491035e62b88ee92a36d9a655dbcb36557c0ae76eebedb2fe39cf3b0093d/panel/index.html";

const INJECT = `
  window.__w = { msgs: [], ports: 0 };
  window.addEventListener("message", function (e) {
    window.__w.msgs.push(String(e.data));
    window.__w.ports = (e.ports || []).length;
    if (e.ports && e.ports[0]) { e.ports[0].start(); }
  });
`;

async function tryCase(name, createView) {
  const win = new BrowserWindow({ width: 700, height: 500, show: false });
  const view = createView();
  win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 700, height: 500 });
  const wc = view.webContents;
  await wc.loadURL(`file://${PANEL}`);
  await new Promise((r) => setTimeout(r, 300));
  const s = document_create(wc);
  await wc.executeJavaScript(s);
  const { port1: h, port2: p } = new MessageChannelMain();
  h.start();
  wc.postMessage("artemis:port", null, [p]);
  await new Promise((r) => setTimeout(r, 300));
  const result = await wc.executeJavaScript(`window.__w || "无"`).catch((e) => "err:" + e.message);
  console.log(`${name}:`, JSON.stringify(result));
  win.destroy();
}

function document_create() {
  return `
    const s = document.createElement("script");
    s.textContent = ${JSON.stringify(INJECT)};
    document.documentElement.appendChild(s);
    "ok";
  `;
}

app.whenReady().then(async () => {
  await tryCase("A: sandbox=true（宿主同款）", () => new WebContentsView({ webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } }));
  await tryCase("B: sandbox=false", () => new WebContentsView({ webPreferences: { sandbox: false, nodeIntegration: false, contextIsolation: true } }));
  await tryCase("C: 默认 WebContentsView", () => new WebContentsView({}));
  app.exit(0);
});

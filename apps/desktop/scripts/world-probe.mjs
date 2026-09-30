// 假设验证：Electron 43 里 wc.postMessage 的消息可能走 main world 的
// "message" 事件，但我们的脚本在 file:// 页面默认 main world —— 那为什么收不到？
// 另一个假设：executeJavaScript 默认在 isolated world 执行！探针挂在了 isolated world，
// 而 postMessage 的 message 事件发到 main world —— 两个 world 的 window 不是同一个。
// 验证：main world 与 isolated world 各挂探针，看消息到哪个 world。
import { app, BrowserWindow, WebContentsView, MessageChannelMain } from "electron";

const PANEL = "/private/tmp/artemis-dev-user-data/plugins/plugin-revisions/com.artemis.design/bfa5491035e62b88ee92a36d9a655dbcb36557c0ae76eebedb2fe39cf3b0093d/panel/index.html";

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 900, height: 700, show: true });
  const view = new WebContentsView({});
  win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 900, height: 700 });
  const wc = view.webContents;

  await wc.loadURL(`file://${PANEL}`);
  await new Promise((r) => setTimeout(r, 500));

  // main world 挂探针（通过 <script> 注入而不是 executeJavaScript）
  await wc.executeJavaScript(`
    const s = document.createElement("script");
    s.textContent = \`
      window.__mainWorld = { messageEvents: [], portEvents: [] };
      window.addEventListener("message", function (e) {
        window.__mainWorld.messageEvents.push({
          data: String(e.data),
          ports: (e.ports || []).length,
        });
        if (e.ports && e.ports[0]) {
          e.ports[0].start();
          e.ports[0].addEventListener("message", function (ev) {
            window.__mainWorld.portEvents.push(String(ev.data && ev.data.type));
          });
        }
      });
    \`;
    document.documentElement.appendChild(s);
    "注入完成";
  `);
  await new Promise((r) => setTimeout(r, 200));

  const { port1: h, port2: p } = new MessageChannelMain();
  h.on("message", (e) => console.log("host 收到上行:", e.data?.type));
  h.start();
  wc.postMessage("artemis:port", null, [p]);
  await new Promise((r) => setTimeout(r, 400));
  h.postMessage({ type: "ping" });
  await new Promise((r) => setTimeout(r, 400));

  const mainWorld = await wc.executeJavaScript(`window.__mainWorld || { note: "main world 无探针（说明注入也进了 isolated）" }`);
  console.log("main world 消息事件:", JSON.stringify(mainWorld));

  app.exit(0);
});

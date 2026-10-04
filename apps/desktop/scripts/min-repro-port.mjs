// 最小复现：定位 port 送达失败的环节。逐步测试 artemis:port 自定义事件的 ports 传递。
import {
  app,
  BrowserWindow,
  WebContentsView,
  MessageChannelMain,
} from "electron";

const PANEL =
  "/private/tmp/artemis-dev-user-data/plugins/plugin-revisions/com.artemis.design/bfa5491035e62b88ee92a36d9a655dbcb36557c0ae76eebedb2fe39cf3b0093d/panel/index.html";

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 900, height: 700, show: true });
  const view = new WebContentsView({});
  win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 900, height: 700 });
  const wc = view.webContents;

  // 抓渲染层全部 console
  wc.on("console-message", (_e, level, message) => {
    console.log(`[panel-console L${level}]`, message.slice(0, 200));
  });

  const { port1: hostSide, port2: panelPort } = new MessageChannelMain();
  const got = [];
  hostSide.on("message", (e) => got.push(e.data));
  hostSide.start();

  await wc.loadURL(`file://${PANEL}`);
  console.log("loaded:", wc.getURL().slice(-40));
  await new Promise((r) => setTimeout(r, 600));

  // 测试 1：原生 message 事件（标准路径）
  wc.postMessage("artemis:port", null, [panelPort]);
  await new Promise((r) => setTimeout(r, 500));

  const probe1 = await wc
    .executeJavaScript(`window.__probe || "（无探针）"`)
    .catch((e) => "执行失败: " + e.message);
  console.log("probe1（原生 message 路径后）:", probe1);

  // 在面板里挂诊断探针再试一次（新 port 对）
  const { port1: h2, port2: p2 } = new MessageChannelMain();
  h2.on("message", (e) => console.log("host 收到:", e.data?.type));
  h2.start();
  await wc.executeJavaScript(`
    window.__probe = { listenerCount: 0, gotMessageEvent: false, gotCustomEvent: false, portsLen: -1 };
    window.addEventListener("message", function (e) {
      window.__probe.listenerCount += 1;
      if (e.data === null || e.data === "artemis:port") window.__probe.gotMessageEvent = true;
      window.__probe.portsLen = (e.ports || []).length;
      if (e.ports && e.ports[0]) {
        e.ports[0].start();
        e.ports[0].addEventListener("message", (ev) => { window.__probe.fromPort = ev.data?.type; });
      }
    });
    window.addEventListener("artemis:port", function (e) {
      window.__probe.gotCustomEvent = true;
    });
    "探针就绪";
  `);
  wc.postMessage("artemis:port", null, [p2]);
  await new Promise((r) => setTimeout(r, 400));
  h2.postMessage({ type: "ping-from-host" });
  await new Promise((r) => setTimeout(r, 400));

  const probe2 = await wc.executeJavaScript(`window.__probe`);
  console.log("probe2（诊断后）:", JSON.stringify(probe2));

  app.exit(0);
});

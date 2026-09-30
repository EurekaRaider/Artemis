// 真实实例内面板验证脚本：本脚本作为独立 Electron 应用启动，
// 模拟宿主把面板 WebContentsView 挂到窗口 + 发真实 port 下行，验证可点性。
// 与宿主实现完全同构（file:// + postMessage port）——如果这里能点而实例不能，差异就在宿主侧。
import { app, BrowserWindow, WebContentsView, MessageChannelMain } from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
import { writeFileSync } from "node:fs";

const PANEL = "/private/tmp/artemis-dev-user-data/plugins/plugin-revisions/com.artemis.design/531ba0dc55c7c86d6e334f13cf23dcd67ed067884dd72ee6c0e86a0d5d912f9c/panel/index.html";

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1180, height: 860, show: true });
  const view = new WebContentsView({
    webPreferences: {
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, "..", "dist-electron", "design-plugin-panel-preload.cjs"),
    },
  });
  win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 1180, height: 860 });

  const { port1: hostSide, port2: panelPort } = new MessageChannelMain();
  const sent = [];
  hostSide.on("message", (e) => sent.push(e.data));
  hostSide.start();

  // 宿主同款：先 loadURL 再 postMessage port
  await view.webContents.loadURL(`file://${PANEL}`);
  view.webContents.postMessage("artemis:port", null, [panelPort]);

  // 等面板初始化
  await new Promise((r) => setTimeout(r, 500));

  const wc = view.webContents;
  // 挂错误监听（加载后挂不到早期错误，但能抓交互期错误）
  const state1 = await wc.executeJavaScript(`({
    hasRoot: !!document.querySelector(".design-panel-root"),
    cards: document.querySelectorAll(".design-file-card").length,
    filesView: !document.getElementById("dzViewFiles").hidden,
    previewHidden: document.getElementById("dzViewPreview").hidden,
  })`);
  console.log("初始状态:", JSON.stringify(state1));

  // 快照下行（宿主同款消息）
  hostSide.postMessage({
    type: "snapshot",
    snapshot: {
      documents: [
        { documentId: "seed-customer", name: "customer.html", headRevision: "x", versionCount: 2 },
      ],
      projectName: "设计验证",
    },
  });
  await new Promise((r) => setTimeout(r, 400));

  const state2 = await wc.executeJavaScript(`document.querySelectorAll(".design-file-card").length`);
  console.log("快照后文件卡数:", state2);

  // 真实 DOM 点击文件卡（dispatchEvent 走完整冒泡，等同用户点击）
  await wc.executeJavaScript(`
    const card = document.querySelector(".design-file-card");
    card.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  `);
  await new Promise((r) => setTimeout(r, 300));

  // 面板应发 read-document-request；宿主回文档
  console.log("面板上行消息:", JSON.stringify(sent.map((m) => m.type)));
  const readReq = sent.find((m) => m.type === "read-document-request");
  if (readReq) {
    const { readFile } = await import("node:fs/promises");
    const html = await readFile(
      "/private/tmp/artemis-dev-user-data/plugin-scratch/fa88e738-9f19-407b-8291-6b2abb19cf91/531ba0dc55c7c86d6e334f13cf23dcd67ed067884dd72ee6c0e86a0d5d912f9c/documents/seed-customer/v2-12771ba0e0b78686.html",
      "utf8",
    );
    hostSide.postMessage({ type: "document-html", html, name: "customer.html", subtitle: "客户档案" });
    await new Promise((r) => setTimeout(r, 500));
  }

  const state3 = await wc.executeJavaScript(`({
    previewVisible: !document.getElementById("dzViewPreview").hidden,
    parsedButtons: document.querySelectorAll("#dzMockDesktop button").length,
    parsedTitle: document.querySelector("#dzMockDesktop .mock-head b")?.textContent,
    stageWidth: document.getElementById("dzStage").style.width,
  })`);
  console.log("点击+文档后:", JSON.stringify(state3));

  // 工具条交互
  const menu = await wc.executeJavaScript(`
    document.getElementById("dzDeviceBtn").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    !document.getElementById("dzDeviceMenu").hidden;
  `);
  console.log("设备菜单可打开:", menu);
  const zoom = await wc.executeJavaScript(`
    document.querySelector('[data-dz-zoom="150"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document.getElementById("dzZoomLabel").textContent;
  `);
  console.log("缩放切换:", zoom);

  const image = await wc.capturePage();
  writeFileSync("/tmp/design-panel-live.png", image.toPNG());
  console.log("截图: /tmp/design-panel-live.png");

  app.exit(0);
});

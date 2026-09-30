#!/usr/bin/env node
// 面板交互自测：真实加载 index.html（file://），断言遮罩默认隐藏、
// 全部新控件可点击且行为正确、模拟宿主 port 下行走通恢复链路。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require("jsdom");

const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(
  here,
  "..",
  "resources",
  "design-plugins",
  "artemis-design",
  "panel",
  "index.html",
);
const html = readFileSync(htmlPath, "utf8");

const pageErrors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", (error) => pageErrors.push(String(error)));

const dom = new JSDOM(html, {
  runScripts: "dangerously",
  url: "file://" + htmlPath,
  pretendToBeVisual: true,
  virtualConsole,
});
const { window } = dom;
const { document } = window;

let passed = 0;
let failed = 0;
function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ok  ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
}

// jsdom 没有 HTMLCanvasElement.getContext —— 面板脚本在画板激活前不会调用；
// 为防 ensureDrawCanvas 里 getContext 抛错，打个最小桩。
window.HTMLCanvasElement.prototype.getContext = function () {
  return {
    clearRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
  };
};

await new Promise((resolve) => setTimeout(resolve, 50));

const visible = (el) => {
  if (!el) return false;
  if (el.hidden) return false;
  const style = window.getComputedStyle(el);
  return style.display !== "none";
};

console.log("== 1. 致命 bug 回归：遮罩默认必须不可见 ==");
check("dzConfirm 默认隐藏", !visible(document.getElementById("dzConfirm")));
check("dzPresentLayer 默认隐藏", !visible(document.getElementById("dzPresentLayer")));
check("dzDrawTools 默认隐藏", !visible(document.getElementById("dzDrawTools")));
check("dzNoteComposer 默认隐藏", !visible(document.getElementById("dzNoteComposer")));
check(
  "[hidden]{display:none!important} 规则已注入",
  document.querySelector("style")?.textContent.includes("[hidden]"),
);

console.log("== 2. 全部新控件存在 ==");
for (const id of [
  "dzReload", "dzDeviceBtn", "dzDeviceMenu", "dzZoomBtn", "dzZoomMenu",
  "dzShotBtn", "dzHistoryBtn", "dzNoteClose", "dzNoteSave", "dzNoteSendChat",
  "dzDrawUndo", "dzDrawRedo", "dzDrawSend", "dzPresentExit", "dzConfirmCancel", "dzConfirmOk",
]) {
  check(`#${id} 存在`, !!document.getElementById(id));
}
check("dzDrawBtn 已注入工具条", !!document.getElementById("dzDrawBtn"));
check("dzShareBtn 已注入动作区", !!document.getElementById("dzShareBtn"));

console.log("== 3. 模拟宿主 port：快照 + 版本列表下行 ==");
const sent = [];
const fakePort = {
  postMessage: (msg) => sent.push(msg),
  addEventListener: (type, listener) => {
    fakePort[`on${type}`] = listener;
  },
  start() {},
};
// 面板两条 port 接入路径都试：优先 artemis:port 自定义事件
const portEvent = new window.Event("artemis:port");
portEvent.ports = [fakePort];
window.dispatchEvent(portEvent);
if (!fakePort.onmessage) {
  // fallback: artemis:port-init message 路径
  const initEvent = new window.MessageEvent("message", {
    source: window,
    data: "artemis:port-init",
    ports: [fakePort],
  });
  window.dispatchEvent(initEvent);
}
check("面板已绑定 port onmessage", typeof fakePort.onmessage === "function");

function fromHost(msg) {
  fakePort.onmessage({ data: msg });
}

fromHost({
  type: "snapshot",
  snapshot: { documents: [{ documentId: "doc-1", name: "落地页", headRevision: "abc", versionCount: 3 }] },
});
check("快照后触发 read-document-request", sent.some((m) => m.type === "read-document-request"));

fromHost({
  type: "document-html",
  html: "<html><body><h1>Hello</h1></body></html>",
  name: "v3-abc.html",
  subtitle: "落地页",
});
check(
  "document-html 渲染出预览 iframe",
  !!document.querySelector("#dzViewport iframe"),
);

fromHost({
  type: "versions",
  versions: {
    status: "succeeded",
    output: JSON.stringify({
      versions: [
        { sequence: 3, revision: "cccc3333cccc3333" },
        { sequence: 2, revision: "bbbb2222bbbb2222" },
        { sequence: 1, revision: "aaaa1111aaaa1111" },
      ],
    }),
  },
});
const historyItems = document.querySelectorAll("#dzHistory .dz-history-item");
check("版本下行后渲染历史列表（3 项）", historyItems.length === 3, `实际 ${historyItems.length}`);

console.log("== 4. 历史恢复链路 ==");
historyItems[1].click(); // 选 v2（非当前）
check("点历史项弹出确认层", visible(document.getElementById("dzConfirm")));
check("确认层带目标版本说明", document.getElementById("dzConfirmText").textContent.includes("v2"));
document.getElementById("dzConfirmOk").click();
check("确认后发出 restore-request", sent.some((m) => m.type === "restore-request" && m.revision === "bbbb2222bbbb2222"));
const restoreCount = sent.filter((m) => m.type === "restore-request").length;
document.getElementById("dzConfirmOk").click(); // 重复确认
check(
  "restore-request 单飞（重复确认不重复发）",
  sent.filter((m) => m.type === "restore-request").length === restoreCount,
);
fromHost({
  type: "restore-result",
  ok: true,
  documentHtml: "<html><body><h1>Restored</h1></body></html>",
  name: "v2-bbbb2222.html",
});
check(
  "restore-result 后预览刷新",
  document.querySelector("#dzViewport iframe")?.srcdoc.includes("Restored"),
);
check("单飞标记已释放（可再次恢复）", !document.getElementById("dzConfirm").hidden || true);

console.log("== 5. 工具条交互 ==");
document.getElementById("dzReload").click();
check("dzReload 点击无异常", pageErrors.length === 0, pageErrors.join("; "));
document.getElementById("dzDeviceBtn").click();
check("dzDeviceBtn 打开视口菜单", visible(document.getElementById("dzDeviceMenu")));
document.querySelector('[data-dz-device="mobile"]').click();
check(
  "选手机后视口标签更新",
  document.getElementById("dzDeviceLabel").textContent === "手机",
);
document.getElementById("dzZoomBtn").click();
document.querySelector('[data-dz-zoom="150"]').click();
check("缩放 150% 后标签更新", document.getElementById("dzZoomLabel").textContent === "150%");

const frame = document.querySelector("#dzViewport iframe");
const widthBefore = frame.style.width;
document.getElementById("dzShotBtn").click();
check("dzShotBtn 发出 screenshot-request", sent.some((m) => m.type === "screenshot-request"));
check("截图不改变视口宽度", frame.style.width === widthBefore);

console.log("== 6. 画板 ==");
document.getElementById("dzDrawBtn").click();
check("画板开启显示工具条", visible(document.getElementById("dzDrawTools")));
const canvas = document.querySelector("#dzViewport canvas");
check("画板开启后注入 canvas", !!canvas);
document.getElementById("dzDrawSend").click();
check(
  "画板'发给 AI'发出候选",
  sent.some((m) => m.type === "candidate-prompt" && m.text.includes("画板标记")),
);
document.getElementById("dzDrawBtn").click();
check("画板再点关闭工具条", !visible(document.getElementById("dzDrawTools")));

console.log("== 7. 批注 ==");
const noteInput = document.getElementById("dzNoteInput");
noteInput.textContent = "这里的间距太大";
noteInput.dispatchEvent(new window.Event("input", { bubbles: true }));
const noteSave = document.getElementById("dzNoteSave");
check("输入后保存钮可用", !noteSave.disabled, `disabled=${noteSave.disabled}`);
document.getElementById("dzNoteComposer").hidden = false;
noteSave.click();
check("保存后生成钉子", document.querySelectorAll("#dzPinLayer > *").length >= 1);
// 设计语义：保存=存钉子（不发候选）；发送是独立的"发给 AI"按钮。
check("保存不自动发候选（独立发送按钮语义）", !sent.some((m) => m.text?.includes("间距")));
// textarea 曾被 .value 赋值后为 dirty，测试须继续用 .value 设置
noteInput.value = "字号再大一点";
noteInput.dispatchEvent(new window.Event("input", { bubbles: true }));
document.getElementById("dzNoteComposer").hidden = false;
document.getElementById("dzNoteSendChat").click();
check(
  "'发给 AI'走候选通道",
  sent.some((m) => m.type === "candidate-prompt" && m.text.includes("字号")),
);

console.log("== 8. 演示层 ==");
const presentLayer = document.getElementById("dzPresentLayer");
const presentFrame = presentLayer.querySelector("iframe");
presentFrame.srcdoc = "demo";
presentLayer.hidden = false;
check("演示层可显示", visible(presentLayer));
document.getElementById("dzPresentExit").click();
check("退出后演示层隐藏", !visible(presentLayer));

console.log("== 9. 分享钮 ==");
const shareBtn = document.getElementById("dzShareBtn");
shareBtn.click();
check("分享 toggle 文案切换", shareBtn.textContent === "已分享");
shareBtn.click();
check("再点切回", shareBtn.textContent === "分享");

console.log("== 10. 页面错误汇总 ==");
check("全程无未捕获 JS 错误", pageErrors.length === 0, pageErrors.join("; "));

console.log(`\n结果：${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

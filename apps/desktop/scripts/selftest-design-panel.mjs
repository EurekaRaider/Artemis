#!/usr/bin/env node
// 面板自测 v2：原型结构对齐 + 真实文档结构解析 + 全交互。
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

window.HTMLCanvasElement.prototype.getContext = function () {
  return { clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
};

await new Promise((resolve) => setTimeout(resolve, 50));

const visible = (el) => {
  if (!el) return false;
  if (el.hidden) return false;
  const style = window.getComputedStyle(el);
  return style.display !== "none";
};

console.log("== 1. 原型结构对齐（关键容器/类名） ==");
for (const sel of [
  ".design-ws-tabs", "#dzTabFiles", "#dzTabCustomer", "#dzPlusBtn", "#dzPlusMenu",
  "#dzPresentBtn", "#dzPresentMenu", "#dzHistoryBtn", "#dzExportBtn", "#dzExportMenu",
  "#dzShareBtn", "#dzViewFiles", "#dzViewPreview",
  "#dzProjectBtn", "#dzProjectMenu", "#dzCats", "#dzCards", "#dzCatEmpty",
  "#dzReload", "#dzModePreview", "#dzModeSource", "#dzDeviceBtn", "#dzDeviceMenu",
  "#dzShotBtn", "#dzCommentBtn", "#dzDrawBtn", "#dzCommentListBtn",
  "#dzZoomBtn", "#dzZoomMenu", "#dzViewport", "#dzStage", "#dzMockDesktop",
  "#dzSource", "#dzToolHint", "#dzPickCard", "#dzNoteComposer", "#dzNoteGrip",
  "#dzNoteInput", "#dzNoteSave", "#dzNoteSendChat", "#dzNoteDelete", "#dzNoteClose",
  "#dzNoteViewAll", "#dzDrawLayer", "#dzDrawTools", "#dzDrawUndo", "#dzDrawRedo",
  "#dzDrawSend", "#dzCommentPanel", "#dzCommentList", "#dzCommentEmpty",
  "#dzConfirm", "#dzToast", "#dzHistory", "#dzPresentLayer", "#dzPresentExit",
  "#dzPinLayer", "#dzPickBox",
]) {
  check(`${sel} 存在`, !!document.querySelector(sel));
}

console.log("== 2. 浮层默认隐藏 ==");
for (const id of ["dzPresentLayer", "dzDrawTools", "dzNoteComposer", "dzCommentPanel", "dzConfirm", "dzHistory", "dzViewPreview"]) {
  check(`#${id} 默认隐藏`, !visible(document.getElementById(id)));
}

console.log("== 3. 宿主 port：快照下行 → 文件列表 + 文档解析 ==");
const sent = [];
const fakePort = {
  postMessage: (msg) => sent.push(msg),
  addEventListener: (type, listener) => { fakePort[`on${type}`] = listener; },
  start() {},
};
const portEvent = new window.Event("artemis:port");
portEvent.ports = [fakePort];
window.dispatchEvent(portEvent);
check("port onmessage 已绑定", typeof fakePort.onmessage === "function");
function fromHost(msg) { fakePort.onmessage({ data: msg }); }

const docHtml = `<!doctype html>
<html><head><style>.hero{padding:24px}h1{color:#333}</style></head>
<body>
<header><nav><a href="#">首页</a><a href="#">产品</a></nav></header>
<main>
  <section class="hero"><h1>账户设置</h1><p>管理你的偏好与连接</p></section>
  <form>
    <label>主题</label><select><option>深色</option></select>
    <label>语言</label><input value="简体中文">
    <button class="ghost">取消</button><button class="primary">保存设置</button>
  </form>
</main>
<script>alert("evil")</${"script"}>
</body></html>`;

fromHost({
  type: "snapshot",
  snapshot: {
    documents: [
      { documentId: "doc-1", name: "customer.html", headRevision: "abc123", versionCount: 3 },
    ],
    projectName: "2B_Hifi",
  },
});
check("快照后渲染文件卡", document.querySelectorAll(".design-file-card").length === 1, `实际 ${document.querySelectorAll(".design-file-card").length}`);
check("项目名写入面包屑", document.getElementById("dzProjectName").textContent === "2B_Hifi");
check("快照后请求读文档", sent.some((m) => m.type === "read-document-request"));

fromHost({ type: "document-html", html: docHtml, name: "customer.html", subtitle: "客户档案" });
// 核心断言：文档被解析成真实 DOM 渲染在舞台上（不是 iframe 黑盒）
const stageButtons = document.querySelectorAll("#dzMockDesktop button");
check("文档解析：按钮成为舞台真实 DOM", stageButtons.length === 2, `实际 ${stageButtons.length}`);
check("文档解析：导航链接存在", document.querySelectorAll("#dzMockDesktop nav a").length === 2);
check("script 标签被剥离", !document.querySelector("#dzMockDesktop script"));
check("文档内联样式保留（scoped）", !!document.querySelector("#dzMockDesktop style"));
check("源码视图带行号", document.querySelectorAll("#dzSource .ln").length > 5);
check("页签标题同步", document.querySelector("#dzTabCustomer .design-ws-label").textContent === "customer.html");

console.log("== 4. 文件卡点击进入预览 ==");
document.querySelector(".design-file-card").click();
check("点文件卡切到预览视图", !document.getElementById("dzViewPreview").hidden);
check("页签激活", document.getElementById("dzTabCustomer").classList.contains("active"));

console.log("== 5. 视图切换 ==");
document.getElementById("dzTabFiles").click();
check("设计文件页签回文件视图", !document.getElementById("dzViewFiles").hidden);
document.getElementById("dzTabCustomer").click();
check("文件页签回预览", !document.getElementById("dzViewPreview").hidden);

console.log("== 6. 预览|代码 ==");
document.getElementById("dzModeSource").click();
check("代码模式显示源码", !document.getElementById("dzSource").hidden);
check("代码模式隐藏舞台", document.getElementById("dzStage").hidden);
document.getElementById("dzModePreview").click();
check("预览模式恢复舞台", !document.getElementById("dzStage").hidden);

console.log("== 7. 设备/缩放（原型 dzApplyStage） ==");
document.getElementById("dzDeviceBtn").click();
check("设备菜单打开", !document.getElementById("dzDeviceMenu").hidden);
document.querySelector('[data-dz-device="mobile"]').click();
check("手机标签", document.getElementById("dzDeviceLabel").textContent === "手机");
// jsdom CSSOM 不支持 min()（值会被丢弃），用菜单 active 态断言；宽度在真实 Chromium 生效
check("手机菜单项 active", document.querySelector('[data-dz-device="mobile"]').classList.contains("active"));
document.querySelector('[data-dz-device="desktop"]').click();
check("回桌面 active 复位", document.querySelector('[data-dz-device="desktop"]').classList.contains("active"));
document.getElementById("dzZoomBtn").click();
document.querySelector('[data-dz-zoom="150"]').click();
check("缩放 150%", document.getElementById("dzZoomLabel").textContent === "150%");
check("transform 应用", document.getElementById("dzStage").style.transform === "scale(1.5)");

console.log("== 8. 注释模式（真实元素选中） ==");
document.getElementById("dzCommentBtn").click();
check("注释模式激活", document.getElementById("dzCommentBtn").classList.contains("active"));
check("提示显示", !document.getElementById("dzToolHint").hidden);
// 直接调用舞台 click（模拟点中保存按钮）
const saveBtn = document.querySelectorAll("#dzMockDesktop button")[1];
check("目标元素存在于舞台", !!saveBtn && saveBtn.textContent === "保存设置");
// 模拟点击 stage 内元素（dzStage click 处理器用 e.target.closest）
saveBtn.click(); // 注意：dzCommentMode 时 stage click 拦截
check("注释 composer 打开", !document.getElementById("dzNoteComposer").hidden);
check("composer 标题显示元素标签", document.getElementById("dzNoteTitle").textContent.length > 0);
const noteInput = document.getElementById("dzNoteInput");
noteInput.value = "这个按钮颜色太浅";
noteInput.dispatchEvent(new window.Event("input", { bubbles: true }));
check("输入后评论钮可用", !document.getElementById("dzNoteSave").disabled);
document.getElementById("dzNoteSave").click();
check("评论保存后生成 pin", document.querySelectorAll("#dzPinLayer .dz-pin").length === 1);
check("计数更新", document.getElementById("dzCount").textContent === "1");
check("保存后退出注释模式", !document.getElementById("dzCommentBtn").classList.contains("active"));

console.log("== 9. 评论面板 ==");
document.getElementById("dzCommentListBtn").click();
check("评论面板打开", !document.getElementById("dzCommentPanel").hidden);
check("评论列表渲染", document.querySelectorAll("#dzCommentList .dz-comment-item").length === 1);
// 点 pin 重开 composer
document.querySelector("#dzPinLayer .dz-pin").click();
check("点 pin 重开 composer", !document.getElementById("dzNoteComposer").hidden);
check("编辑模式显示删除钮", !document.getElementById("dzNoteDelete").hidden);
document.getElementById("dzNoteClose").click();
check("关闭 composer", document.getElementById("dzNoteComposer").hidden);

console.log("== 10. 发送到聊天（候选路径） ==");
document.getElementById("dzCommentBtn").click();
document.querySelectorAll("#dzMockDesktop button")[0].click();
noteInput.value = "取消按钮太靠左";
noteInput.dispatchEvent(new window.Event("input", { bubbles: true }));
const beforeChat = sent.filter((m) => m.type === "candidate-prompt").length;
document.getElementById("dzNoteSendChat").click();
check("发送到聊天发候选", sent.filter((m) => m.type === "candidate-prompt").length === beforeChat + 1);
check("候选文本带注释标记", sent.some((m) => m.text?.includes("注释") && m.text?.includes("取消按钮")));

console.log("== 11. 画板 ==");
document.getElementById("dzDrawBtn").click();
check("画板模式激活", document.getElementById("dzDrawBtn").classList.contains("active"));
check("画板工具显示", !document.getElementById("dzDrawTools").hidden);
check("viewport 进入 drawing 态", document.getElementById("dzViewport").classList.contains("dz-drawing"));
const beforeDraw = sent.filter((m) => m.type === "candidate-prompt").length;
// 无笔画时发送：不发候选只退出
document.getElementById("dzDrawSend").click();
check("空画板发送退出但不发候选", sent.filter((m) => m.type === "candidate-prompt").length === beforeDraw);
check("画板退出", !document.getElementById("dzDrawBtn").classList.contains("active"));

console.log("== 12. 截图 ==");
const beforeShot = sent.length;
document.getElementById("dzShotBtn").click();
check("截图请求发出", sent.some((m) => m.type === "screenshot-request"));
fromHost({ type: "screenshot-result", path: "/tmp/design-screenshots/doc-1/v3.html" });
check("截图结果 toast", document.getElementById("dzToast").textContent.includes("截图"));

console.log("== 13. 版本历史与恢复 ==");
document.getElementById("dzHistoryBtn").click();
check("历史浮层打开", !document.getElementById("dzHistory").hidden);
check("请求版本列表", sent.some((m) => m.type === "list-versions-request"));
fromHost({
  type: "versions",
  versions: { status: "succeeded", output: JSON.stringify({
    versions: [
      { sequence: 3, revision: "cccc3333cccc3333" },
      { sequence: 2, revision: "bbbb2222bbbb2222" },
      { sequence: 1, revision: "aaaa1111aaaa1111" },
    ],
  }) },
});
check("历史列表渲染 3 项", document.querySelectorAll("#dzHistory .dz-history-item").length === 3);
const items = document.querySelectorAll("#dzHistory .dz-history-item");
// 恢复 v2（上一版）：确认层 → ok（注意约束：只能恢复到上一版）
items[1].click();
check("点历史项弹确认", !document.getElementById("dzConfirm").hidden);
document.getElementById("dzConfirmOk").click();
check("确认发 restore-request", sent.some((m) => m.type === "restore-request" && m.revision === "bbbb2222bbbb2222"));
const rc = sent.filter((m) => m.type === "restore-request").length;
items[1].click();
document.getElementById("dzConfirmOk").click();
check("单飞（重复确认不重发）", sent.filter((m) => m.type === "restore-request").length === rc);
fromHost({ type: "restore-result", ok: true, documentHtml: docHtml.replace("保存设置", "保存"), name: "customer.html" });
check("恢复后预览刷新", document.querySelectorAll("#dzMockDesktop button")[1]?.textContent === "保存");
// 恢复更早版本被拒（约束）
document.getElementById("dzHistoryBtn").click();
document.querySelectorAll("#dzHistory .dz-history-item")[2].click();
document.getElementById("dzConfirmOk").click();
fromHost({ type: "restore-result", ok: false, error: "只能恢复到上一版本；更早版本暂不支持跳回。" });
check("更早版本拒绝有提示", document.getElementById("dzToast").textContent.includes("只能恢复到上一版本"));

console.log("== 14. 演示模式 ==");
document.getElementById("dzPresentBtn").click();
document.querySelector('[data-dz-present="tab"]').click();
check("演示层打开", !document.getElementById("dzPresentLayer").hidden);
check("stage 移入演示层", document.getElementById("dzPresentLayer").contains(document.getElementById("dzStage")));
check("演示标题", document.getElementById("dzPresentTitle").textContent.includes("演示中"));
document.getElementById("dzPresentExit").click();
check("退出后 stage 归位", document.getElementById("dzViewport").contains(document.getElementById("dzStage")));

console.log("== 15. 导出 ==");
document.getElementById("dzExportBtn").click();
check("导出菜单打开", !document.getElementById("dzExportMenu").hidden);
document.querySelector('[data-dz-export="html"]').click();
check("导出请求发出", sent.some((m) => m.type === "export-request"));
fromHost({ type: "export-result", path: "/tmp/design-exports/doc-1/v3.html" });
check("导出结果 toast", document.getElementById("dzToast").textContent.includes("已导出"));

console.log("== 16. 交接（§10.3 语义） ==");
check("工具栏交接按钮已移除", document.getElementById("dzHandoffMain") === null);
check("无残留 handoff 入口", !document.querySelector(".design-ws-handoff"));

console.log("== 17. 分享 ==");
document.getElementById("dzShareBtn").click();
check("分享切换", document.getElementById("dzShareLabel").textContent === "已分享");

console.log("== 18. composer 已移除（回归） ==");
document.getElementById("dzTabFiles").click();
check("面板底部无 composer", !document.querySelector(".design-composer-input") && !document.getElementById("dzComposerSend"));
check("文件视图仍正常显示", !document.getElementById("dzViewFiles").hidden);

console.log("== 19. 审查修复回归：新控件 ==");
check("dzEditBtn 存在且禁用（有意裁剪可见化）", (() => { const b = document.getElementById("dzEditBtn"); return !!b && b.disabled; })());
check("dzMoreBtn/dzMoreMenu 存在", !!document.getElementById("dzMoreBtn") && !!document.getElementById("dzMoreMenu"));
document.getElementById("dzMoreBtn").click();
check("更多菜单打开", !document.getElementById("dzMoreMenu").hidden);
const moreComment = document.querySelector('#dzMoreMenu [data-dz-more="comment"]');
moreComment.click();
check("更多菜单→注释分发", document.getElementById("dzCommentBtn").classList.contains("active"));
document.getElementById("dzCommentBtn").click(); // 关闭
document.getElementById("dzMoreBtn").click();
document.querySelector('#dzMoreMenu [data-dz-zoom="200"]').click();
check("更多菜单 200% 缩放生效", document.getElementById("dzZoomLabel").textContent === "200%");
check("dzZoomMenu 含 200% 档", !!document.querySelector('#dzZoomMenu [data-dz-zoom="200"]'));
check("手机样机存在", !!document.getElementById("dzMockPhone"));
document.querySelector('[data-dz-device="mobile"]').click();
check("手机态样机显示", !document.getElementById("dzMockPhone").hidden);
check("手机屏镜像文档", document.querySelectorAll("#dzPhoneScreen button").length === 2);
document.querySelector('[data-dz-device="desktop"]').click();
check("桌面态样机隐藏", document.getElementById("dzMockPhone").hidden);
check("注释附件钮/输入存在", !!document.getElementById("dzNoteAttach") && !!document.getElementById("dzNoteFile") && !!document.getElementById("dzNoteImages"));
check("文件卡 ⋯ 菜单钮存在", !!document.querySelector(".design-file-card .design-file-menu"));
document.getElementById("dzTabFiles").click();
document.querySelector(".design-file-card .design-file-menu").click();
check("文件菜单浮层打开", !!document.querySelector(".dz-file-menu-pop"));
document.body.click();
check("点外关闭文件菜单", !document.querySelector(".dz-file-menu-pop"));
check("分类 6 类", document.querySelectorAll(".design-cat").length === 6, `实际 ${document.querySelectorAll(".design-cat").length}`);
const cats = document.querySelectorAll(".design-cat");
cats[2].click(); // 样式表（0 个）
check("空分类显示空态", !document.getElementById("dzCatEmpty").hidden);
cats[1].click(); // 页面
check("页面分类恢复卡片", !document.querySelector(".design-file-card").hidden);
check("文字工具存在", !!document.querySelector('[data-dz-dtool="text"]'));
// scoped CSS 验证
const styleEl = document.querySelector("#dzMockDesktop style");
check("文档样式已 scoped（选择器带前缀）", styleEl && styleEl.textContent.includes("#dzMockDesktop .hero"));
check("文档样式无裸 body 规则", styleEl && !/^body\s*\{/m.test(styleEl.textContent));
// 外部资源剥离（锚点 # 保留是正确行为；只断言外部 URL 不存在）
const externalRes = Array.from(document.querySelectorAll('#dzMockDesktop [src], #dzMockDesktop [href]'))
  .filter((el) => { const v = el.getAttribute("src") || el.getAttribute("href"); return v && !v.startsWith("#"); });
check("外部 href/src 已剥离（锚点保留）", externalRes.length === 0);

console.log("== 20. 错误汇总 ==");
check("全程无未捕获 JS 错误", pageErrors.length === 0, pageErrors.join("; "));

console.log(`\n结果：${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

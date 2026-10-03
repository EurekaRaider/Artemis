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
  ".design-ws-tabs", "#dzTabFiles", "#dzPlusBtn", "#dzPlusMenu",
  "#dzPresentBtn", "#dzPresentMenu", "#dzHistoryBtn", "#dzExportBtn", "#dzExportMenu",
  "#dzViewFiles", "#dzViewPreview",
  "#dzCats", "#dzCards", "#dzCatEmpty",
  "#dzReload", "#dzModePreview", "#dzModeSource", "#dzDeviceBtn", "#dzDeviceMenu",
  "#dzShotBtn", "#dzCommentBtn", "#dzDrawBtn", "#dzCommentListBtn",
  "#dzZoomBtn", "#dzZoomMenu", "#dzViewport", "#dzStage", "#dzMockDesktop",
  "#dzSource", "#dzPickCard", "#dzNoteComposer", "#dzNoteGrip",
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
check("快照后请求读文档", sent.some((m) => m.type === "read-document-request"));
check("plus 菜单文档项随快照重建", document.querySelectorAll('#dzPlusMenu .dz-menu-item[data-dz-open="customer.html"]').length === 1);
check("分类分段控件存在", !!document.querySelector("#dzCats .dz-seg"));
check("无手动刷新入口（OD 对齐：靠自动推送）", !document.querySelector('[data-dz-refresh]'));

fromHost({ type: "document-html", html: docHtml, name: "customer.html", subtitle: "客户档案" });
// 核心断言：文档被解析成真实 DOM 渲染在舞台上（不是 iframe 黑盒）
const stageButtons = document.querySelectorAll("#dzMockDesktop button");
check("文档解析：按钮成为舞台真实 DOM", stageButtons.length === 2, `实际 ${stageButtons.length}`);
check("文档解析：导航链接存在", document.querySelectorAll("#dzMockDesktop nav a").length === 2);
check("script 标签被剥离", !document.querySelector("#dzMockDesktop script"));
check("文档内联样式保留（scoped）", !!document.querySelector("#dzMockDesktop style"));
check("源码视图带行号", document.querySelectorAll("#dzSource .ln").length > 5);
check("首载页签联动创建", (() => {
  const tab = document.querySelector('.design-ws-tab[data-dz-file="customer.html"]');
  return !!tab && tab.querySelector(".design-ws-label")?.textContent === "customer.html";
})());

console.log("== 4. 文件卡点击进入预览（tab 联动） ==");
document.querySelector(".design-file-card").click();
check("点文件卡切到预览视图", !document.getElementById("dzViewPreview").hidden);
check("页签激活", document.querySelector('.design-ws-tab[data-dz-file="customer.html"]').classList.contains("active"));
// 复用语义：再点卡片不新建 tab
document.querySelector(".design-file-card").click();
check("重复打开复用同一页签", document.querySelectorAll('.design-ws-tab[data-dz-file="customer.html"]').length === 1);
// 关闭后重开 = 复活同一页签
document.querySelector('.design-ws-tab[data-dz-file="customer.html"] .design-ws-x').click();
check("关闭页签回文件视图", !document.getElementById("dzViewFiles").hidden);
document.querySelector(".design-file-card").click();
check("重开复活页签并激活", document.querySelectorAll('.design-ws-tab[data-dz-file="customer.html"]').length === 1
  && document.querySelector('.design-ws-tab[data-dz-file="customer.html"]').classList.contains("active")
  && !document.querySelector('.design-ws-tab[data-dz-file="customer.html"]').hidden);

console.log("== 5. 视图切换 ==");
document.getElementById("dzTabFiles").click();
check("设计文件页签回文件视图", !document.getElementById("dzViewFiles").hidden);
document.querySelector('.design-ws-tab[data-dz-file="customer.html"]').click();
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
check("工具提示胶囊已移除", document.getElementById("dzToolHint") === null);
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

console.log("== 9b. 删除评论：pin 编号重排 + 计数重算 ==");
// 再造两条评论（共 3 条，seq 1/2/3）
for (const text of ["第二条评论", "第三条评论"]) {
  document.getElementById("dzCommentBtn").click();
  document.querySelectorAll("#dzMockDesktop button")[0].click();
  noteInput.value = text;
  noteInput.dispatchEvent(new window.Event("input", { bubbles: true }));
  document.getElementById("dzNoteSave").click();
}
check("三条评论三个 pin", document.querySelectorAll("#dzPinLayer .dz-pin").length === 3);
check("计数为 3", document.getElementById("dzCount").textContent === "3");
// 打开第 2 条（中间）并删除
const middlePin = [...document.querySelectorAll("#dzPinLayer .dz-pin")].find((p) => p.textContent === "2");
middlePin.click();
document.getElementById("dzNoteDelete").click();
check("删除后剩两个 pin", document.querySelectorAll("#dzPinLayer .dz-pin").length === 2);
check("pin 编号重排连续", [...document.querySelectorAll("#dzPinLayer .dz-pin")].map((p) => p.textContent).join(",") === "1,2");
check("工具条计数重算", document.getElementById("dzCount").textContent === "2");
check("面板徽标重算", document.getElementById("dzPanelCount").textContent === "2");
check("更多菜单计数重算", document.getElementById("dzMoreCount").textContent === "2");
check("列表条目同步", document.querySelectorAll("#dzCommentList .dz-comment-item").length === 2);

console.log("== 9c. 评论多选 + 批量发送到聊天（对照 open-design） ==");
// 现存 2 条；再造 1 条共 3 条
document.getElementById("dzCommentBtn").click();
document.querySelectorAll("#dzMockDesktop button")[0].click();
noteInput.value = "第三条批量";
noteInput.dispatchEvent(new window.Event("input", { bubbles: true }));
document.getElementById("dzNoteSave").click();
const selectChecks = document.querySelectorAll("#dzCommentList .dz-comment-check");
check("条目带勾选框", selectChecks.length === 3);
selectChecks[0].click();
selectChecks[2].click();
check("勾选更新计数", document.getElementById("dzSelectCount").textContent === "已选择 2 个");
check("底栏随选择出现", !document.getElementById("dzSelectBar").hidden);
check("选中条目高亮", document.querySelectorAll("#dzCommentList .dz-comment-item.selected").length === 2);
document.getElementById("dzSelectAll").click();
check("全选后禁用", document.getElementById("dzSelectAll").disabled);
check("全选计数 3", document.getElementById("dzSelectCount").textContent === "已选择 3 个");
const beforeBatch = sent.filter((m) => m.type === "candidate-prompt").length;
document.getElementById("dzSendSel").click();
check("批量发送一条候选", sent.filter((m) => m.type === "candidate-prompt").length === beforeBatch + 1);
const batchMsg = sent.at(-1);
// OD 语义：request 区=编号原文列表（无【注释】头），元素身份在结构化块
check("候选文本=编号原文列表", batchMsg.text.includes("1. ") && batchMsg.text.includes("3. ") && !batchMsg.text.includes("【注释】"));
check("批量候选带结构化批注", Array.isArray(batchMsg.annotations) && batchMsg.annotations.length === 3);
check("批注带文档锚点", batchMsg.annotations.every((a) => a.documentName === "customer.html" && a.documentId === "doc-1"));
check("批注带选中文本与选择器", batchMsg.annotations.every((a) => typeof a.selector === "string" && a.selector.length > 0 && a.currentText.length > 0));
check("已发送条目出列", document.querySelectorAll("#dzCommentList .dz-comment-item").length === 0);
check("发送后选择集清空", document.getElementById("dzSelectBar").hidden);
check("pin 同步清空", document.querySelectorAll("#dzPinLayer .dz-pin").length === 0);

console.log("== 10. 发送到聊天（候选路径） ==");
document.getElementById("dzCommentBtn").click();
document.querySelectorAll("#dzMockDesktop button")[0].click();
noteInput.value = "取消按钮太靠左";
noteInput.dispatchEvent(new window.Event("input", { bubbles: true }));
const beforeChat = sent.filter((m) => m.type === "candidate-prompt").length;
document.getElementById("dzNoteSendChat").click();
check("发送到聊天发候选", sent.filter((m) => m.type === "candidate-prompt").length === beforeChat + 1);
const singleMsg = sent.filter((m) => m.type === "candidate-prompt").at(-1);
// OD 语义：单条任务文本=批注原文（无【注释】/文档名包装），文档身份在
// 批注结构里；技术载荷（htmlHint/style/尺寸）随批注携带
check("单条候选=纯原文", singleMsg.text === "取消按钮太靠左", JSON.stringify(singleMsg.text));
check("单条候选带文档锚点与批注", singleMsg.annotations?.length === 1 && singleMsg.annotations[0].documentName === "customer.html");
check("批注携带技术载荷", typeof singleMsg.annotations[0].htmlHint === "string" && singleMsg.annotations[0].htmlHint.length > 0 && typeof singleMsg.annotations[0].style === "string" && typeof singleMsg.annotations[0].w === "number" && typeof singleMsg.annotations[0].h === "number");
// 附图通道（OD attach_image）：标记工具条附图钮 + 注释附件输入存在
check("标记工具条附图钮存在", !!document.getElementById("dzDrawAttach") && !!document.getElementById("dzDrawFile"));

console.log("== 11. 画板 ==");
document.getElementById("dzDrawBtn").click();
check("画板模式激活", document.getElementById("dzDrawBtn").classList.contains("active"));
check("画板工具显示", !document.getElementById("dzDrawTools").hidden);
check("viewport 进入 drawing 态", document.getElementById("dzViewport").classList.contains("dz-drawing"));
const beforeDraw = sent.filter((m) => m.type === "candidate-prompt").length;
// 无笔画时发送：守卫不发候选且面板保持（OD !canSubmit → return）
document.getElementById("dzDrawSend").click();
check("空画板发送被守卫", sent.filter((m) => m.type === "candidate-prompt").length === beforeDraw);
check("空画板面板保持（OD 行为）", document.getElementById("dzDrawBtn").classList.contains("active"));
document.getElementById("dzDrawClose").click();
check("× 关闭画板", !document.getElementById("dzDrawBtn").classList.contains("active"));

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

console.log("== 17. 分享已移除 + 拾取层坐标基准（回归） ==");
check("分享按钮已移除", document.getElementById("dzShareBtn") === null);
check("无残留分享样式类", !document.querySelector(".design-ws-share"));
check("拾取框位于舞台内（stage 坐标基准）", document.getElementById("dzStage").contains(document.getElementById("dzPickBox")));
check("图钉层位于舞台内（stage 坐标基准）", document.getElementById("dzStage").contains(document.getElementById("dzPinLayer")));
check("拾取框为绝对定位覆盖层", (() => {
  document.getElementById("dzPickBox").hidden = false;
  const position = window.getComputedStyle(document.getElementById("dzPickBox")).position;
  document.getElementById("dzPickBox").hidden = true;
  return position === "absolute";
})());
check("面板字体令牌无 --font-ui 残留", !html.includes("var(--font-ui)"));

console.log("== 18. composer 已移除（回归） ==");
document.getElementById("dzTabFiles").click();
check("面板底部无 composer", !document.querySelector(".design-composer-input") && !document.getElementById("dzComposerSend"));
check("文件视图仍正常显示", !document.getElementById("dzViewFiles").hidden);

console.log("== 19. 审查修复回归：新控件 ==");
check("编辑按钮已整体移除（工具条+更多菜单）", !document.getElementById("dzEditBtn") && !document.querySelector('[data-dz-more="edit"]'));
check("评论角标 0 时隐藏", document.getElementById("dzCount").hidden === true);
check("标记工具条齐 OD（笔/框/文字+撤销重做+说明框+发送）", ["pen","box","text"].every(k => !!document.querySelector(`[data-dz-dtool="${k}"]`)) && !!document.getElementById("dzDrawUndo") && !!document.getElementById("dzDrawRedo") && !!document.getElementById("dzDrawSend") && document.getElementById("dzDrawNote")?.placeholder === "为这个标记添加说明");
check("默认标记工具=方框", document.querySelector('[data-dz-dtool="box"]').classList.contains("active") && !document.querySelector('[data-dz-dtool="pen"]').classList.contains("active"));
check("气泡光标已替换 crosshair", (() => {
  let found = false;
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of rules) {
      if (rule.selectorText && rule.selectorText.includes("dz-picking") && (rule.style?.cursor || "").startsWith("url(")) {
        found = true;
      }
    }
  }
  return found;
})());
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
// 分类对齐 OD：kindFor 归桶 + 空类不出胶囊（push 多类型快照验证）
fromHost({
  type: "snapshot",
  snapshot: {
    documents: [
      { documentId: "d1", name: "customer.html", headRevision: "r1", versionCount: 2 },
      { documentId: "d2", name: "tokens.css", headRevision: "r2", versionCount: 1 },
      { documentId: "d3", name: "app.ts", headRevision: "r3", versionCount: 1 },
      { documentId: "d4", name: "hero.png", headRevision: "r4", versionCount: 1 },
      { documentId: "d5", name: "wireframe.svg", headRevision: "r5", versionCount: 1 },
      { documentId: "d6", name: "sketch-flow.png", headRevision: "r6", versionCount: 1 },
      { documentId: "d7", name: "brand.sketch.json", headRevision: "r7", versionCount: 1 },
      { documentId: "d8", name: "notes.md", headRevision: "r8", versionCount: 1 },
      { documentId: "d9", name: "spec.pdf", headRevision: "r9", versionCount: 1 },
      { documentId: "d10", name: "grid.xlsx", headRevision: "r10", versionCount: 1 },
      { documentId: "d11", name: "unknown.bin", headRevision: "r11", versionCount: 1 },
    ],
    projectName: "2B_Hifi",
  },
});
const catInfo = () => Array.from(document.querySelectorAll(".design-cat")).map((c) => ({
  label: c.childNodes[0].textContent,
  count: c.querySelector(".design-cat-count").textContent,
}));
const cats2 = catInfo();
check(
  "分类标签顺序对齐 OD（空类跳过）",
  JSON.stringify(cats2.map((c) => c.label)) ===
    JSON.stringify(["页面", "样式表", "脚本", "文本", "图片", "草图", "PDF", "电子表格", "其它"]),
  JSON.stringify(cats2),
);
check("svg/sketch- 前缀图/sketch.json 归草图", (cats2.find((c) => c.label === "草图") || {}).count === "3", JSON.stringify(cats2.find((c) => c.label === "草图")));
check("没有内容的分类不出胶囊", !catInfo().some((c) => c.label === "视频" || c.label === "音频" || c.label === "文件夹"));
check("页面默认激活", (document.querySelector(".design-cat.active")?.childNodes[0].textContent) === "页面");
const cssChip = Array.from(document.querySelectorAll(".design-cat")).find((c) => c.childNodes[0].textContent === "样式表");
cssChip.click();
const visibleRows = () => Array.from(document.querySelectorAll(".design-file-card, .dz-file-row")).filter((c) => !c.hidden);
check("切到样式表只剩 css 行", visibleRows().length === 1 && visibleRows()[0].textContent.includes("tokens.css"));
check("非页面行是扩展名图标", !!visibleRows()[0].querySelector(".dz-row-icon"));
visibleRows()[0].click();
check("非页面文件打开进代码视图", document.getElementById("dzSource").hidden === false && document.getElementById("dzStage").hidden === true);
// 恢复页面快照（后续用例回到单页面环境）
fromHost({
  type: "snapshot",
  snapshot: {
    documents: [
      { documentId: "d1", name: "customer.html", headRevision: "r1", versionCount: 2 },
    ],
    projectName: "2B_Hifi",
  },
});
check("恢复页面快照后仅页面胶囊", document.querySelectorAll(".design-cat").length === 1);

console.log("== 19c. 虚拟文件夹 + 页面真实缩略图（OD 呈现）==");
// 扮演宿主：清空早前积压的缩略图请求（真机宿主总会应答）
sent.filter((m) => m.type === "thumb-request").forEach((m) => {
  fromHost({ type: "thumb", documentId: m.documentId, name: "", html: "<html><body>x</body></html>" });
});
const thumbsBefore = sent.filter((m) => m.type === "thumb-request").length;
fromHost({
  type: "snapshot",
  snapshot: {
    documents: [
      { documentId: "p1", name: "pages/customer.html", headRevision: "h1", versionCount: 2, updatedAt: new Date(Date.now() - 3600_000).toISOString() },
      { documentId: "p2", name: "pages/orders.html", headRevision: "h2", versionCount: 1 },
      { documentId: "p3", name: "welcome.html", headRevision: "h3", versionCount: 1, updatedAt: new Date().toISOString() },
    ],
    projectName: "2B_Hifi",
  },
});
const cats3 = Array.from(document.querySelectorAll(".design-cat")).map((c) => ({ label: c.childNodes[0].textContent, count: c.querySelector(".design-cat-count").textContent }));
check("文件夹胶囊在最前", cats3[0].label === "文件夹" && cats3[0].count === "1", JSON.stringify(cats3));
check("根级页面计数含文件夹内文档", (cats3.find((c) => c.label === "页面") || {}).count === "3");
check("页面缩略图请求已发", sent.filter((m) => m.type === "thumb-request").length === thumbsBefore + 3);
const folderChip = Array.from(document.querySelectorAll(".design-cat")).find((c) => c.childNodes[0].textContent === "文件夹");
folderChip.click();
const dirRows = Array.from(document.querySelectorAll(".dz-dir-row")).filter((r) => !r.hidden);
check("文件夹行=图标+名称+N 个文件", dirRows.length === 1 && dirRows[0].textContent.includes("pages") && dirRows[0].textContent.includes("2 个文件"));
dirRows[0].click();
const namesInFolder = Array.from(document.querySelectorAll(".design-file-card .design-file-name")).map((n) => n.textContent);
check("进入文件夹后名称相对显示", namesInFolder.length === 2 && namesInFolder.every((n) => !n.includes("/")), JSON.stringify(namesInFolder));
check("返回芯片出现", !!document.querySelector(".dz-cat-back"));
document.querySelector(".dz-cat-back").click();
check("返回根级", !document.querySelector(".dz-cat-back"));
const welcomeSub = document.querySelector('.design-file-card[data-dz-doc-id="p3"] .design-file-sub');
check("副行=类型·相对时间", welcomeSub.textContent === "HTML 页面 · 刚刚", welcomeSub.textContent);
const hourSub = document.querySelector('.design-file-card[data-dz-doc-id="p1"] .design-file-sub');
check("一小时前相对时间", hourSub.textContent.includes("1 小时前") || hourSub.textContent.includes("分钟前"), hourSub.textContent);
fromHost({ type: "thumb", documentId: "p3", name: "welcome.html", html: "<!doctype html><html><head><style>body{background:#eef}</style></head><body><h1>欢迎</h1></body></html>" });
check("缩略图 iframe 挂卡", !!document.querySelector('.design-file-card[data-dz-doc-id="p3"] iframe.dz-thumb-frame'));
check("缩略图已净化（无 script/外链）", !document.querySelector('.design-file-card[data-dz-doc-id="p3"] iframe').srcdoc.includes("<script"));
check("文字工具存在", !!document.querySelector('[data-dz-dtool="text"]'));
// scoped CSS 验证
const styleEl = document.querySelector("#dzMockDesktop style");
check("文档样式已 scoped（@scope 包裹+规则保留）", styleEl && styleEl.textContent.includes("@scope (#dzMockDesktop)") && styleEl.textContent.includes(".hero"));
check("文档样式无裸 body 规则", styleEl && !/(^|[\n};])\s*body\s*[,\{]/.test(styleEl.textContent));
// 外部资源剥离（锚点 # 保留是正确行为；只断言外部 URL 不存在）
const externalRes = Array.from(document.querySelectorAll('#dzMockDesktop [src], #dzMockDesktop [href]'))
  .filter((el) => { const v = el.getAttribute("src") || el.getAttribute("href"); return v && !v.startsWith("#"); });
check("外部 href/src 已剥离（锚点保留）", externalRes.length === 0);

console.log("== 19b. AI 改稿自动刷新：快照推送 → 重拉文档/版本 ==");
const readsFor = (id) => sent.filter((m) => m.type === "read-document-request" && m.documentId === id).length;
const readsTotal = () => sent.filter((m) => m.type === "read-document-request").length;
// 1) composer 关着：推送快照 → 自动重拉当前文档
const readsBeforePush = readsTotal();
fromHost({
  type: "snapshot",
  snapshot: {
    documents: [
      { documentId: "doc-1", name: "customer.html", headRevision: "def456", versionCount: 4 },
    ],
    projectName: "2B_Hifi",
  },
});
check("改动推送后自动重拉文档", readsTotal() === readsBeforePush + 1);
// 2) 多文档：已打开 doc-a 时，推送快照不得抢焦点到列表末尾的 doc-b
fromHost({
  type: "snapshot",
  snapshot: {
    documents: [
      { documentId: "doc-a", name: "a.html", headRevision: "h1", versionCount: 1 },
      { documentId: "doc-b", name: "b.html", headRevision: "h2", versionCount: 2 },
    ],
    projectName: "P",
  },
});
const initialDoc = readsTotal(); // 无打开文档 → 回落最后一份 doc-b
check("回落读取列表末份文档", readsFor("doc-b") >= 1 && readsTotal() === initialDoc);
const docACard = Array.from(document.querySelectorAll(".design-file-card"))
  .find((c) => (c.textContent || "").includes("a.html"));
docACard.click();
const afterOpen = readsTotal();
check("点卡打开 doc-a 请求读它", readsTotal() === afterOpen && readsFor("doc-a") >= 1);
fromHost({
  type: "snapshot",
  snapshot: {
    documents: [
      { documentId: "doc-a", name: "a.html", headRevision: "h3", versionCount: 3 },
      { documentId: "doc-b", name: "b.html", headRevision: "h2", versionCount: 2 },
    ],
    projectName: "P",
  },
});
check("推送保留已打开文档（不跳到末份）", readsFor("doc-a") === 2 && readsFor("doc-b") === 1);
// 3) composer 开着：推送不打断输入，关闭后补刷
const beforeComposerPush = readsTotal();
document.getElementById("dzNoteComposer").hidden = false;
fromHost({
  type: "snapshot",
  snapshot: {
    documents: [
      { documentId: "doc-a", name: "a.html", headRevision: "h4", versionCount: 4 },
      { documentId: "doc-b", name: "b.html", headRevision: "h2", versionCount: 2 },
    ],
    projectName: "P",
  },
});
check("composer 开着时不打断", readsTotal() === beforeComposerPush && readsFor("doc-a") === 2);
document.body.click();
check("composer 关闭后补刷文档", readsFor("doc-a") === 3);

console.log("== 19b2. 标记数据链 + composer 绑定上报 ==");
{
  const before = sent.filter((m) => m.type === "candidate-prompt").length;
  document.getElementById("dzDrawBtn").click();
  document.getElementById("dzDrawUndo").click(); // 空 op，无异常
  document.getElementById("dzDrawSend").click(); // 无标记 → 守卫 toast
  check("空标记发送被守卫", sent.filter((m) => m.type === "candidate-prompt").length === before);
  check("标记模式保持（OD 行为）", !document.getElementById("dzDrawTools").hidden);
  document.getElementById("dzDrawClose").click();
  check("标记模式已退出", document.getElementById("dzDrawTools").hidden);
}
{
  // 绑定上报：切到网格视图 → active-document 解绑上报
  const binds = () => sent.filter((m) => m.type === "active-document");
  const beforeBinds = binds().length;
  document.getElementById("dzTabFiles").click(); // 网格 → 解绑
  check("网格视图解绑上报", binds().length === beforeBinds + 1 && binds().at(-1).documentId === null);
  // 角标跟随（0 隐藏已验）：轻数字规则存在（无圆底）
  check("角标样式=轻数字（无圆底）", (() => {
    let found = false;
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const rule of rules) {
        if (rule.selectorText && rule.selectorText.includes(".dz-comment-count .dz-count") && rule.style?.background === "none") {
          found = true;
        }
      }
    }
    return found;
  })());
}

console.log("== 20. 错误汇总 ==");
check("全程无未捕获 JS 错误", pageErrors.length === 0, pageErrors.join("; "));

console.log(`\n结果：${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

import { verificationOutput } from "../../../../../scripts/artifacts/output-path.mjs";
// 真实渲染验证：Electron 无头加载设计面板，注入测试文档，
// 截图文件视图/预览视图/注释模式，并在页面里执行真实交互读回状态。
import { app, BrowserWindow } from "electron";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] ?? verificationOutput("design-panel");
mkdirSync(outDir, { recursive: true });

const profile = mkdtempSync(join(tmpdir(), "artemis-design-panel-verify-"));
app.setPath("userData", join(profile, "profile"));
app.on("will-quit", () => rmSync(profile, { recursive: true, force: true }));

const panelUrl =
  "file://" +
  join(
    here,
    "../../..",
    "resources",
    "design-plugins",
    "artemis-design",
    "panel",
    "index.html",
  );

const TEST_DOC = `<!doctype html>
<html><head><style>
body{font-family:system-ui;margin:0;color:#27272a}
.wrap{max-width:520px;margin:0 auto;padding:32px 24px}
.hero{background:linear-gradient(135deg,#e0f2fe,#f0f9ff);border-radius:16px;padding:28px;margin-bottom:24px}
.hero h1{margin:0 0 8px;font-size:26px}
.hero p{margin:0;color:#475569}
.row{display:flex;justify-content:space-between;align-items:center;padding:14px 0;border-bottom:1px solid #e2e8f0}
.row label{font-weight:600}
.row .val{color:#64748b}
.actions{display:flex;gap:12px;margin-top:24px}
.btn{padding:10px 22px;border-radius:10px;border:0;font-weight:600;cursor:pointer}
.btn.ghost{background:#f1f5f9;color:#334155}
.btn.primary{background:#0f172a;color:#fff}
</style></head>
<body><div class="wrap">
<div class="hero"><h1>账户设置</h1><p>管理你的偏好与连接</p></div>
<div class="row"><label>主题</label><span class="val">深色</span></div>
<div class="row"><label>语言</label><span class="val">简体中文</span></div>
<div class="row"><label>自动更新</label><span class="val">开</span></div>
<div class="actions"><button class="btn ghost">取消</button><button class="btn primary">保存设置</button></div>
</div></body></html>`;

app
  .whenReady()
  .then(async () => {
    const win = new BrowserWindow({
      width: 1180,
      height: 860,
      show: false,
      webPreferences: { offscreen: true },
    });

    const results = [];
    const shot = (name) =>
      new Promise((resolve) => {
        // offscreen 渲染需要一帧
        setTimeout(async () => {
          const image = await win.webContents.capturePage();
          writeFileSync(join(outDir, name), image.toPNG());
          console.log("shot:", name);
          resolve();
        }, 350);
      });

    await win.loadURL(panelUrl);
    await shot("01-files-view.png");

    // 注入快照 + 文档（模拟宿主 port 下行）
    await win.webContents.executeJavaScript(`
    (function(){
      window.__sent = [];
      const fakePort = {
        postMessage: (m) => window.__sent.push(m),
        addEventListener: (t, l) => { fakePort["on" + t] = l; },
        start() {},
      };
      const ev = new Event("artemis:port");
      ev.ports = [fakePort];
      window.dispatchEvent(ev);
      window.__fromHost = (m) => fakePort.onmessage({ data: m });
      window.__fromHost({ type: "snapshot", snapshot: { documents: [
        { documentId: "doc-1", name: "customer.html", headRevision: "abc12345", versionCount: 3 },
        { documentId: "doc-2", name: "index.html", headRevision: "def67890", versionCount: 1 },
      ], projectName: "2B_Hifi" } });
    })();
  `);
    await shot("02-files-populated.png");

    // 打开第一个文档
    await win.webContents.executeJavaScript(
      `document.querySelectorAll(".design-file-card")[0].click()`,
    );
    await win.webContents.executeJavaScript(
      `window.__fromHost({ type: "document-html", html: ${JSON.stringify(TEST_DOC)}, name: "customer.html", subtitle: "客户档案" })`,
    );
    await shot("03-preview-parsed.png");

    // 设备切手机
    await win.webContents.executeJavaScript(`
    document.querySelector('[data-dz-device="mobile"]').click();
  `);
    await shot("04-preview-mobile.png");
    await win.webContents.executeJavaScript(
      `document.querySelector('[data-dz-device="desktop"]').click();`,
    );

    // 代码视图
    await win.webContents.executeJavaScript(
      `document.getElementById("dzModeSource").click()`,
    );
    await shot("05-source-view.png");
    await win.webContents.executeJavaScript(
      `document.getElementById("dzModePreview").click()`,
    );

    // 注释模式：点 hero h1
    await win.webContents.executeJavaScript(`
    document.getElementById("dzCommentBtn").click();
  `);
    const documentFrame = win.webContents.mainFrame.frames.find(
      (frame) => frame.url === "about:srcdoc",
    );
    assert.ok(documentFrame, "Generated document has its own frame");
    // Mode changes cross a postMessage boundary into the sandboxed frame.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await documentFrame.executeJavaScript(
      `document.querySelector('.hero h1').click()`,
    );
    await shot("06-annotation-composer.png");
    assert.equal(
      await win.webContents.executeJavaScript(
        `document.getElementById("dzNoteComposer").hidden`,
      ),
      false,
      "Annotation bridge opens the composer",
    );

    // 保存注释 → pin
    await win.webContents.executeJavaScript(`
    const input = document.getElementById("dzNoteInput");
    input.value = "标题字号偏大";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    document.getElementById("dzNoteSave").click();
  `);
    await shot("07-annotation-pin.png");

    // 评论面板
    await win.webContents.executeJavaScript(
      `document.getElementById("dzCommentListBtn").click()`,
    );
    await shot("08-comment-panel.png");
    await win.webContents.executeJavaScript(
      `document.getElementById("dzCommentPanelClose").click()`,
    );

    // 画板模式
    await win.webContents.executeJavaScript(
      `document.getElementById("dzDrawBtn").click()`,
    );
    await shot("09-draw-mode.png");
    await win.webContents.executeJavaScript(
      `document.getElementById("dzDrawBtn").click()`,
    );

    // 版本历史
    await win.webContents.executeJavaScript(`
    document.getElementById("dzHistoryBtn").click();
    window.__fromHost({ type: "versions", versions: { status: "succeeded", output: JSON.stringify({
      versions: [
        { sequence: 3, revision: "cccc3333cccc3333" },
        { sequence: 2, revision: "bbbb2222bbbb2222" },
        { sequence: 1, revision: "aaaa1111aaaa1111" },
      ] }) } });
  `);
    await shot("10-history.png");

    // 交互读回验证
    const interaction = await win.webContents.executeJavaScript(`
    (function(){
      const r = {};
      r.fileCards = document.querySelectorAll(".design-file-card").length;
      r.tabs = document.querySelectorAll(".design-ws-tab").length;
      r.cats = Array.from(document.querySelectorAll(".design-cat")).map(c => c.textContent.trim());
      r.documentSandbox = document.getElementById("dzDocFrame").getAttribute("sandbox");
      r.hostHasDocumentNodes = Boolean(document.querySelector("#dzMockDesktop .hero"));
      r.sourceLines = document.querySelectorAll("#dzSource .ln").length;
      r.pinCount = document.querySelectorAll("#dzPinLayer .dz-pin").length;
      r.commentCount = document.getElementById("dzCount").textContent;
      r.historyItems = document.querySelectorAll("#dzHistory .dz-history-item").length;
      r.sentTypes = window.__sent.map(m => m.type);
      r.viewportSize = { w: innerWidth, h: innerHeight };
      r.stageWidth = document.getElementById("dzStage").style.width;
      r.phoneHidden = document.getElementById("dzMockPhone").hidden;
      return r;
    })();
  `);
    const documentContent = await documentFrame.executeJavaScript(
      `({ buttons: document.querySelectorAll('.btn').length, title: document.querySelector('.hero h1')?.textContent, isolated: (() => { try { void parent.document.body; return false; } catch { return true; } })() })`,
    );
    assert.equal(documentContent.buttons, 2);
    assert.equal(documentContent.title, "账户设置");
    assert.equal(documentContent.isolated, true);
    assert.equal(interaction.documentSandbox, "allow-scripts");
    assert.equal(interaction.hostHasDocumentNodes, false);
    assert.equal(interaction.pinCount, 1);
    assert.equal(interaction.historyItems, 3);
    Object.assign(interaction, { documentContent });
    results.push(interaction);
    console.log("interaction:", JSON.stringify(interaction, null, 2));

    writeFileSync(
      join(outDir, "interaction.json"),
      JSON.stringify(interaction, null, 2),
    );
    win.destroy();
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

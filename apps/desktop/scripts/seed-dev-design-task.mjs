// 准备隔离 dev 实例的 S2-S4 验证环境：
// 1. 计算 artemis-design 包 contentHash 并发布 revision 到 userData/plugins/plugin-revisions/
// 2. 建一个 artemis-design 类型的受限线程（typeBinding + executionProfile + grant）
// 用法：node scripts/seed-dev-design-task.mjs <userDataPath>
import { mkdir, cp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const userData = process.argv[2];
if (!userData) {
  console.error("usage: node seed-dev-design-task.mjs <userDataPath>");
  process.exit(1);
}

// 无尾部斜杠：与 PluginRevisionStore 的 relative() 语义一致
const packageRoot = new URL("../resources/design-plugins/artemis-design", import.meta.url).pathname.replace(/\/$/, "");
const revisionsRoot = join(userData, "plugins", "plugin-revisions");

// 与 PluginRevisionStore.computeContentHash 相同的清单哈希
async function collect(root) {
  const files = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) { await walk(abs); continue; }
      const rel = abs.slice(root.length + 1).split("\\").join("/");
      files.push({ path: rel, bytes: await readFile(abs) });
    }
  };
  await walk(root);
  return files.sort((a, b) => (a.path < b.path ? -1 : 1));
}

const files = await collect(packageRoot);
const manifestText = files
  .map((f) => `${f.path}:${createHash("sha256").update(f.bytes).digest("hex")}\n`)
  .join("");
const contentHash = createHash("sha256").update(manifestText).digest("hex");

const revisionRoot = join(revisionsRoot, "com.artemis.design", contentHash);
await mkdir(revisionRoot, { recursive: true });
await cp(packageRoot, revisionRoot, { recursive: true });
// 清理旧哈希目录（绑定只认最新正确哈希）
const { rm: rmDir } = await import("node:fs/promises");
for (const entry of await readdir(revisionsRoot + "/com.artemis.design")) {
  if (entry !== contentHash && !entry.startsWith(".")) {
    await rmDir(join(revisionsRoot, "com.artemis.design", entry), { recursive: true, force: true });
    console.log("removed stale revision:", entry);
  }
}
console.log("revision published:", revisionRoot);
console.log("contentHash:", contentHash);

// 建线程 + grant
const db = new DatabaseSync(join(userData, "artemis.sqlite"));
let threadId = randomUUID();
const now = new Date().toISOString();
const binding = {
  installationId: "com.artemis.design",
  pluginId: "com.artemis.design",
  typeId: "artemis-design",
  pluginVersion: "0.1.0",
  contentHash,
  bindingRevision: `rev-${contentHash.slice(0, 12)}`,
};
// 幂等：若线程已存在则更新其绑定与 grant 到正确哈希
const existing = db.prepare("SELECT id FROM threads WHERE title = ?").get("设计验证任务（S2-S4）");
if (existing) {
  threadId = existing.id;
  db.prepare("UPDATE threads SET type_binding_json = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(binding), now, threadId);
  db.prepare("UPDATE plugin_grants SET content_hash = ?, grant_revision = ?, updated_at = ? WHERE scope_id = ?")
    .run(contentHash, binding.bindingRevision, now, threadId);
  console.log("thread updated:", threadId);
} else {
  db.prepare(`INSERT INTO threads (id, title, mode, target, status, pinned, archived, type_binding_json, execution_profile, created_at, updated_at)
              VALUES (?, ?, 'execute', 'local', 'idle', 0, 0, ?, 'plugin-restricted-v1', ?, ?)`)
    .run(threadId, "设计验证任务（S2-S4）", JSON.stringify(binding), now, now);
  db.prepare(`INSERT INTO plugin_grants (grant_id, installation_id, plugin_id, content_hash, scope, scope_id, capabilities_json, resource_refs_json, grant_revision, created_at, updated_at)
              VALUES (?, ?, ?, ?, 'thread', ?, '{}', '{}', ?, ?, ?)`)
    .run(randomUUID(), "com.artemis.design", "com.artemis.design", contentHash, threadId, binding.bindingRevision, now, now);
  console.log("thread created:", threadId);
}
// ---- 种子初始文档（幂等）：面板打开即有内容可渲染 ----
// 数据根与插件 revision 哈希解绑：<scratch>/<threadId>/data/（历史必须
// 活过插件升级）。runtime 的 get_snapshot/list_versions 扫描
// data/documents/；种子不建文档则面板永远为空（真实场景里首条指令会
// create_document）。已有账本（真实数据或迁移结果）一律不覆写。
import { existsSync } from "node:fs";
import { mkdirSync, writeFileSync, readFileSync, appendFileSync } from "node:fs";
const dataRoot = join(userData, "plugin-scratch", threadId, "data");
const scratchRoot = join(dataRoot, "documents");
const hasExistingData = existsSync(join(dataRoot, "design-documents.jsonl"));
const SEED_DOC_HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>客户档案</title><style>
body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#f8fafc;color:#0f172a}
.page{max-width:560px;margin:0 auto;padding:40px 28px}
.mock-head{display:flex;flex-direction:column;gap:4px;margin-bottom:28px;padding-bottom:20px;border-bottom:1px solid #e2e8f0}
.mock-head b{font-size:22px}
.mock-head span{color:#64748b;font-size:13px}
.mock-row{display:flex;justify-content:space-between;align-items:center;padding:16px 0;border-bottom:1px solid #eef2f7}
.mock-row label{font-weight:600;font-size:14px}
.mock-row i{color:#64748b;font-style:normal;font-size:14px}
.mock-actions{display:flex;gap:12px;margin-top:28px}
button{padding:10px 24px;border-radius:10px;border:0;font-weight:600;font-size:14px;cursor:pointer}
.ghost{background:#f1f5f9;color:#334155}
.primary{background:#0f172a;color:#fff}
</style></head>
<body><div class="page">
<header class="mock-head"><b>客户档案</b><span>管理客户的基础信息与偏好</span></header>
<div class="mock-row"><label>主题</label><i>深色</i></div>
<div class="mock-row"><label>语言</label><i>简体中文</i></div>
<div class="mock-row"><label>自动更新</label><i>开启</i></div>
<div class="mock-actions"><button class="ghost">取消</button><button class="primary">保存设置</button></div>
</div></body></html>`;
const seedDocs = [
  { id: "seed-customer", seq: 2 },   // v2 当前版
  { id: "seed-customer", seq: 1 },   // v1 旧版（恢复链路可用）
];
let seeded = 0;
for (const d of hasExistingData ? [] : seedDocs) {
  const docDir = join(scratchRoot, d.id);
  if (!existsSync(docDir)) mkdirSync(docDir, { recursive: true });
  // 版本文件名：v<seq>-<16位hash>.html —— hash 用内容 sha256 前 16 位（与 runtime 约定一致）
  const { createHash } = await import("node:crypto");
  const rev = d.seq === 2
    ? createHash("sha256").update(SEED_DOC_HTML).digest("hex").slice(0, 16)
    : "aaaa1111aaaa1111";
  const file = join(docDir, `v${d.seq}-${rev}.html`);
  if (!existsSync(file)) {
    writeFileSync(file, d.seq === 2 ? SEED_DOC_HTML : SEED_DOC_HTML.replace("客户档案", "客户资料"), "utf8");
    seeded += 1;
  }
}
// HEAD 标记 + 根级账本 design-documents.jsonl（runtime 的 get_snapshot 读这个；
// 记录字段与 create_document 写入一致：id/name/brief/createdAt）
if (!hasExistingData) {
  const { createHash } = await import("node:crypto");
  const rev = createHash("sha256").update(SEED_DOC_HTML).digest("hex").slice(0, 16);
  const docDir = join(scratchRoot, "seed-customer");
  writeFileSync(join(docDir, "HEAD"), `2-${rev}\n`, "utf8");
  const rootLedger = join(dataRoot, "design-documents.jsonl");
  if (!existsSync(rootLedger)) {
    writeFileSync(rootLedger, JSON.stringify({
      id: "seed-customer",
      name: "customer.html",
      brief: "客户档案 · 管理客户的基础信息与偏好",
      createdAt: now,
    }) + "\n", "utf8");
    console.log("root ledger design-documents.jsonl seeded");
  }
} else {
  // 增量演示（只补缺，不动已有数据）：虚拟文件夹路径文档
  // pages/orders.html —— 面板文件夹导航 + 真实缩略图的真机演示载体。
  const ledgerPath = join(dataRoot, "design-documents.jsonl");
  const ledgerText = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : "";
  if (!ledgerText.includes('"id":"seed-orders"')) {
    const { createHash } = await import("node:crypto");
    const SEED_ORDERS_HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>订单列表</title><style>
body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#f8fafc;color:#0f172a}
.page{max-width:560px;margin:0 auto;padding:40px 28px}
.mock-head{display:flex;flex-direction:column;gap:4px;margin-bottom:24px;padding-bottom:20px;border-bottom:1px solid #e2e8f0}
.mock-head b{font-size:22px}
.mock-head span{color:#64748b;font-size:13px}
.mock-row{display:flex;justify-content:space-between;align-items:center;padding:16px 0;border-bottom:1px solid #eef2f7}
.mock-row label{font-weight:600;font-size:14px}
.mock-row i{color:#64748b;font-style:normal;font-size:14px}
</style></head>
<body><div class="page">
<header class="mock-head"><b>订单列表</b><span>pages 文件夹 · 虚拟文件夹演示页</span></header>
<div class="mock-row"><label>订单 #2041</label><i>已支付 · ¥299</i></div>
<div class="mock-row"><label>订单 #2038</label><i>待发货 · ¥158</i></div>
<div class="mock-row"><label>订单 #2032</label><i>已完成 · ¥89</i></div>
</div></body></html>`;
    const rev = createHash("sha256").update(SEED_ORDERS_HTML).digest("hex").slice(0, 16);
    const docDir = join(scratchRoot, "seed-orders");
    mkdirSync(docDir, { recursive: true });
    writeFileSync(join(docDir, `v1-${rev}.html`), SEED_ORDERS_HTML, "utf8");
    writeFileSync(join(docDir, "HEAD"), `1-${rev}\n`, "utf8");
    appendFileSync(ledgerPath, JSON.stringify({
      id: "seed-orders",
      name: "pages/orders.html",
      brief: "订单列表 · 虚拟文件夹演示页",
      createdAt: now,
    }) + "\n", "utf8");
    console.log("seeded folder demo document: pages/orders.html");
  } else {
    console.log("existing thread data found; keeping documents untouched");
  }
}
if (seeded > 0) console.log(`seeded ${seeded} document version file(s) under plugin-scratch/data`);

db.close();
console.log("grant inserted for", binding.bindingRevision);

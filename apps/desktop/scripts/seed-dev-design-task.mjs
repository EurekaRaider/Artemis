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
db.close();
console.log("grant inserted for", binding.bindingRevision);

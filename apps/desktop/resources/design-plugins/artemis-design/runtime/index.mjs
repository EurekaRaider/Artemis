// artemis-design runtime: stdio protocol implementation for the design plugin.
//
// Frame protocol (S0 test-notes heritage): length-prefixed JSON frames on
// stdin/stdout, hello -> ready handshake, tool.invoke -> tool.result,
// errors reported on stderr only.
//
// S4 tools (proposal §10 document & edit contract):
//   create_document({ name, brief })
//     -> writes a REAL standalone HTML file under documents/<documentId>/
//        plus a new version; version 1 is the generated page.
//   list_versions({ documentId })
//     -> every published version with revision, createdAt, label.
//   get_snapshot({ documentId? })
//     -> current head documents with their latest version metadata.
//   apply_edit({ documentId, expectedRevision, operationId, find, replace })
//     -> CAS edit: expectedRevision must equal head; the edit lands as a
//        NEW version. Stale writers get a conflict carrying currentRevision
//        so they can rebase instead of overwriting (§10.1).

import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";

const DOCUMENTS_DIR = "documents";
const LEDGER_FILE = "design-documents.jsonl";

function send(message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length, 0);
  process.stdout.write(Buffer.concat([header, payload]));
}

function readFrames(onFrame) {
  let buffer = Buffer.alloc(0);
  process.stdin.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      if (buffer.length < 4) break;
      const length = buffer.readUInt32BE(0);
      if (buffer.length < 4 + length) break;
      const payload = buffer.subarray(4, 4 + length).toString("utf8");
      buffer = buffer.subarray(4 + length);
      try {
        onFrame(JSON.parse(payload));
      } catch (error) {
        send({ type: "error", message: String(error) });
      }
    }
  });
}

async function readLedger() {
  try {
    const text = await readFile(join(process.cwd(), LEDGER_FILE), "utf8");
    return text
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

async function appendLedger(record) {
  await appendFile(
    join(process.cwd(), LEDGER_FILE),
    JSON.stringify(record) + "\n",
    "utf8",
  );
}

/** Standalone dark-theme page; the artifact must reopen in a browser. */
function renderDocumentHtml(name, brief) {
  const escaped = (value) =>
    String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escaped(name)}</title>
<style>
  :root { color-scheme: dark; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
    background: #0d0f16; color: #e6e9f5; min-height: 100vh;
    display: flex; align-items: center; justify-content: center;
  }
  .card {
    max-width: 640px; width: calc(100% - 48px);
    background: #171a26; border: 1px solid #262b3d; border-radius: 16px;
    padding: 48px; box-shadow: 0 12px 40px rgba(0,0,0,.45);
  }
  h1 { font-size: 28px; margin-bottom: 16px; letter-spacing: .5px; }
  p { font-size: 15px; line-height: 1.75; color: #9399b2; }
  .badge {
    display: inline-block; margin-bottom: 20px; padding: 4px 12px;
    border-radius: 999px; background: #1f2436; color: #7aa2f7;
    font-size: 12px; letter-spacing: 1px;
  }
</style>
</head>
<body>
  <main class="card">
    <span class="badge">ARTEMIS DESIGN</span>
    <h1>${escaped(name)}</h1>
    <p>${escaped(brief || "一个由 artemis-design 生成的设计文档。")}</p>
  </main>
</body>
</html>
`;
}

/** Read every version file of a document, oldest first. */
async function readVersions(documentId) {
  const directory = join(process.cwd(), DOCUMENTS_DIR, documentId);
  let entries;
  try {
    entries = await readdir(directory);
  } catch {
    return [];
  }
  const versions = [];
  for (const entry of [...entries].sort((a, b) => {
    const seq = (name) => Number(/^v(\d+)-/.exec(name)?.[1] ?? 0);
    return seq(a) - seq(b);
  })) {
    if (!entry.endsWith(".html") || !entry.startsWith("v")) continue;
    const match = /^v(\d+)-([0-9a-f]+)\.html$/.exec(entry);
    if (!match) continue;
    const html = await readFile(join(directory, entry), "utf8");
    versions.push({
      revision: match[2],
      sequence: Number(match[1]),
      file: entry,
      html,
      createdAt: new Date().toISOString(),
    });
  }
  return versions;
}

async function headVersion(documentId) {
  const versions = await readVersions(documentId);
  if (versions.length === 0) return undefined;
  const marker = await readFile(
    join(process.cwd(), DOCUMENTS_DIR, documentId, "HEAD"),
    "utf8",
  ).catch(() => null);
  if (!marker) return versions.at(-1);
  const [seq, rev] = marker.trim().split("-");
  const restored = versions.find(
    (version) => String(version.sequence) === seq && version.revision === rev,
  );
  return restored ?? versions.at(-1);
}

// PR#245 P1-4：documentId 一律过形态校验（运行时生成的 uuid：小写十六
// 进制+连字符），杜绝把 ../ 之类拼进 documents/ 路径。
const DOCUMENT_ID_PATTERN = /^[0-9a-f][0-9a-f-]{7,63}$/;
function invalidDocumentId(documentId) {
  return (
    typeof documentId !== "string" || !DOCUMENT_ID_PATTERN.test(documentId)
  );
}

// PR#245 P2-13：新序号必须取「全部历史（含被撤销掉的未来版本）的最大
// 序号 + 1」。只按 HEAD.sequence + 1 会在撤销后编辑时与磁盘上既存的
// 被撤销版本撞号（同 v3 两份不同内容），历史就乱了。
async function nextSequenceNumber(documentId) {
  const versions = await readVersions(documentId);
  return (
    versions.reduce((max, version) => Math.max(max, version.sequence), 0) + 1
  );
}

async function headMarkerFile(documentId) {
  return join(process.cwd(), DOCUMENTS_DIR, documentId, "HEAD");
}

const tools = {
  async create_document(args) {
    const name = String(args?.name ?? "").trim();
    const brief = String(args?.brief ?? "");
    if (!name) {
      return { status: "failed", error: "name must be non-empty" };
    }
    if (name.length > 200) {
      return { status: "failed", error: "name must be at most 200 characters" };
    }
    if (brief.length > 2000) {
      return {
        status: "failed",
        error: "brief must be at most 2000 characters",
      };
    }
    const documentId = crypto.randomUUID();
    const html = renderDocumentHtml(name, brief);
    const revision = createHash("sha256")
      .update(html)
      .digest("hex")
      .slice(0, 16);
    const directory = join(process.cwd(), DOCUMENTS_DIR, documentId);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `v1-${revision}.html`), html, "utf8");
    await appendLedger({
      id: documentId,
      name,
      brief,
      createdAt: new Date().toISOString(),
    });
    return {
      status: "succeeded",
      output: JSON.stringify({
        documentId,
        revision,
        version: 1,
        file: `documents/${documentId}/v1-${revision}.html`,
      }),
    };
  },

  async list_versions(args) {
    const documentId = String(args?.documentId ?? "");
    if (invalidDocumentId(documentId)) {
      return { status: "failed", error: "invalid documentId" };
    }
    const versions = await readVersions(documentId);
    return {
      status: "succeeded",
      output: JSON.stringify({
        documentId,
        versions: versions.map((version) => ({
          revision: version.revision,
          sequence: version.sequence,
          file: version.file,
        })),
      }),
    };
  },

  async get_snapshot() {
    const ledger = await readLedger();
    // 按 id 聚合：编辑条目（apply_edit 追加，无 name/brief）不能透传成
    // 独立文档，否则面板按 name 分类时直接崩（name undefined）。删除墓碑
    // （P2-16 deleteDocument）之后的条目一律跳过，文档不再列出。
    const byId = new Map();
    const deletedIds = new Set();
    for (const record of ledger) {
      if (record.deleted) {
        deletedIds.add(record.id);
        continue;
      }
      if (deletedIds.has(record.id)) continue;
      const entry = byId.get(record.id) ?? {
        id: record.id,
        name: "",
        brief: "",
        updatedAt: "",
      };
      if (record.name) entry.name = record.name;
      if (record.brief && !entry.brief) entry.brief = record.brief;
      // 卡片「相对时间」用的最近活动时间（创建/编辑/恢复取最新）
      const ts =
        record.editedAt ||
        record.restoredAt ||
        record.createdAt ||
        record.undoneAt ||
        record.redoneAt;
      if (ts && ts > entry.updatedAt) entry.updatedAt = ts;
      byId.set(record.id, entry);
    }
    const documents = [];
    for (const entry of byId.values()) {
      if (!entry.name) continue;
      const head = await headVersion(entry.id);
      documents.push({
        documentId: entry.id,
        name: entry.name,
        brief: entry.brief,
        headRevision: head?.revision ?? null,
        versionCount: head ? head.sequence : 0,
        ...(entry.updatedAt ? { updatedAt: entry.updatedAt } : {}),
      });
    }
    return { status: "succeeded", output: JSON.stringify({ documents }) };
  },

  async apply_edit(args) {
    const documentId = String(args?.documentId ?? "");
    const expectedRevision = String(args?.expectedRevision ?? "");
    const operationId = String(args?.operationId ?? "");
    const find = String(args?.find ?? "");
    const replace = String(args?.replace ?? "");
    if (invalidDocumentId(documentId)) {
      return { status: "failed", error: "invalid documentId" };
    }
    if (!expectedRevision || !operationId) {
      return {
        status: "failed",
        error: "documentId, expectedRevision and operationId are required",
      };
    }
    if (!find) {
      return { status: "failed", error: "find must be non-empty" };
    }
    const head = await headVersion(documentId);
    if (!head) {
      return { status: "failed", error: `unknown document ${documentId}` };
    }
    // §10.1: concurrent AI/manual edits on the same base — the later
    // writer gets a conflict carrying the current revision, never an
    // overwrite.
    if (head.revision !== expectedRevision) {
      return {
        status: "conflict",
        error: "expectedRevision does not match the head revision",
        output: JSON.stringify({
          conflict: true,
          currentRevision: head.revision,
          currentSequence: head.sequence,
        }),
      };
    }
    const occurrences = head.html.split(find).length - 1;
    if (occurrences === 0) {
      return {
        status: "failed",
        error: "find text is not present in the document",
      };
    }
    if (occurrences > 1) {
      return {
        status: "failed",
        error: `find text is ambiguous (${occurrences} occurrences); refusing first-match edit`,
      };
    }
    const nextHtml = head.html.replace(find, replace);
    // P2-13：序号取全历史最大值+1（撤销后 head.sequence+1 会与被撤销
    // 版本撞号），写入后推进 HEAD。
    const nextSequence = await nextSequenceNumber(documentId);
    const nextRevision = createHash("sha256")
      .update(nextHtml)
      .digest("hex")
      .slice(0, 16);
    const directory = join(process.cwd(), DOCUMENTS_DIR, documentId);
    await writeFile(
      join(directory, `v${nextSequence}-${nextRevision}.html`),
      nextHtml,
      "utf8",
    );
    await appendLedger({
      id: documentId,
      operationId,
      parentRevision: expectedRevision,
      revision: nextRevision,
      sequence: nextSequence,
      editedAt: new Date().toISOString(),
    });
    // 推进 HEAD：否则面板/snapshot 仍读旧版本，且下一次 CAS 编辑必然冲突
    await writeFile(
      await headMarkerFile(documentId),
      `${nextSequence}-${nextRevision}\n`,
      "utf8",
    );
    return {
      status: "succeeded",
      output: JSON.stringify({
        documentId,
        revision: nextRevision,
        version: nextSequence,
        operationId,
      }),
    };
  },

  async undo(args) {
    const documentId = String(args?.documentId ?? "");
    const operationId = String(args?.operationId ?? "");
    if (invalidDocumentId(documentId)) {
      return { status: "failed", error: "invalid documentId" };
    }
    if (!operationId) {
      return {
        status: "failed",
        error: "documentId and operationId are required",
      };
    }
    const versions = await readVersions(documentId);
    if (versions.length === 0) {
      return { status: "failed", error: `unknown document ${documentId}` };
    }
    // P2-13：撤销必须沿 HEAD 位置回退。按数值序取倒数第二个会在「连
    // 续撤销」时永远停在同一版本（HEAD 重新指回当前版）。
    const head = await headVersion(documentId);
    if (!head) {
      return { status: "failed", error: `unknown document ${documentId}` };
    }
    const headIndex = versions.findIndex(
      (version) =>
        version.sequence === head.sequence &&
        version.revision === head.revision,
    );
    if (headIndex < 0) {
      return {
        status: "failed",
        error: "head marker does not match any version",
      };
    }
    if (headIndex === 0) {
      return {
        status: "failed",
        error: "nothing to undo (head is the first version)",
      };
    }
    const previous = versions[headIndex - 1];
    // Undo moves the HEAD marker; version files stay (auditable history).
    // Implemented as head-state file: documents/<id>/HEAD names the current.
    await writeFile(
      await headMarkerFile(documentId),
      `${previous.sequence}-${previous.revision}\n`,
      "utf8",
    );
    await appendLedger({
      id: documentId,
      operationId,
      undoneRevision: head.revision,
      restoredRevision: previous.revision,
      undoneAt: new Date().toISOString(),
    });
    return {
      status: "succeeded",
      output: JSON.stringify({
        documentId,
        headRevision: previous.revision,
        undoneRevision: head.revision,
      }),
    };
  },

  // OD 语义的恢复：restore = 把目标版本内容存成一个 NEW 版本并推进
  // HEAD（append-only，当前内容不丢——它就是上一个版本）。历史版本
  // 文件与账本只增不删，无上限。
  async restore_version(args) {
    const documentId = String(args?.documentId ?? "");
    const revision = String(args?.revision ?? "");
    const operationId = String(args?.operationId ?? "");
    if (invalidDocumentId(documentId)) {
      return { status: "failed", error: "invalid documentId" };
    }
    if (!revision || !operationId) {
      return {
        status: "failed",
        error: "documentId, revision and operationId are required",
      };
    }
    const versions = await readVersions(documentId);
    const target = versions.find((version) => version.revision === revision);
    if (!target) {
      return {
        status: "failed",
        error: `unknown revision ${revision.slice(0, 8)}`,
      };
    }
    const head = await headVersion(documentId);
    if (!head) {
      return { status: "failed", error: `unknown document ${documentId}` };
    }
    if (head.revision === revision) {
      return { status: "failed", error: "target revision is already the head" };
    }
    const nextSequence = await nextSequenceNumber(documentId);
    const nextRevision = createHash("sha256")
      .update(target.html)
      .digest("hex")
      .slice(0, 16);
    const directory = join(process.cwd(), DOCUMENTS_DIR, documentId);
    await writeFile(
      join(directory, `v${nextSequence}-${nextRevision}.html`),
      target.html,
      "utf8",
    );
    await appendLedger({
      id: documentId,
      operationId,
      source: "restore",
      restoreFromRevision: revision,
      parentRevision: head.revision,
      revision: nextRevision,
      sequence: nextSequence,
      restoredAt: new Date().toISOString(),
    });
    await writeFile(
      await headMarkerFile(documentId),
      `${nextSequence}-${nextRevision}\n`,
      "utf8",
    );
    return {
      status: "succeeded",
      output: JSON.stringify({
        documentId,
        revision: nextRevision,
        restoredFromRevision: revision,
        version: nextSequence,
        operationId,
      }),
    };
  },

  async redo(args) {
    const documentId = String(args?.documentId ?? "");
    const operationId = String(args?.operationId ?? "");
    if (invalidDocumentId(documentId)) {
      return { status: "failed", error: "invalid documentId" };
    }
    if (!operationId) {
      return {
        status: "failed",
        error: "documentId and operationId are required",
      };
    }
    // P2-13：redo = HEAD 跳回全局最新版本，仅在「HEAD 不在历史末尾」时
    // 有效。撤销后一旦产生新版本，HEAD 就在末端，redo 自然拒绝——不会
    // 越过新版本把旧内容拽回来（旧实现无条件跳到数值序最后，编辑后仍
    // 会把 HEAD 拽走）。
    const versions = await readVersions(documentId);
    if (versions.length === 0) {
      return { status: "failed", error: `unknown document ${documentId}` };
    }
    const head = await headVersion(documentId);
    if (!head) {
      return { status: "failed", error: `unknown document ${documentId}` };
    }
    const headIndex = versions.findIndex(
      (version) =>
        version.sequence === head.sequence &&
        version.revision === head.revision,
    );
    if (headIndex < 0) {
      return {
        status: "failed",
        error: "head marker does not match any version",
      };
    }
    if (headIndex === versions.length - 1) {
      return { status: "failed", error: "nothing to redo (no undo in effect)" };
    }
    const target = versions.at(-1);
    await writeFile(
      await headMarkerFile(documentId),
      `${target.sequence}-${target.revision}\n`,
      "utf8",
    );
    await appendLedger({
      id: documentId,
      operationId,
      redoneRevision: target.revision,
      redoneAt: new Date().toISOString(),
    });
    return {
      status: "succeeded",
      output: JSON.stringify({
        documentId,
        headRevision: target.revision,
        redoneRevision: target.revision,
      }),
    };
  },
};

readFrames(async (message) => {
  if (message.type === "hello") {
    if (message.protocolVersion !== 1) {
      send({
        type: "error",
        message: "unsupported protocol version " + message.protocolVersion,
      });
      return;
    }
    send({
      type: "ready",
      protocolVersion: 1,
      pluginId: "com.artemis.design",
    });
    return;
  }
  if (message.type === "tool.invoke") {
    const handler = tools[message.toolName];
    if (!handler) {
      send({
        type: "tool.result",
        requestId: message.requestId,
        status: "failed",
        error: "unknown tool " + message.toolName,
      });
      return;
    }
    try {
      const result = await handler(message.arguments ?? {});
      send({
        type: "tool.result",
        requestId: message.requestId,
        ...result,
      });
    } catch (error) {
      send({
        type: "tool.result",
        requestId: message.requestId,
        status: "failed",
        error: String(error),
      });
    }
    return;
  }
  send({ type: "error", message: "unexpected message type " + message.type });
});

process.stderr.write("artemis-design runtime started (S4)\n");

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

import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
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
  for (const entry of entries.sort()) {
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
  return versions.at(-1);
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
    const revision = createHash("sha256").update(html).digest("hex").slice(0, 16);
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
    if (!documentId) {
      return { status: "failed", error: "documentId must be non-empty" };
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
    const documents = [];
    for (const record of ledger) {
      const head = await headVersion(record.id);
      documents.push({
        documentId: record.id,
        name: record.name,
        brief: record.brief,
        headRevision: head?.revision ?? null,
        versionCount: head ? head.sequence : 0,
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
    if (!documentId || !expectedRevision || !operationId) {
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
    const nextSequence = head.sequence + 1;
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

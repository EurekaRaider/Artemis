// artemis-design runtime: stdio protocol implementation for the design plugin.
//
// Frame protocol (S0 test-notes heritage): length-prefixed JSON frames on
// stdin/stdout, hello -> ready handshake, tool.invoke -> tool.result,
// errors reported on stderr only.
//
// Post-refactor single-tool surface: there is no hosted-document ledger —
// design targets are plain files in the task workspace, AI edits them with
// ordinary file tools. get_snapshot returns the workspace file inventory
// (pages + images, conservative whitelist) the panel renders.
//
// Version history lives in .artemis/versions/ thin snapshots written by the
// HOST on file changes; the runtime is not involved.

import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

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

// Conservative scan whitelist — host scanProjectDesignFiles 同步此表
const PAGE_EXTENSIONS = new Set([".html", ".htm"]);
const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
]);
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".artemis",
  "dist",
  "build",
  "out",
  ".next",
  "coverage",
  ".cache",
  "__pycache__",
  ".venv",
]);
const MAX_FILES = 120;
const MAX_DEPTH = 4;

function kindFor(name) {
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : "";
  if (PAGE_EXTENSIONS.has(ext)) return "html";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  return null;
}

async function scanWorkspace(root) {
  const files = [];
  const walk = async (dir, depth) => {
    if (depth > MAX_DEPTH || files.length >= MAX_FILES) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) return;
      if (entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const kind = kindFor(entry.name);
      if (!kind) continue;
      let size = 0;
      let updatedAt = "";
      try {
        const info = await stat(full);
        size = info.size;
        updatedAt = info.mtime.toISOString();
      } catch {
        // unreadable entry: list without metadata rather than dropping it
      }
      files.push({
        path: relative(root, full).split("\\").join("/"),
        kind,
        bytes: size,
        ...(updatedAt ? { updatedAt } : {}),
      });
    }
  };
  await walk(root, 0);
  return files;
}

const tools = {
  async get_snapshot() {
    const root = process.cwd();
    const files = await scanWorkspace(root);
    return {
      status: "succeeded",
      output: JSON.stringify({
        workspace: root,
        files,
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
        error:
          "unknown tool " +
          message.toolName +
          " — design targets are workspace files; use file editing tools directly",
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

process.stderr.write(
  "artemis-design runtime started (workspace-file model, no hosted ledger)\n",
);

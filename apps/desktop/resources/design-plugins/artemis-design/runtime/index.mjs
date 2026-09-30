// artemis-design runtime: stdio protocol implementation for the design plugin.
//
// Frame protocol is copied from the S0 test-notes runtime
// (apps/desktop/resources/s0-plugins/test-notes/runtime/index.mjs):
// length-prefixed JSON frames on stdin/stdout, hello -> ready handshake,
// tool.invoke -> tool.result, errors reported on stderr only.
//
// Tools:
//   create_document({ name, brief }) -> appends to design-documents.jsonl in cwd
//   get_snapshot()                  -> reads design-documents.jsonl from cwd

import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";

const DOCUMENTS_FILE = "design-documents.jsonl";

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
    const record = {
      id: crypto.randomUUID(),
      name,
      brief,
      createdAt: new Date().toISOString(),
    };
    await appendFile(
      join(process.cwd(), DOCUMENTS_FILE),
      JSON.stringify(record) + "\n",
      "utf8",
    );
    return {
      status: "succeeded",
      output: JSON.stringify({ documentId: record.id }),
    };
  },
  async get_snapshot() {
    let text;
    try {
      text = await readFile(join(process.cwd(), DOCUMENTS_FILE), "utf8");
    } catch {
      return { status: "succeeded", output: JSON.stringify({ documents: [] }) };
    }
    const documents = text
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
    return {
      status: "succeeded",
      output: JSON.stringify({ documents }),
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

process.stderr.write("artemis-design runtime started\n");

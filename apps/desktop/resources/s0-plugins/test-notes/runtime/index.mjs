// S0 test-notes runtime: real stdio protocol implementation.
//
// Implements the length-prefixed JSON frame protocol on stdin/stdout:
//   hello -> ready handshake, then tool.invoke for notes_append/notes_list.
// Notes are appended to notes.jsonl in the runtime's cwd (the host-granted
// private scratch), one JSON object per line. Logs go to stderr only.

import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";

const NOTES_FILE = "notes.jsonl";

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
  async notes_append(args) {
    const note = String(args?.note ?? "");
    if (!note.trim()) {
      return { status: "failed", error: "note must be non-empty" };
    }
    await appendFile(
      NOTES_FILE,
      JSON.stringify({ note, at: new Date().toISOString() }) + "\n",
      "utf8",
    );
    return { status: "succeeded", output: "appended 1 note" };
  },
  async notes_list() {
    let text;
    try {
      text = await readFile(join(process.cwd(), NOTES_FILE), "utf8");
    } catch {
      return { status: "succeeded", output: "[]" };
    }
    const notes = text
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
    return { status: "succeeded", output: JSON.stringify(notes) };
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
      pluginId: "com.artemis.s0.test-notes",
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

process.stderr.write("s0-notes runtime started\n");

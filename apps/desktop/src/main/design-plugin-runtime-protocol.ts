// S0 design-plugin stdio runtime protocol (proposal §9.4 slice).
//
// Wire format: each frame is a 4-byte big-endian length prefix followed by
// that many UTF-8 bytes of JSON. stdout carries protocol frames only; logs
// go to stderr. The host is authoritative: the runtime may only respond to
// requests the host initiated.
//
// Message set (S0 slice of the full proposal table):
//   host -> runtime: hello, tool.invoke
//   runtime -> host: ready, tool.result, error

export const RUNTIME_PROTOCOL_VERSION = 1;

export interface HelloMessage {
  type: "hello";
  protocolVersion: number;
  pluginId: string;
  contentHash: string;
}

export interface ReadyMessage {
  type: "ready";
  protocolVersion: number;
  pluginId: string;
}

export interface ToolInvokeMessage {
  type: "tool.invoke";
  requestId: string;
  toolName: string;
  /** JSON-serializable arguments validated by the host against the schema. */
  arguments: Record<string, unknown>;
}

export interface ToolResultMessage {
  type: "tool.result";
  requestId: string;
  status: "succeeded" | "failed";
  /** Tool payload on success; human-readable reason on failure. */
  output?: string;
  error?: string;
}

export interface ErrorMessage {
  type: "error";
  /** Protocol-level failure: bad frame, unknown type, wrong version. */
  message: string;
}

export type HostToRuntimeMessage = HelloMessage | ToolInvokeMessage;
export type RuntimeToHostMessage =
  ReadyMessage | ToolResultMessage | ErrorMessage;

/** Encode one frame with its length prefix. */
export function encodeFrame(message: HostToRuntimeMessage): Buffer {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

/**
 * Incremental frame decoder. Feed stdout chunks; pull complete messages.
 * Enforces the S0 control-frame limit (256 KiB) — bigger frames abort the
 * stream as protocol corruption.
 */
export class FrameDecoder {
  private buffer = Buffer.alloc(0);
  private static readonly MAX_FRAME = 256 * 1024;

  push(chunk: Buffer): RuntimeToHostMessage[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: RuntimeToHostMessage[] = [];
    for (;;) {
      if (this.buffer.length < 4) break;
      const length = this.buffer.readUInt32BE(0);
      if (length > FrameDecoder.MAX_FRAME) {
        throw new Error(
          `Runtime frame of ${length} bytes exceeds the ${FrameDecoder.MAX_FRAME} limit; aborting stream.`,
        );
      }
      if (this.buffer.length < 4 + length) break;
      const payload = this.buffer.subarray(4, 4 + length).toString("utf8");
      this.buffer = this.buffer.subarray(4 + length);
      const parsed = JSON.parse(payload) as RuntimeToHostMessage;
      validateInbound(parsed);
      messages.push(parsed);
    }
    return messages;
  }
}

function validateInbound(message: RuntimeToHostMessage): void {
  if (!message || typeof message.type !== "string") {
    throw new Error("Runtime sent a frame without a type.");
  }
  switch (message.type) {
    case "ready":
      if (message.protocolVersion !== RUNTIME_PROTOCOL_VERSION) {
        throw new Error(
          `Runtime announced protocol ${message.protocolVersion}; host requires ${RUNTIME_PROTOCOL_VERSION}.`,
        );
      }
      return;
    case "tool.result":
      if (typeof message.requestId !== "string") {
        throw new Error("tool.result without requestId.");
      }
      return;
    case "error":
      return;
    default: {
      const exhaustive: never = message;
      throw new Error(
        `Unknown runtime message type: ${String((exhaustive as { type?: string }).type)}`,
      );
    }
  }
}

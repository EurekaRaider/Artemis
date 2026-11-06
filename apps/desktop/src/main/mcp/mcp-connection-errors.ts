import type { McpServerConfig } from "../../shared/api.js";
import {
  MAX_STDIO_STDERR_BYTES,
  SECRET_ARGUMENTS,
} from "./mcp-connection-limits.js";
export function appendStderr(current: string, chunk: unknown): string {
  const next = `${current}${
    Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk)
  }`;
  return Buffer.byteLength(next, "utf8") <= MAX_STDIO_STDERR_BYTES
    ? next
    : Buffer.from(next, "utf8")
        .subarray(-MAX_STDIO_STDERR_BYTES)
        .toString("utf8");
}

export function errorStderr(error: unknown): string {
  if (!error || typeof error !== "object" || !("stderr" in error)) return "";
  const stderr = error.stderr;
  if (typeof stderr === "string") return stderr.trim();
  if (Buffer.isBuffer(stderr)) return stderr.toString("utf8").trim();
  return "";
}

export function displayCommand(config: McpServerConfig): string {
  if (config.transport !== "stdio") return "";
  let redactNext = false;
  const args = config.args.map((argument) => {
    if (redactNext) {
      redactNext = false;
      return "<redacted>";
    }
    if (SECRET_ARGUMENTS.has(argument.toLowerCase())) {
      redactNext = true;
    }
    return argument;
  });
  return [config.command, ...args]
    .map((argument) =>
      /^[a-zA-Z0-9_@./:\\-]+$/u.test(argument)
        ? argument
        : JSON.stringify(argument),
    )
    .join(" ");
}

export function connectionError(
  config: McpServerConfig,
  error: unknown,
): string {
  const message = error instanceof Error ? error.message : String(error);
  if (config.transport !== "stdio") return message;
  const stderr = errorStderr(error);
  return [
    `stdio MCP "${config.id}" failed while starting: ${displayCommand(config)}`,
    ...(stderr ? [`Process stderr: ${stderr}`] : [message]),
  ].join("\n");
}

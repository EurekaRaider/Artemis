import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

export const mcpCallResultSchema = CallToolResultSchema.extend({
  structuredContent: z.json().optional(),
});

export const MAX_STDIO_STDERR_BYTES = 64 * 1024;

export const MCP_STARTUP_TIMEOUT_MS = 15_000;

export const WINDOWS_STDIO_GRACEFUL_EXIT_TIMEOUT_MS = 15_000;

export const STDIO_PROCESS_EXIT_TIMEOUT_MS = 5_000;

export const STDIO_STARTUP_TEARDOWN_TIMEOUT_MS = 35_000;

export const SECRET_ARGUMENTS = new Set([
  "--api-key",
  "--bearer-token",
  "--password",
  "--secret",
  "--token",
]);

export const MAX_MCP_RESULT_TRANSFER_BYTES = 2 * 1024 * 1024;

export const IMAGE_MIME_TYPE = /^image\/[a-z0-9.+-]{1,64}$/iu;

import type {
  McpToolCallResult,
  McpToolResultContent,
} from "@artemis/protocol";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  mcpCallResultSchema,
  IMAGE_MIME_TYPE,
  MAX_MCP_RESULT_TRANSFER_BYTES,
} from "./mcp-connection-limits.js";
import {
  type McpConnection,
  type McpCallResult,
} from "./mcp-connection-types.js";
export async function callMcpClientTool(
  client: Client,
  input: Parameters<McpConnection["callTool"]>[0],
  signal?: AbortSignal,
): Promise<McpCallResult> {
  const result = await client.callTool(
    input,
    mcpCallResultSchema as unknown as typeof CallToolResultSchema,
    signal ? { signal } : undefined,
  );
  return {
    content: result.content as unknown[],
    ...(result.structuredContent === undefined
      ? {}
      : { structuredContent: result.structuredContent }),
    isError: Boolean(result.isError),
  };
}

export function contentType(item: unknown): string {
  if (
    item &&
    typeof item === "object" &&
    "type" in item &&
    typeof item.type === "string" &&
    item.type.trim()
  ) {
    return item.type.trim().slice(0, 64);
  }
  return "unknown";
}

export function normalizeImageData(value: string):
  | {
      data: string;
      decodedBytes: number;
    }
  | undefined {
  const data = value.replaceAll(/\s/gu, "");
  if (!data || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(data)) {
    return undefined;
  }
  const decoded = Buffer.from(data, "base64");
  if (decoded.toString("base64") !== data) return undefined;
  return { data, decodedBytes: decoded.byteLength };
}

export function formatMcpResult(result: McpCallResult): McpToolCallResult {
  const content: McpToolResultContent[] = [];
  let transferBytes = 0;
  let textBytes = 0;
  let imageBytes = 0;
  let imageCount = 0;
  let omittedContentCount = 0;
  const addText = (text: string) => {
    const bytes = Buffer.byteLength(text, "utf8");
    transferBytes += bytes;
    textBytes += bytes;
    content.push({ type: "text", text });
  };

  for (const item of result.content ?? []) {
    if (
      item &&
      typeof item === "object" &&
      "type" in item &&
      item.type === "text" &&
      "text" in item &&
      typeof item.text === "string"
    ) {
      addText(item.text);
      continue;
    }
    if (
      item &&
      typeof item === "object" &&
      "type" in item &&
      item.type === "image" &&
      "data" in item &&
      typeof item.data === "string" &&
      "mimeType" in item &&
      typeof item.mimeType === "string" &&
      IMAGE_MIME_TYPE.test(item.mimeType)
    ) {
      const image = normalizeImageData(item.data);
      if (image) {
        transferBytes += Buffer.byteLength(image.data, "ascii");
        imageBytes += image.decodedBytes;
        imageCount += 1;
        content.push({
          type: "image",
          data: image.data,
          mimeType: item.mimeType.toLowerCase(),
        });
        continue;
      }
    }
    omittedContentCount += 1;
    addText(`[Unsupported MCP content omitted: ${contentType(item)}]`);
  }

  if (result.structuredContent !== undefined)
    transferBytes += Buffer.byteLength(
      JSON.stringify(result.structuredContent),
      "utf8",
    );
  if (transferBytes > MAX_MCP_RESULT_TRANSFER_BYTES) {
    throw new Error("MCP tool output exceeds 2 MiB");
  }
  return {
    content,
    ...(result.structuredContent !== undefined
      ? { structuredContent: result.structuredContent }
      : {}),
    isError: Boolean(result.isError),
    metrics: {
      textBytes,
      imageBytes,
      imageCount,
      omittedContentCount,
    },
  };
}

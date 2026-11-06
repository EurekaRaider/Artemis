import { estimateTextTokens, textWithinTokenBudget } from "@artemis/protocol";
import { type McpToolResultContent } from "@artemis/protocol";
import { compactionSettingsForContextWindow } from "../context/context-window.js";

export const MINIMUM_MCP_TEXT_BUDGET_TOKENS = 256;

export const MAXIMUM_MCP_TEXT_BUDGET_BYTES = 2 * 1024 * 1024;

export const FALLBACK_MCP_CONTEXT_WINDOW = 128 * 1024;

export function mcpTextBudgetTokens(
  contextWindow?: number,
  currentContextTokens?: number | null,
): number {
  const window = contextWindow ?? FALLBACK_MCP_CONTEXT_WINDOW;
  const current = currentContextTokens ?? Math.floor(window * 0.5);
  const reserve = compactionSettingsForContextWindow(window).reserveTokens;
  const availableTokens = Math.max(0, window - current - reserve);
  return Math.max(MINIMUM_MCP_TEXT_BUDGET_TOKENS, availableTokens);
}

export function truncateUtf8(value: string, maximumBytes: number): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= maximumBytes) return value;
  return bytes
    .subarray(0, maximumBytes)
    .toString("utf8")
    .replace(/\uFFFD$/u, "");
}

export function truncateUtf8Tail(value: string, maximumBytes: number): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= maximumBytes) return value;
  return bytes
    .subarray(bytes.byteLength - maximumBytes)
    .toString("utf8")
    .replace(/^\uFFFD/u, "");
}

export function prepareMcpToolContent(
  content: readonly McpToolResultContent[],
  contextWindow?: number,
  currentContextTokens?: number | null,
): {
  content: McpToolResultContent[];
  deliveredTextBytes: number;
  omittedTextBytes: number;
  truncated: boolean;
} {
  const maximumTokens = mcpTextBudgetTokens(
    contextWindow,
    currentContextTokens,
  );
  const maximumBytes = MAXIMUM_MCP_TEXT_BUDGET_BYTES;
  const originalText = content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n");
  const originalTextBytes = Buffer.byteLength(originalText, "utf8");
  if (
    originalTextBytes <= maximumBytes &&
    estimateTextTokens(originalText) <= maximumTokens
  ) {
    return {
      content: content.length > 0 ? [...content] : [{ type: "text", text: "" }],
      deliveredTextBytes: originalTextBytes,
      omittedTextBytes: 0,
      truncated: false,
    };
  }

  let omittedTextBytes = originalTextBytes;
  let notice = "";
  let head = "";
  let tail = "";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    notice = `\n[MCP output truncated by Artemis: ${omittedTextBytes} UTF-8 bytes omitted to protect the remaining model context.]\n`;
    const bodyBudget = Math.max(
      0,
      maximumBytes - Buffer.byteLength(notice, "utf8"),
    );
    const bodyTokens = Math.max(
      0,
      maximumTokens - estimateTextTokens(notice) - 2,
    );
    head = textWithinTokenBudget(
      truncateUtf8(originalText, Math.ceil(bodyBudget * 0.6)),
      Math.floor(bodyTokens * 0.6),
    );
    tail = textWithinTokenBudget(
      truncateUtf8Tail(originalText, Math.floor(bodyBudget * 0.4)),
      Math.floor(bodyTokens * 0.4),
      true,
    );
    const nextOmittedTextBytes = Math.max(
      0,
      originalTextBytes -
        Buffer.byteLength(head, "utf8") -
        Buffer.byteLength(tail, "utf8"),
    );
    if (nextOmittedTextBytes === omittedTextBytes) break;
    omittedTextBytes = nextOmittedTextBytes;
  }
  const text = `${head}${notice}${tail}`;
  const prepared: McpToolResultContent[] = [
    { type: "text", text },
    ...content.filter((block) => block.type === "image"),
  ];
  const deliveredTextBytes = Buffer.byteLength(text, "utf8");
  return {
    content: prepared,
    deliveredTextBytes,
    omittedTextBytes,
    truncated: true,
  };
}

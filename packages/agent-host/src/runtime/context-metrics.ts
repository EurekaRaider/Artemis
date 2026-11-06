import { estimateTextTokens } from "@artemis/protocol";
import {
  estimateTokens,
  formatSkillsForPrompt,
} from "@earendil-works/pi-coding-agent";
import { compactionSettingsForContextWindow } from "../context/context-window.js";
import {
  type SessionTool,
  type ContextTokenBreakdown,
  type HostedThread,
  type ContextFootprint,
} from "./runtime-types.js";
import { removeFirst } from "./session-queue.js";
import { record } from "./runtime-values.js";
export function parentConcurrencyLimit(limit: number): number {
  return Math.min(limit, Math.max(2, limit - 1));
}

export function contextFilesPrompt(
  files: readonly { path: string; content: string }[],
): string {
  if (files.length === 0) return "";
  return [
    "\n\n<project_context>\n\n",
    "Project-specific instructions and guidelines:\n\n",
    ...files.map(
      (file) =>
        `<project_instructions path="${file.path}">\n${file.content}\n</project_instructions>\n\n`,
    ),
    "</project_context>\n",
  ].join("");
}

export function serializedToolSchemas(tools: readonly SessionTool[]): string {
  try {
    return JSON.stringify(
      tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      })),
    );
  } catch {
    return "";
  }
}

export function estimateToolSchemaTokens(
  tools: readonly SessionTool[],
): number {
  return tools.length === 0
    ? 0
    : estimateTextTokens(serializedToolSchemas(tools));
}

export function normalizeContextTokenBreakdown(
  breakdown: ContextTokenBreakdown,
  totalTokens: number | null,
): ContextTokenBreakdown {
  if (totalTokens === null) return breakdown;
  const rawTotal =
    breakdown.systemPromptTokens +
    breakdown.systemToolTokens +
    breakdown.mcpToolTokens +
    breakdown.customAgentTokens +
    breakdown.memoryFileTokens +
    breakdown.skillTokens +
    breakdown.messageTokens;
  if (rawTotal === 0) return breakdown;

  const scale = totalTokens / rawTotal;
  const normalized: ContextTokenBreakdown = {
    systemPromptTokens: Math.floor(breakdown.systemPromptTokens * scale),
    systemToolTokens: Math.floor(breakdown.systemToolTokens * scale),
    mcpToolTokens: Math.floor(breakdown.mcpToolTokens * scale),
    customAgentTokens: Math.floor(breakdown.customAgentTokens * scale),
    memoryFileTokens: Math.floor(breakdown.memoryFileTokens * scale),
    skillTokens: Math.floor(breakdown.skillTokens * scale),
    messageTokens: Math.floor(breakdown.messageTokens * scale),
    freeSpaceTokens: breakdown.freeSpaceTokens,
    autocompactBufferTokens: breakdown.autocompactBufferTokens,
  };
  normalized.systemPromptTokens +=
    totalTokens -
    (normalized.systemPromptTokens +
      normalized.systemToolTokens +
      normalized.mcpToolTokens +
      normalized.customAgentTokens +
      normalized.memoryFileTokens +
      normalized.skillTokens +
      normalized.messageTokens);
  return normalized;
}

export function usedContextTokens(breakdown: ContextTokenBreakdown): number {
  return (
    breakdown.systemPromptTokens +
    breakdown.systemToolTokens +
    breakdown.mcpToolTokens +
    breakdown.customAgentTokens +
    breakdown.memoryFileTokens +
    breakdown.skillTokens +
    breakdown.messageTokens
  );
}

export function contextTokenBreakdown(
  hosted: HostedThread,
  totalTokens: number | null,
  contextWindow: number,
  estimatedMessageTokens?: number,
): ContextTokenBreakdown | undefined {
  const systemPrompt = hosted.session.systemPrompt;
  if (typeof systemPrompt !== "string") return undefined;

  const contextFiles =
    hosted.resourceLoader?.getAgentsFiles().agentsFiles ?? [];
  const skills = hosted.resourceLoader?.getSkills().skills ?? [];
  const projectInstructions = contextFilesPrompt(contextFiles);
  const skillPrompt = formatSkillsForPrompt(skills);
  const includedProjectInstructions = systemPrompt.includes(projectInstructions)
    ? projectInstructions
    : "";
  const includedSkillPrompt = systemPrompt.includes(skillPrompt)
    ? skillPrompt
    : "";
  const baseSystemPrompt = removeFirst(
    removeFirst(systemPrompt, includedProjectInstructions),
    includedSkillPrompt,
  );
  const tools = hosted.session.agent?.state?.tools ?? [];
  const mcpToolNames = hosted.mcpToolNames ?? new Set<string>();
  const systemTools = tools.filter((tool) => !mcpToolNames.has(tool.name));
  const mcpTools = tools.filter((tool) => mcpToolNames.has(tool.name));
  const messages = hosted.session.messages ?? [];
  const usedBreakdown: ContextTokenBreakdown = {
    systemPromptTokens: estimateTextTokens(baseSystemPrompt),
    systemToolTokens: estimateToolSchemaTokens(systemTools),
    mcpToolTokens: estimateToolSchemaTokens(mcpTools),
    customAgentTokens: 0,
    memoryFileTokens: estimateTextTokens(includedProjectInstructions),
    skillTokens: estimateTextTokens(includedSkillPrompt),
    messageTokens:
      estimatedMessageTokens ??
      messages.reduce((total, message) => total + estimateTokens(message), 0),
    freeSpaceTokens: 0,
    autocompactBufferTokens: 0,
  };
  const normalized = normalizeContextTokenBreakdown(
    usedBreakdown,
    // Pi's post-compaction estimate covers rebuilt messages only. Keep the
    // fixed prompt and tool estimates intact instead of scaling them into it.
    estimatedMessageTokens === undefined ? totalTokens : null,
  );
  const usedTokens = usedContextTokens(normalized);
  normalized.autocompactBufferTokens =
    compactionSettingsForContextWindow(contextWindow).reserveTokens;
  normalized.freeSpaceTokens = Math.max(
    0,
    contextWindow - usedTokens - normalized.autocompactBufferTokens,
  );
  return normalized;
}

export function base64ByteLength(value: string): number {
  try {
    return Buffer.from(value, "base64").byteLength;
  } catch {
    return 0;
  }
}

export function messageFootprint(message: unknown): {
  textBytes: number;
  imageBytes: number;
  imageCount: number;
} {
  const candidate = record(message);
  const content = candidate?.content;
  const blocks = Array.isArray(content)
    ? content
    : typeof content === "string"
      ? [{ type: "text", text: content }]
      : [];
  let textBytes = 0;
  let imageBytes = 0;
  let imageCount = 0;
  for (const value of blocks) {
    const block = record(value);
    if (!block) continue;
    if (block.type === "image" && typeof block.data === "string") {
      imageBytes += base64ByteLength(block.data);
      imageCount += 1;
    } else if (typeof block.text === "string") {
      textBytes += Buffer.byteLength(block.text, "utf8");
    } else if (typeof block.thinking === "string") {
      textBytes += Buffer.byteLength(block.thinking, "utf8");
    } else if (block.type === "toolCall") {
      textBytes += Buffer.byteLength(
        `${typeof block.name === "string" ? block.name : ""}${JSON.stringify(block.arguments ?? {})}`,
        "utf8",
      );
    }
  }
  return { textBytes, imageBytes, imageCount };
}

export function contextFootprint(
  messages: readonly unknown[],
  tools: readonly SessionTool[],
): ContextFootprint {
  let textBytes = 0;
  let imageBytes = 0;
  let imageCount = 0;
  let largestToolResultBytes = 0;
  for (const message of messages) {
    const footprint = messageFootprint(message);
    textBytes += footprint.textBytes;
    imageBytes += footprint.imageBytes;
    imageCount += footprint.imageCount;
    const candidate = record(message);
    if (candidate?.role === "toolResult") {
      const metrics = record(record(candidate.details)?.metrics);
      const originalTextBytes =
        typeof metrics?.textBytes === "number" && metrics.textBytes >= 0
          ? metrics.textBytes
          : footprint.textBytes;
      const originalImageBytes =
        typeof metrics?.imageBytes === "number" && metrics.imageBytes >= 0
          ? metrics.imageBytes
          : footprint.imageBytes;
      largestToolResultBytes = Math.max(
        largestToolResultBytes,
        originalTextBytes + originalImageBytes,
      );
    }
  }
  const toolSchemaBytes = Buffer.byteLength(
    serializedToolSchemas(tools),
    "utf8",
  );
  return {
    textBytes,
    imageBytes,
    imageCount,
    toolSchemaBytes,
    largestToolResultBytes,
  };
}

export function lastProviderInput(messages: readonly unknown[]):
  | {
      index: number;
      tokens: number;
    }
  | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = record(messages[index]);
    if (
      message?.role !== "assistant" ||
      message.stopReason === "aborted" ||
      message.stopReason === "error"
    ) {
      continue;
    }
    const usage = record(message.usage);
    if (typeof usage?.input === "number" && usage.input >= 0) {
      return { index, tokens: Math.round(usage.input) };
    }
  }
  return undefined;
}

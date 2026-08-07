import type { AgentPayload } from "./schema.js";

interface PiMessage {
  id?: string;
  role?: string;
  content?: unknown;
  stopReason?: string;
  errorMessage?: string;
  usage?: {
    input?: unknown;
    output?: unknown;
    cacheRead?: unknown;
    cacheWrite?: unknown;
    totalTokens?: unknown;
  };
}

interface PiMessageLifecycle {
  type: "message_start" | "message_end";
  message?: PiMessage;
}

interface PiMessageUpdate {
  type: "message_update";
  message?: PiMessage;
  assistantMessageEvent?: {
    type?: string;
    delta?: string;
  };
}

interface PiToolEvent {
  type: "tool_execution_start" | "tool_execution_update" | "tool_execution_end";
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  partialResult?: unknown;
  result?: unknown;
  isError?: boolean;
}

interface PiLifecycleEvent {
  type: "agent_end" | "agent_settled";
}

interface PiQueueUpdate {
  type: "queue_update";
  steering: readonly string[];
  followUp: readonly string[];
}

export type PiEventLike =
  | PiMessageLifecycle
  | PiMessageUpdate
  | PiToolEvent
  | PiLifecycleEvent
  | PiQueueUpdate;

type AssistantPartType = "text" | "thinking";

function assistantContent(
  message: PiMessage | undefined,
): { partType: AssistantPartType; text: string }[] {
  if (message?.role !== "assistant" || !Array.isArray(message.content)) {
    return [];
  }

  const content = new Map<AssistantPartType, string>();
  for (const value of message.content) {
    if (!value || typeof value !== "object" || !("type" in value)) {
      continue;
    }
    const part = value as {
      type?: unknown;
      text?: unknown;
      thinking?: unknown;
    };
    const partType =
      part.type === "text"
        ? "text"
        : part.type === "thinking"
          ? "thinking"
          : undefined;
    const text =
      partType === "text"
        ? part.text
        : partType === "thinking"
          ? part.thinking
          : undefined;
    if (partType && typeof text === "string") {
      content.set(partType, `${content.get(partType) ?? ""}${text}`);
    }
  }
  return [...content].map(([partType, text]) => ({ partType, text }));
}

function outputText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && "content" in value) {
    const content = (value as { content?: unknown }).content;
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (
            part &&
            typeof part === "object" &&
            "text" in part &&
            typeof (part as { text?: unknown }).text === "string"
          ) {
            return (part as { text: string }).text;
          }
          return "";
        })
        .join("");
    }
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function observedBashOutput(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  let snapshot: unknown = value;
  if (value && typeof value === "object" && "details" in value) {
    snapshot = (value as { details?: unknown }).details;
  }
  if (
    (!snapshot ||
      typeof snapshot !== "object" ||
      !("executionId" in snapshot) ||
      !("status" in snapshot) ||
      !("outputDelta" in snapshot)) &&
    value &&
    typeof value === "object" &&
    "content" in value
  ) {
    const rendered = outputText(value);
    try {
      snapshot = JSON.parse(rendered);
    } catch {
      return rendered;
    }
  }
  if (
    !snapshot ||
    typeof snapshot !== "object" ||
    !("executionId" in snapshot) ||
    !("status" in snapshot) ||
    !("outputDelta" in snapshot)
  ) {
    return outputText(value);
  }

  const result = snapshot as { outputDelta?: unknown; error?: unknown };
  const chunks: string[] = [];
  if (typeof result.outputDelta === "string" && result.outputDelta) {
    chunks.push(result.outputDelta);
  }
  if (typeof result.error === "string" && result.error.trim()) {
    chunks.push(result.error.trim());
  }
  return chunks.join("\n");
}

function isObservedBashTool(toolName: string | undefined): boolean {
  return (
    toolName === "bash" ||
    toolName === "bash_wait" ||
    toolName === "bash_cancel"
  );
}

function messageText(message: PiMessage | undefined): string {
  if (typeof message?.content === "string") {
    return message.content;
  }
  if (!Array.isArray(message?.content)) {
    return "";
  }
  return message.content
    .map((part) =>
      part &&
      typeof part === "object" &&
      "text" in part &&
      typeof (part as { text?: unknown }).text === "string"
        ? (part as { text: string }).text
        : "",
    )
    .join("");
}

function assistantUsage(
  message: PiMessage | undefined,
): Extract<AgentPayload, { type: "assistant.usage" }> | undefined {
  if (message?.role !== "assistant" || !message.usage) return undefined;
  const values = [
    message.usage.input,
    message.usage.output,
    message.usage.cacheRead,
    message.usage.cacheWrite,
    message.usage.totalTokens,
  ];
  if (
    values.some(
      (value) =>
        typeof value !== "number" || !Number.isSafeInteger(value) || value < 0,
    )
  ) {
    return undefined;
  }
  return {
    type: "assistant.usage",
    inputTokens: message.usage.input as number,
    outputTokens: message.usage.output as number,
    cacheReadTokens: message.usage.cacheRead as number,
    cacheWriteTokens: message.usage.cacheWrite as number,
    totalTokens: message.usage.totalTokens as number,
  };
}

export class PiAdapter {
  private activeMessageId: string | undefined;
  private activeMessageContent: Record<AssistantPartType, string> = {
    text: "",
    thinking: "",
  };
  private assistantMessageCount = 0;
  private readonly emittedUsageMessageIds = new Set<string>();
  private sawAssistantMessage = false;
  private sawAssistantContent = false;
  private turnFailed = false;
  private readonly toolNames = new Map<string, string>();
  private userMessageCount = 0;

  constructor(private readonly turnId: string) {}

  private beginAssistantMessage(messageId?: string): void {
    this.assistantMessageCount += 1;
    this.activeMessageId =
      messageId ??
      (this.assistantMessageCount === 1
        ? this.turnId
        : `${this.turnId}:assistant:${this.assistantMessageCount}`);
    this.activeMessageContent = { text: "", thinking: "" };
  }

  adapt(event: PiEventLike): AgentPayload[] {
    switch (event.type) {
      case "message_start": {
        if (event.message?.role === "user") {
          this.userMessageCount += 1;
          if (this.userMessageCount === 1) {
            return [];
          }
          const text = messageText(event.message);
          return text
            ? [
                {
                  type: "user.message",
                  messageId:
                    event.message.id ??
                    `${this.turnId}:user:${this.userMessageCount}`,
                  text,
                },
              ]
            : [];
        }
        if (event.message?.role === "assistant") {
          this.sawAssistantMessage = true;
          this.beginAssistantMessage(event.message.id);
        }
        return [];
      }
      case "message_update": {
        const updateType = event.assistantMessageEvent?.type;
        const delta = event.assistantMessageEvent?.delta;
        if (
          (updateType !== "text_delta" && updateType !== "thinking_delta") ||
          typeof delta !== "string"
        ) {
          return [];
        }
        if (event.message?.id && event.message.id !== this.activeMessageId) {
          this.beginAssistantMessage(event.message.id);
        } else if (!this.activeMessageId) {
          this.beginAssistantMessage(event.message?.id);
        }
        const messageId = this.activeMessageId!;
        const partType = updateType === "text_delta" ? "text" : "thinking";
        this.sawAssistantMessage = true;
        this.sawAssistantContent ||= delta.length > 0;
        this.activeMessageContent[partType] += delta;
        if (partType === "thinking") return [];
        return [
          {
            type: "message.part.delta",
            partId: `${messageId}:${partType}`,
            partType,
            delta,
          },
        ];
      }
      case "message_end": {
        if (
          event.message?.role === "assistant" &&
          (!this.activeMessageId ||
            (event.message.id !== undefined &&
              event.message.id !== this.activeMessageId))
        ) {
          this.beginAssistantMessage(event.message.id);
        }
        const messageId =
          this.activeMessageId ?? event.message?.id ?? this.turnId;
        const finalContent = assistantContent(event.message);
        if (event.message?.role === "assistant") {
          this.sawAssistantMessage = true;
          this.sawAssistantContent ||= finalContent.some(
            ({ text }) => text.length > 0,
          );
        }
        const payloads: AgentPayload[] = [];
        for (const { partType, text } of finalContent) {
          if (partType === "thinking") {
            this.activeMessageContent.thinking = text;
            continue;
          }
          const emitted = this.activeMessageContent[partType];
          if (!text.startsWith(emitted)) continue;
          const delta = text.slice(emitted.length);
          this.activeMessageContent[partType] = text;
          if (delta) {
            payloads.push({
              type: "message.part.delta",
              partId: `${messageId}:${partType}`,
              partType,
              delta,
            });
          }
        }
        const usage = assistantUsage(event.message);
        if (usage && !this.emittedUsageMessageIds.has(messageId)) {
          this.emittedUsageMessageIds.add(messageId);
          payloads.push(usage);
        }
        if (
          event.message?.role === "assistant" &&
          event.message.stopReason === "error"
        ) {
          this.turnFailed = true;
          payloads.push({
            type: "turn.failed",
            message:
              event.message.errorMessage?.trim() || "The model request failed.",
          });
        }
        if (event.message?.role === "assistant") {
          this.activeMessageId = undefined;
        }
        return payloads;
      }
      case "tool_execution_start": {
        const toolCallId = event.toolCallId ?? `${this.turnId}:tool`;
        const toolName = event.toolName ?? "tool";
        this.toolNames.set(toolCallId, toolName);
        return [
          {
            type: "tool.started",
            toolCallId,
            toolName,
            ...(event.args === undefined ? {} : { input: event.args }),
          },
        ];
      }
      case "tool_execution_update": {
        return [
          {
            type: "tool.updated",
            toolCallId: event.toolCallId ?? `${this.turnId}:tool`,
            output: outputText(event.partialResult),
          },
        ];
      }
      case "tool_execution_end": {
        const toolCallId = event.toolCallId ?? `${this.turnId}:tool`;
        const toolName = event.toolName ?? this.toolNames.get(toolCallId);
        this.toolNames.delete(toolCallId);
        return [
          {
            type: "tool.completed",
            toolCallId,
            output: isObservedBashTool(toolName)
              ? (observedBashOutput(event.result) ?? "")
              : outputText(event.result),
            isError: event.isError ?? false,
          },
        ];
      }
      case "queue_update":
        return [
          {
            type: "queue.updated",
            steering: [...event.steering],
            followUp: [...event.followUp],
          },
        ];
      case "agent_end":
        return [];
      case "agent_settled": {
        if (this.turnFailed) {
          return [];
        }
        if (this.sawAssistantMessage && !this.sawAssistantContent) {
          this.turnFailed = true;
          return [
            {
              type: "turn.failed",
              message:
                "The model returned no assistant content. Verify that the provider API protocol matches the endpoint.",
            },
          ];
        }
        return [{ type: "turn.completed", reason: "completed" }];
      }
    }
    return [];
  }
}

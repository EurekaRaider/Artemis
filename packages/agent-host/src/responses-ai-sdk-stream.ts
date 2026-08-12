import {
  createOpenAI,
  type OpenAILanguageModelResponsesOptions,
} from "@ai-sdk/openai";
import {
  jsonSchema,
  streamText,
  tool,
  type AssistantContent,
  type LanguageModelUsage,
  type ModelMessage,
  type ToolSet,
} from "ai";
import {
  calculateCost,
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
  type ToolCall,
  type Usage,
} from "@earendil-works/pi-ai";

import {
  promptCacheMetadata,
  type PromptCacheResolution,
} from "./prompt-cache.js";

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function requestHeaders(
  headers: SimpleStreamOptions["headers"],
): Record<string, string> | undefined {
  if (!headers) return undefined;
  const entries = Object.entries(headers).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function toModelMessages(context: Context): ModelMessage[] {
  return context.messages.flatMap((message): ModelMessage[] => {
    if (message.role === "user") {
      if (typeof message.content === "string") {
        return [{ role: "user", content: message.content }];
      }
      return [
        {
          role: "user",
          content: message.content.map((content) =>
            content.type === "text"
              ? { type: "text" as const, text: content.text }
              : {
                  type: "image" as const,
                  image: content.data,
                  mediaType: content.mimeType,
                },
          ),
        },
      ];
    }

    if (message.role === "assistant") {
      const content: Exclude<AssistantContent, string> = [];
      for (const part of message.content) {
        if (part.type === "text" && part.text) {
          content.push({ type: "text", text: part.text });
        }
        if (part.type === "toolCall") {
          content.push({
            type: "tool-call",
            toolCallId: part.id,
            toolName: part.name,
            input: part.arguments,
          });
        }
      }
      return content.length ? [{ role: "assistant", content }] : [];
    }

    const text = message.content
      .map((content) =>
        content.type === "text"
          ? content.text
          : `[image result: ${content.mimeType}]`,
      )
      .join("\n");
    return [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: message.toolCallId,
            toolName: message.toolName,
            output: message.isError
              ? { type: "error-text", value: text }
              : { type: "text", value: text },
          },
        ],
      },
    ];
  });
}

function toAiSdkTools(context: Context): ToolSet | undefined {
  if (!context.tools?.length) return undefined;
  return Object.fromEntries(
    context.tools.map((definition) => [
      definition.name,
      tool({
        description: definition.description,
        inputSchema: jsonSchema(
          definition.parameters as Parameters<typeof jsonSchema>[0],
        ),
      }),
    ]),
  );
}

function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

function applyUsage(
  model: Model<Api>,
  output: AssistantMessage,
  usage: LanguageModelUsage,
  cache: PromptCacheResolution | undefined,
): void {
  const cacheRead = usage.inputTokenDetails.cacheReadTokens ?? 0;
  const cacheWrite = usage.inputTokenDetails.cacheWriteTokens ?? 0;
  const totalInput = usage.inputTokens ?? 0;
  output.usage.input = Math.max(
    0,
    usage.inputTokenDetails.noCacheTokens ??
      totalInput - cacheRead - cacheWrite,
  );
  output.usage.output = usage.outputTokens ?? 0;
  output.usage.cacheRead = cacheRead;
  output.usage.cacheWrite = cacheWrite;
  output.usage.reasoning = usage.outputTokenDetails.reasoningTokens ?? 0;
  output.usage.totalTokens =
    output.usage.input +
    output.usage.cacheRead +
    output.usage.cacheWrite +
    output.usage.output;
  const raw = usage.raw;
  const inputDetails =
    raw && typeof raw === "object" && "input_tokens_details" in raw
      ? (raw as { input_tokens_details?: unknown }).input_tokens_details
      : undefined;
  const reports = output.usage as Usage & {
    cacheReadReported?: boolean;
    cacheWriteReported?: boolean;
  };
  if (
    cache?.cacheReadReported ||
    (inputDetails &&
      typeof inputDetails === "object" &&
      "cached_tokens" in inputDetails)
  ) {
    reports.cacheReadReported = true;
  }
  if (
    cache?.cacheWriteReported ||
    (inputDetails &&
      typeof inputDetails === "object" &&
      "cache_write_tokens" in inputDetails)
  ) {
    reports.cacheWriteReported = true;
  }
  calculateCost(model, output.usage);
}

type FinalStopReason = "stop" | "length" | "toolUse" | "error";

function stopReason(reason: string): FinalStopReason {
  if (reason === "length") return "length";
  if (reason === "tool-calls") return "toolUse";
  if (reason === "error") return "error";
  return "stop";
}

interface ToolBlockState {
  contentIndex: number;
  json: string;
  ended: boolean;
}

export function streamOpenAIResponsesWithAiSdk(
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const outputStream = createAssistantMessageEventStream();
  const output: AssistantMessage = {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: emptyUsage(),
    stopReason: "stop",
    timestamp: Date.now(),
  };

  void (async () => {
    try {
      outputStream.push({ type: "start", partial: output });
      const headers = requestHeaders(options?.headers);
      const openai = createOpenAI({
        baseURL: model.baseUrl,
        apiKey: options?.apiKey ?? "ollama",
        ...(headers ? { headers } : {}),
      });
      const tools = toAiSdkTools(context);
      const cacheRetention = options?.cacheRetention ?? "short";
      const cache = promptCacheMetadata(options);
      const explicitCache = cache?.policy === "explicit-30m";
      const openaiOptions = {
        forceReasoning: model.reasoning,
        ...(model.reasoning
          ? { reasoningEffort: options?.reasoning ?? "none" }
          : {}),
        ...(options?.sessionId && explicitCache
          ? {
              promptCacheKey: options.sessionId,
              promptCacheOptions: {
                mode: "explicit" as const,
                ttl: "30m" as const,
              },
            }
          : options?.sessionId && cacheRetention !== "none"
            ? {
                promptCacheKey: options.sessionId,
                promptCacheRetention:
                  cacheRetention === "long"
                    ? ("24h" as const)
                    : ("in_memory" as const),
              }
            : {}),
      } satisfies OpenAILanguageModelResponsesOptions;
      const messages = toModelMessages(context);
      if (context.systemPrompt && explicitCache) {
        messages.unshift({
          role: "system",
          content: context.systemPrompt,
          providerOptions: {
            openai: {
              promptCacheBreakpoint: { mode: "explicit" },
            },
          },
        });
      }
      const result = streamText({
        model: openai.responses(model.id),
        ...(context.systemPrompt && !explicitCache
          ? { system: context.systemPrompt }
          : {}),
        messages,
        ...(tools ? { tools } : {}),
        ...(options?.temperature === undefined
          ? {}
          : { temperature: options.temperature }),
        ...(options?.maxTokens === undefined
          ? {}
          : { maxOutputTokens: options.maxTokens }),
        ...(options?.maxRetries === undefined
          ? {}
          : { maxRetries: options.maxRetries }),
        ...(options?.timeoutMs === undefined
          ? {}
          : { timeout: options.timeoutMs }),
        ...(options?.signal ? { abortSignal: options.signal } : {}),
        providerOptions: { openai: openaiOptions },
      });

      const textBlocks = new Map<
        string,
        { contentIndex: number; ended: boolean }
      >();
      const thinkingBlocks = new Map<
        string,
        { contentIndex: number; ended: boolean }
      >();
      const toolBlocks = new Map<string, ToolBlockState>();
      let finalReason: FinalStopReason | undefined;

      const ensureTextBlock = (id: string) => {
        const existing = textBlocks.get(id);
        if (existing) return existing;
        const contentIndex = output.content.length;
        output.content.push({ type: "text", text: "" });
        const state = { contentIndex, ended: false };
        textBlocks.set(id, state);
        outputStream.push({
          type: "text_start",
          contentIndex,
          partial: output,
        });
        return state;
      };
      const ensureThinkingBlock = (id: string) => {
        const existing = thinkingBlocks.get(id);
        if (existing) return existing;
        const contentIndex = output.content.length;
        output.content.push({ type: "thinking", thinking: "" });
        const state = { contentIndex, ended: false };
        thinkingBlocks.set(id, state);
        outputStream.push({
          type: "thinking_start",
          contentIndex,
          partial: output,
        });
        return state;
      };
      const ensureToolBlock = (id: string, name: string) => {
        const existing = toolBlocks.get(id);
        if (existing) return existing;
        const contentIndex = output.content.length;
        output.content.push({
          type: "toolCall",
          id,
          name,
          arguments: {},
        });
        const state = { contentIndex, json: "", ended: false };
        toolBlocks.set(id, state);
        outputStream.push({
          type: "toolcall_start",
          contentIndex,
          partial: output,
        });
        return state;
      };

      for await (const part of result.fullStream) {
        if (part.type === "text-start") {
          ensureTextBlock(part.id);
        } else if (part.type === "text-delta") {
          const state = ensureTextBlock(part.id);
          const block = output.content[state.contentIndex];
          if (block?.type === "text") block.text += part.text;
          outputStream.push({
            type: "text_delta",
            contentIndex: state.contentIndex,
            delta: part.text,
            partial: output,
          });
        } else if (part.type === "text-end") {
          const state = ensureTextBlock(part.id);
          const block = output.content[state.contentIndex];
          if (!state.ended && block?.type === "text") {
            state.ended = true;
            outputStream.push({
              type: "text_end",
              contentIndex: state.contentIndex,
              content: block.text,
              partial: output,
            });
          }
        } else if (part.type === "reasoning-start") {
          ensureThinkingBlock(part.id);
        } else if (part.type === "reasoning-delta") {
          const state = ensureThinkingBlock(part.id);
          const block = output.content[state.contentIndex];
          if (block?.type === "thinking") block.thinking += part.text;
          outputStream.push({
            type: "thinking_delta",
            contentIndex: state.contentIndex,
            delta: part.text,
            partial: output,
          });
        } else if (part.type === "reasoning-end") {
          const state = ensureThinkingBlock(part.id);
          const block = output.content[state.contentIndex];
          if (!state.ended && block?.type === "thinking") {
            state.ended = true;
            outputStream.push({
              type: "thinking_end",
              contentIndex: state.contentIndex,
              content: block.thinking,
              partial: output,
            });
          }
        } else if (part.type === "tool-input-start") {
          ensureToolBlock(part.id, part.toolName);
        } else if (part.type === "tool-input-delta") {
          const state = toolBlocks.get(part.id);
          if (!state) continue;
          state.json += part.delta;
          outputStream.push({
            type: "toolcall_delta",
            contentIndex: state.contentIndex,
            delta: part.delta,
            partial: output,
          });
        } else if (part.type === "tool-call") {
          const state = ensureToolBlock(part.toolCallId, part.toolName);
          const block = output.content[state.contentIndex];
          if (block?.type !== "toolCall") continue;
          const argumentsValue =
            part.input &&
            typeof part.input === "object" &&
            !Array.isArray(part.input)
              ? (part.input as Record<string, unknown>)
              : { input: part.input };
          block.arguments = argumentsValue;
          if (!state.json) {
            state.json = JSON.stringify(argumentsValue);
            outputStream.push({
              type: "toolcall_delta",
              contentIndex: state.contentIndex,
              delta: state.json,
              partial: output,
            });
          }
          if (!state.ended) {
            state.ended = true;
            outputStream.push({
              type: "toolcall_end",
              contentIndex: state.contentIndex,
              toolCall: block as ToolCall,
              partial: output,
            });
          }
        } else if (part.type === "finish-step") {
          output.responseId = part.response.id;
          output.responseModel = part.response.modelId;
          applyUsage(model, output, part.usage, cache);
        } else if (part.type === "finish") {
          finalReason = stopReason(part.finishReason);
          applyUsage(model, output, part.totalUsage, cache);
        } else if (part.type === "abort") {
          throw new Error(part.reason ?? "The model request was aborted.");
        } else if (part.type === "error") {
          throw part.error;
        }
      }

      for (const state of textBlocks.values()) {
        const block = output.content[state.contentIndex];
        if (!state.ended && block?.type === "text") {
          state.ended = true;
          outputStream.push({
            type: "text_end",
            contentIndex: state.contentIndex,
            content: block.text,
            partial: output,
          });
        }
      }
      for (const state of thinkingBlocks.values()) {
        const block = output.content[state.contentIndex];
        if (!state.ended && block?.type === "thinking") {
          state.ended = true;
          outputStream.push({
            type: "thinking_end",
            contentIndex: state.contentIndex,
            content: block.thinking,
            partial: output,
          });
        }
      }

      const hasUsableContent = output.content.some(
        (part) =>
          part.type === "toolCall" ||
          (part.type === "text" && part.text.trim().length > 0),
      );
      if (!hasUsableContent) {
        throw new Error("The model returned no assistant content.");
      }
      output.stopReason =
        finalReason ??
        (output.content.some((part) => part.type === "toolCall")
          ? "toolUse"
          : "stop");
      if (output.stopReason === "error") {
        throw new Error("The model reported an unsuccessful finish reason.");
      }
      outputStream.push({
        type: "done",
        reason: output.stopReason,
        message: output,
      });
      outputStream.end();
    } catch (error) {
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = errorMessage(error);
      outputStream.push({
        type: "error",
        reason: output.stopReason,
        error: output,
      });
      outputStream.end();
    }
  })();

  return outputStream;
}

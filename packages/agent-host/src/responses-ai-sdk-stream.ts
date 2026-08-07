import { createOpenAI } from "@ai-sdk/openai";
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
): void {
  output.usage.input = usage.inputTokens ?? 0;
  output.usage.output = usage.outputTokens ?? 0;
  output.usage.cacheRead = usage.inputTokenDetails.cacheReadTokens ?? 0;
  output.usage.cacheWrite = usage.inputTokenDetails.cacheWriteTokens ?? 0;
  output.usage.reasoning = usage.outputTokenDetails.reasoningTokens ?? 0;
  output.usage.totalTokens =
    usage.totalTokens ??
    output.usage.input +
      output.usage.output +
      output.usage.cacheRead +
      output.usage.cacheWrite;
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
      const result = streamText({
        model: openai.responses(model.id),
        ...(context.systemPrompt ? { system: context.systemPrompt } : {}),
        messages: toModelMessages(context),
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
          applyUsage(model, output, part.usage);
        } else if (part.type === "finish") {
          finalReason = stopReason(part.finishReason);
          applyUsage(model, output, part.totalUsage);
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

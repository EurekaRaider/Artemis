import { estimateTextTokens } from "@artemis/protocol";
import type {
  Api,
  Context,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import {
  estimateTokens,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";

export function attachmentImageTokens(
  model: { provider: string; id: string },
  width = 2048,
  height = 2048,
): number {
  if (/anthropic|claude/i.test(`${model.provider}/${model.id}`))
    return Math.ceil((width * height) / 750) + 256;
  if (/openai|gpt|codex/i.test(`${model.provider}/${model.id}`))
    return (
      Math.ceil(Math.ceil(width / 32) * Math.ceil(height / 32) * 2.5) + 256
    );
  return 11000;
}
export function inputTokenLimit(
  model: {
    contextWindow: number;
    maxTokens: number;
  },
  requestedOutput?: number,
): number {
  const output = Math.min(
    model.maxTokens,
    requestedOutput ?? Math.max(1024, Math.floor(model.contextWindow * 0.1)),
  );
  return Math.max(
    0,
    model.contextWindow -
      output -
      Math.max(512, Math.ceil(model.contextWindow * 0.05)),
  );
}
export function estimateRequestTokens(
  model: Model<Api>,
  context: {
    systemPrompt?: string;
    tools?: readonly unknown[];
    messages: readonly unknown[];
  },
): number {
  let tokens =
    estimateTextTokens(context.systemPrompt ?? "") +
    estimateTextTokens(JSON.stringify(context.tools ?? []));
  for (const message of context.messages) {
    tokens += 16;
    const content =
      message && typeof message === "object"
        ? (message as { content?: unknown }).content
        : undefined;
    if (typeof content === "string") {
      tokens += estimateTextTokens(content);
      continue;
    }
    if (!Array.isArray(content)) {
      tokens += estimateTokens(message as Parameters<typeof estimateTokens>[0]);
      continue;
    }
    for (const block of content) {
      if (block?.type === "image") tokens += attachmentImageTokens(model);
      else if (block?.type === "text") tokens += estimateTextTokens(block.text);
      else if (block?.type === "thinking")
        tokens += estimateTextTokens(block.thinking);
      else tokens += estimateTextTokens(JSON.stringify(block) ?? "");
    }
  }
  return tokens;
}
export class ContextBudgetExceededError extends Error {
  readonly code = "ARTEMIS_CONTEXT_BUDGET_EXCEEDED";

  constructor(
    readonly estimatedTokens: number,
    readonly inputLimit: number,
  ) {
    // Pi's stream boundary transports error text, not custom Error properties.
    // The standard overflow marker connects this typed error to Pi's bounded recovery.
    super(
      `context_length_exceeded: Local context estimate (${estimatedTokens} tokens) exceeds the input budget (${inputLimit} tokens) before sending. Output and safety reserves are excluded from this budget. Compact this task or select a larger-context model. Attachment originals are preserved.`,
    );
    this.name = "ContextBudgetExceededError";
  }
}
/** Only discard replaceable attachment image payloads, never ordinary conversation text. */
export function fitAttachmentContext(
  model: Model<Api>,
  context: Context,
  requestedOutput?: number,
): Context {
  context = {
    ...context,
    messages: context.messages.map((message) => {
      if (typeof message.content === "string") return message;
      const content = message.content.flatMap((block) => {
        const id = (block as { attachmentId?: string }).attachmentId;
        return block.type === "image" && id
          ? [
              { type: "text" as const, text: `[artemis-attachment id=${id}]` },
              block,
            ]
          : [block];
      });
      return { ...message, content };
    }),
  } as Context;
  if (
    estimateRequestTokens(model, context) <=
    inputTokenLimit(model, requestedOutput)
  )
    return context;
  const messages = context.messages.map((message) => ({
    ...message,
    content:
      typeof message.content === "string"
        ? message.content
        : [...message.content],
  }));
  const result = { ...context, messages } as Context;
  for (const message of messages) {
    if (typeof message.content === "string") continue;
    for (let i = 1; i < message.content.length; i++) {
      const previous = message.content[i - 1],
        block = message.content[i];
      if (
        block?.type === "image" &&
        previous?.type === "text" &&
        /^\[artemis-attachment id=[a-zA-Z0-9-]+(?: |\])/u.test(previous.text)
      ) {
        message.content.splice(i, 1, {
          type: "text",
          text: "[Image payload omitted from this request to fit context. Original remains available through attachment_read.]",
        });
        if (
          estimateRequestTokens(model, result) <=
          inputTokenLimit(model, requestedOutput)
        )
          return result;
      }
    }
  }
  throw new ContextBudgetExceededError(
    estimateRequestTokens(model, result),
    inputTokenLimit(model, requestedOutput),
  );
}
export function withAttachmentContextBudget(
  runtime: ModelRuntime,
): ModelRuntime {
  return new Proxy(runtime, {
    get(target, property) {
      if (property === "streamSimple")
        return (
          model: Model<Api>,
          context: Context,
          options?: SimpleStreamOptions,
        ) => {
          const maxTokens = Math.min(
            model.maxTokens,
            options?.maxTokens ??
              Math.max(1024, Math.floor(model.contextWindow * 0.1)),
          );
          return target.streamSimple(
            model,
            fitAttachmentContext(model, context, maxTokens),
            { ...options, maxTokens },
          );
        };
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

import { Buffer } from "node:buffer";
import type {
  Api,
  Context,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

// A UTF-8 byte ceiling avoids chars/4 undercounting Chinese, code and arbitrary data.
export function attachmentTextTokens(value: string): number {
  return Buffer.byteLength(value, "utf8");
}
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
    attachmentTextTokens(context.systemPrompt ?? "") +
    attachmentTextTokens(JSON.stringify(context.tools ?? []));
  for (const message of context.messages) {
    tokens += 16;
    const content =
      message && typeof message === "object"
        ? (message as { content?: unknown }).content
        : undefined;
    if (typeof content === "string") {
      tokens += attachmentTextTokens(content);
      continue;
    }
    if (!Array.isArray(content)) {
      tokens += attachmentTextTokens(JSON.stringify(message) ?? "");
      continue;
    }
    for (const block of content) {
      if (block?.type === "image") tokens += attachmentImageTokens(model);
      else tokens += attachmentTextTokens(JSON.stringify(block) ?? "");
    }
  }
  return tokens;
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
  throw new Error(
    "Context budget exceeded before sending. Compact this task, shorten the request, or select a larger-context model. Attachment originals are preserved.",
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

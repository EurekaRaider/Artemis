import { beforeEach, describe, expect, it, vi } from "vitest";
import { Type } from "@sinclair/typebox";
import type { Api, Context, Model } from "@earendil-works/pi-ai";

const sdk = vi.hoisted(() => {
  const languageModel = { specificationVersion: "v3" };
  const responses = vi.fn(() => languageModel);
  return {
    languageModel,
    responses,
    createOpenAI: vi.fn(() => ({ responses })),
    streamText: vi.fn(),
  };
});

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: sdk.createOpenAI,
}));

vi.mock("ai", async (importOriginal) => {
  const original = await importOriginal<typeof import("ai")>();
  return {
    ...original,
    streamText: sdk.streamText,
  };
});

import { streamOpenAIResponsesWithAiSdk } from "../src/responses-ai-sdk-stream.js";

const model = {
  id: "muse-spark-1.1",
  name: "Muse Spark 1.1",
  api: "openai-responses",
  provider: "pep",
  baseUrl: "http://127.0.0.1:11434/v1",
  reasoning: false,
  input: ["text"],
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  },
  contextWindow: 128_000,
  maxTokens: 32_000,
} as Model<Api>;

function fullStream(parts: unknown[]) {
  return {
    async *[Symbol.asyncIterator]() {
      yield* parts;
    },
  };
}

const usage = {
  inputTokens: 7,
  inputTokenDetails: {
    noCacheTokens: 7,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  },
  outputTokens: 4,
  outputTokenDetails: {
    textTokens: 4,
    reasoningTokens: 0,
  },
  totalTokens: 11,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("streamOpenAIResponsesWithAiSdk", () => {
  it("uses OpenCode's AI SDK Responses path and maps text to Pi events", async () => {
    sdk.streamText.mockReturnValue({
      fullStream: fullStream([
        { type: "text-start", id: "text-1" },
        { type: "text-delta", id: "text-1", text: "Hello from PEP." },
        { type: "text-end", id: "text-1" },
        {
          type: "finish",
          finishReason: "stop",
          rawFinishReason: "completed",
          totalUsage: usage,
        },
      ]),
    });
    const context: Context = {
      systemPrompt: "You are concise.",
      messages: [
        {
          role: "user",
          content: "Who are you?",
          timestamp: 1,
        },
      ],
    };

    const stream = streamOpenAIResponsesWithAiSdk(model, context, {
      apiKey: "local-proxy",
      maxTokens: 1_024,
    });
    const events = await Array.fromAsync(stream);

    expect(sdk.createOpenAI).toHaveBeenCalledWith({
      apiKey: "local-proxy",
      baseURL: "http://127.0.0.1:11434/v1",
    });
    expect(sdk.responses).toHaveBeenCalledWith("muse-spark-1.1");
    expect(sdk.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: sdk.languageModel,
        system: "You are concise.",
        messages: [{ role: "user", content: "Who are you?" }],
        maxOutputTokens: 1_024,
      }),
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text_start", contentIndex: 0 }),
        expect.objectContaining({
          type: "text_delta",
          contentIndex: 0,
          delta: "Hello from PEP.",
        }),
        expect.objectContaining({
          type: "text_end",
          contentIndex: 0,
          content: "Hello from PEP.",
        }),
        expect.objectContaining({
          type: "done",
          reason: "stop",
          message: expect.objectContaining({
            content: [{ type: "text", text: "Hello from PEP." }],
            stopReason: "stop",
            usage: expect.objectContaining({
              input: 7,
              output: 4,
              totalTokens: 11,
            }),
          }),
        }),
      ]),
    );
  });

  it("maps AI SDK tool calls without executing a second agent loop", async () => {
    sdk.streamText.mockReturnValue({
      fullStream: fullStream([
        { type: "tool-input-start", id: "call-1", toolName: "read" },
        {
          type: "tool-input-delta",
          id: "call-1",
          delta: '{"path":"README.md"}',
        },
        { type: "tool-input-end", id: "call-1" },
        {
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "read",
          input: { path: "README.md" },
        },
        {
          type: "finish",
          finishReason: "tool-calls",
          rawFinishReason: "tool_calls",
          totalUsage: usage,
        },
      ]),
    });
    const context: Context = {
      messages: [
        {
          role: "user",
          content: "Read the README.",
          timestamp: 1,
        },
      ],
      tools: [
        {
          name: "read",
          description: "Read a workspace file.",
          parameters: Type.Object({ path: Type.String() }),
        },
      ],
    };

    const events = await Array.fromAsync(
      streamOpenAIResponsesWithAiSdk(model, context, {
        apiKey: "local-proxy",
      }),
    );
    const request = sdk.streamText.mock.calls[0]![0];

    expect(request.tools.read).not.toHaveProperty("execute");
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "toolcall_start", contentIndex: 0 }),
        expect.objectContaining({
          type: "toolcall_delta",
          contentIndex: 0,
          delta: '{"path":"README.md"}',
        }),
        expect.objectContaining({
          type: "toolcall_end",
          contentIndex: 0,
          toolCall: {
            type: "toolCall",
            id: "call-1",
            name: "read",
            arguments: { path: "README.md" },
          },
        }),
        expect.objectContaining({ type: "done", reason: "toolUse" }),
      ]),
    );
  });
});

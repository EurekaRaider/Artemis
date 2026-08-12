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
const reasoningModel = { ...model, reasoning: true } as Model<Api>;

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
  it.each([
    {
      name: "off with short retention",
      options: { sessionId: "session-1", cacheRetention: "short" as const },
      expected: {
        forceReasoning: true,
        reasoningEffort: "none",
        promptCacheKey: "session-1",
        promptCacheRetention: "in_memory",
      },
    },
    {
      name: "low with long retention",
      options: {
        reasoning: "low" as const,
        sessionId: "session-2",
        cacheRetention: "long" as const,
      },
      expected: {
        forceReasoning: true,
        reasoningEffort: "low",
        promptCacheKey: "session-2",
        promptCacheRetention: "24h",
      },
    },
    {
      name: "medium with caching disabled",
      options: {
        reasoning: "medium" as const,
        sessionId: "session-3",
        cacheRetention: "none" as const,
      },
      expected: {
        forceReasoning: true,
        reasoningEffort: "medium",
      },
    },
  ])(
    "forwards reasoning and session cache options for $name",
    async ({ options, expected }) => {
      sdk.streamText.mockReturnValue({
        fullStream: fullStream([
          {
            type: "finish",
            finishReason: "stop",
            rawFinishReason: "completed",
            totalUsage: usage,
          },
        ]),
      });

      await Array.fromAsync(
        streamOpenAIResponsesWithAiSdk(
          reasoningModel,
          { messages: [{ role: "user", content: "Hello", timestamp: 1 }] },
          options,
        ),
      );

      const request = sdk.streamText.mock.calls[0]![0];
      expect(request.providerOptions).toEqual({ openai: expected });
      expect(request.providerOptions.openai).not.toHaveProperty(
        "previousResponseId",
      );
    },
  );

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

  it("splits total input into uncached, cache read, and cache write tokens", async () => {
    sdk.streamText.mockReturnValue({
      fullStream: fullStream([
        { type: "text-start", id: "text-cache" },
        { type: "text-delta", id: "text-cache", text: "OK" },
        { type: "text-end", id: "text-cache" },
        {
          type: "finish",
          finishReason: "stop",
          rawFinishReason: "completed",
          totalUsage: {
            inputTokens: 1_000,
            inputTokenDetails: {
              noCacheTokens: 300,
              cacheReadTokens: 500,
              cacheWriteTokens: 200,
            },
            outputTokens: 100,
            outputTokenDetails: { textTokens: 100, reasoningTokens: 0 },
            totalTokens: 1_100,
            raw: {
              input_tokens: 1_000,
              input_tokens_details: {
                cached_tokens: 500,
                cache_write_tokens: 200,
              },
              output_tokens: 100,
            },
          },
        },
      ]),
    });

    const events = await Array.fromAsync(
      streamOpenAIResponsesWithAiSdk(model, {
        messages: [{ role: "user", content: "Hello", timestamp: 1 }],
      }),
    );
    const done = events.find((event) => event.type === "done");

    expect(done?.message.usage).toMatchObject({
      input: 300,
      cacheRead: 500,
      cacheWrite: 200,
      output: 100,
      totalTokens: 1_100,
      cacheReadReported: true,
      cacheWriteReported: true,
    });
  });

  it("uses an AI SDK system breakpoint for GPT-5.6 explicit caching", async () => {
    sdk.streamText.mockReturnValue({
      fullStream: fullStream([
        {
          type: "finish",
          finishReason: "stop",
          rawFinishReason: "completed",
          totalUsage: usage,
        },
      ]),
    });
    const cache = {
      policy: "explicit-30m",
      reason: "official-gpt-5.6",
      cacheKey: "stable-cache-key",
      cacheKeyFingerprint: "stable-cache-key".slice(0, 16),
      systemPromptFingerprint: "0123456789abcdef",
      toolSchemaFingerprint: "fedcba9876543210",
      stablePrefixTokens: 1_024,
      cacheKeyRequestsPerMinute: 1,
      cacheKeyRateWarning: false,
      cacheReadReported: true,
      cacheWriteReported: true,
    } as const;

    await Array.fromAsync(
      streamOpenAIResponsesWithAiSdk(
        reasoningModel,
        {
          systemPrompt: "Stable system prompt.",
          messages: [{ role: "user", content: "Dynamic", timestamp: 1 }],
        },
        {
          sessionId: "stable-cache-key",
          cacheRetention: "none",
          metadata: { artemisPromptCache: cache },
        },
      ),
    );

    const request = sdk.streamText.mock.calls[0]![0];
    expect(request).not.toHaveProperty("system");
    expect(request.messages[0]).toEqual({
      role: "system",
      content: "Stable system prompt.",
      providerOptions: {
        openai: { promptCacheBreakpoint: { mode: "explicit" } },
      },
    });
    expect(request.providerOptions.openai).toMatchObject({
      promptCacheKey: "stable-cache-key",
      promptCacheOptions: { mode: "explicit", ttl: "30m" },
    });
    expect(request.providerOptions.openai).not.toHaveProperty(
      "promptCacheRetention",
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
      streamOpenAIResponsesWithAiSdk(reasoningModel, context, {
        apiKey: "local-proxy",
        reasoning: "low",
        sessionId: "tool-session",
        cacheRetention: "long",
      }),
    );
    const request = sdk.streamText.mock.calls[0]![0];

    expect(request.tools.read).not.toHaveProperty("execute");
    expect(request.providerOptions.openai).toMatchObject({
      reasoningEffort: "low",
      promptCacheKey: "tool-session",
      promptCacheRetention: "24h",
    });
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

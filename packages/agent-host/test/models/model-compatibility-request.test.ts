import { expect, it, vi } from "vitest";
import { stream } from "@earendil-works/pi-ai/api/openai-completions";
import {
  normalizeContext,
  type Model,
  type Context,
} from "@earendil-works/pi-ai";
import { toPiProviderConfig } from "../../src/models/provider-configuration.js";

it("uses configured compatibility in Pi's actual Completions request", async () => {
  const config = toPiProviderConfig(
    {
      id: "compat-test",
      name: "Compat",
      baseUrl: "https://compat.invalid/v1",
      models: [
        {
          id: "test",
          name: "Test",
          reasoning: true,
          input: ["text"],
          contextWindow: 128000,
          maxTokens: 1024,
          compat: {
            requiresNonNullAssistantContent: true,
            requiresToolsWithToolHistory: true,
            supportsDeveloperRole: false,
            supportsUsageInStreaming: false,
            maxTokensField: "max_tokens",
            promptCacheKeyMode: "disabled",
            supportsLongCacheRetention: false,
          },
        },
      ],
    },
    true,
  );
  const model = {
    ...config.models[0],
    api: config.api,
    provider: "compat-test",
    baseUrl: config.baseUrl,
  } as Model<"openai-completions">;
  const usage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  const context: Context = {
    systemPrompt: "Instruction",
    messages: [
      { role: "user", content: "Use tool", timestamp: 1 },
      {
        role: "assistant",
        api: model.api,
        provider: model.provider,
        model: model.id,
        content: [
          { type: "toolCall", id: "call", name: "read", arguments: {} },
        ],
        stopReason: "toolUse",
        usage,
        timestamp: 2,
      },
      {
        role: "toolResult",
        toolCallId: "call",
        toolName: "read",
        content: [{ type: "text", text: "result" }],
        isError: false,
        timestamp: 3,
      },
    ],
  };
  const fetch = vi.fn(
    async () =>
      new Response(
        'data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        { headers: { "Content-Type": "text/event-stream" } },
      ),
  );
  const events = await Array.fromAsync(
    stream(model, normalizeContext(context), {
      apiKey: "test-only",
      fetch,
      maxRetries: 0,
      maxTokens: 100,
      sessionId: "test",
      cacheRetention: "long",
    }),
  );
  expect(events.at(-1)?.type).toBe("done");
  expect(fetch).toHaveBeenCalledOnce();
  const body = JSON.parse(
    (fetch.mock.calls[0] as unknown as [unknown, RequestInit])[1]
      .body as string,
  );
  expect(body).toMatchObject({ max_tokens: 100, tools: [] });
  expect(body.messages[0].role).toBe("system");
  expect(
    body.messages.find(
      (message: { role: string }) => message.role === "assistant",
    ).content,
  ).toBe("");
  for (const field of [
    "max_completion_tokens",
    "stream_options",
    "prompt_cache_key",
    "prompt_cache_retention",
  ])
    expect(body).not.toHaveProperty(field);
});

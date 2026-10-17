import { expect, it } from "vitest";
import { kimiCodingProvider } from "@earendil-works/pi-ai/providers/kimi-coding";
import { normalizeContext } from "@earendil-works/pi-ai";
import { compatibleProviderBaseUrl } from "../../src/models/provider-configuration.js";

it.each(["https://api.kimi.com/coding", "https://api.kimi.com/coding/"])(
  "migrates only known official legacy Kimi endpoints: %s",
  (baseUrl) => {
    expect(compatibleProviderBaseUrl({ id: "kimi-coding", baseUrl })).toBe(
      "https://api.kimi.com/coding/v1",
    );
  },
);
it.each([
  { id: "custom", baseUrl: "https://api.kimi.com/coding" },
  { id: "kimi-coding", baseUrl: "https://proxy.example/coding" },
  { id: "kimi-coding", baseUrl: "https://api.kimi.com/coding/v1" },
  { id: "kimi-coding", baseUrl: "https://api.kimi.com/coding?region=custom" },
])("preserves explicit provider routes: %j", (provider) => {
  expect(compatibleProviderBaseUrl(provider)).toBe(provider.baseUrl);
});

it("uses the native Kimi Chat Completions wire and preserves tools added mid-conversation", async () => {
  const provider = kimiCodingProvider();
  const model = provider.getModels().find((item) => item.id === "k3")!;
  expect(model.api).toBe("openai-completions");
  expect(model.baseUrl).toBe("https://api.kimi.com/coding/v1");
  let payload: Record<string, unknown> | undefined;
  let url = "";
  const fetch: typeof globalThis.fetch = async (input, init) => {
    url = String(input);
    payload = JSON.parse(String(init?.body));
    return new Response(
      'data: {"choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":null}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      { headers: { "content-type": "text/event-stream" } },
    );
  };
  const context = normalizeContext({
    messages: [{ role: "user", content: "Hello", timestamp: 1 }],
  });
  context.messages.push({
    role: "system",
    content: "",
    toolsAdded: [
      {
        name: "lookup",
        description: "Lookup",
        parameters: { type: "object", properties: {} },
      },
    ],
    timestamp: 2,
  });
  const result = await provider
    .streamSimple(model, context, {
      apiKey: "synthetic-only",
      fetch,
      maxRetries: 0,
    })
    .result();
  expect(result.stopReason, result.errorMessage).toBe("stop");
  expect(url).toBe("https://api.kimi.com/coding/v1/chat/completions");
  expect(JSON.stringify(payload)).toContain("lookup");
  expect(payload).not.toHaveProperty("tools");
  expect(payload!.messages).toEqual([
    { role: "user", content: "Hello" },
    expect.objectContaining({
      role: "system",
      tools: expect.arrayContaining([
        expect.objectContaining({
          function: expect.objectContaining({ name: "lookup" }),
        }),
      ]),
    }),
  ]);
});

import { expect, it } from "vitest";
import {
  isRetryableAssistantError,
  normalizeContext,
  type AssistantMessage,
  type Model,
} from "@earendil-works/pi-ai";
import { streamSimple as responses } from "@earendil-works/pi-ai/api/openai-responses";
import { streamSimple as completions } from "@earendil-works/pi-ai/api/openai-completions";

const model: Model<"openai-responses"> = {
  id: "fixture",
  name: "Fixture",
  provider: "openai",
  api: "openai-responses",
  baseUrl: "https://example.invalid/v1",
  reasoning: false,
  input: ["text"],
  contextWindow: 32000,
  maxTokens: 1000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  compat: {
    supportsMidConvoSystemMessages: true,
    supportsAdditionalTools: true,
  },
};
const assistant: AssistantMessage = {
  role: "assistant",
  api: model.api,
  provider: model.provider,
  model: model.id,
  content: [],
  stopReason: "error",
  timestamp: 1,
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
};

it.each([
  ["upstream_error: Upstream request failed", true],
  ["upstream_stream_read_error", true],
  ["Upstream HTTP/2 stream failed", true],
  ["stream disconnected before completion", true],
  ["Invalid request req_011CU503xyz", false],
  ["Invalid input: 5242880 bytes", false],
  ["401 authentication failed", false],
  ["insufficient_quota", false],
] as const)(
  "classifies retry eligibility without replaying deterministic failures: %s",
  (errorMessage, retryable) => {
    expect(isRetryableAssistantError({ ...assistant, errorMessage })).toBe(
      retryable,
    );
  },
);

it("keeps the Responses request prefix stable after removing and then loading tools", async () => {
  const tool = (name: string) => ({
    name,
    description: name,
    parameters: { type: "object", properties: {} },
  });
  const context = normalizeContext({
    systemPrompt: "Use the available tools.",
    tools: [tool("initial")],
    messages: [{ role: "user", content: "Start", timestamp: 1 }],
  });
  context.messages.push({
    role: "system",
    content: "",
    toolsRemoved: ["initial"],
    timestamp: 2,
  });
  const payloads: any[] = [];
  const capture = async () => {
    await responses(model, context, {
      apiKey: "synthetic-only",
      maxRetries: 0,
      fetch: async (_url, init) => {
        payloads.push(JSON.parse(String(init?.body)));
        return new Response(
          'data: {"type":"response.completed","response":{"id":"fixture","status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":0,"total_tokens":1}}}\n\n',
          {
            headers: { "content-type": "text/event-stream" },
          },
        );
      },
    }).result();
  };
  await capture();
  context.messages.push({
    role: "system",
    content: "",
    toolsAdded: [tool("later")],
    timestamp: 3,
  });
  await capture();
  expect(payloads).toHaveLength(2);
  expect(payloads[0].tools ?? []).toEqual([]);
  expect(payloads[1].tools ?? []).toEqual([]);
  expect(payloads[1].input.slice(0, payloads[0].input.length)).toEqual(
    payloads[0].input,
  );
  expect(
    payloads[0].input.some((item: any) => item.type === "additional_tools"),
  ).toBe(true);
  expect(JSON.stringify(payloads[1].input)).toContain("later");
});

it("normalizes whitespace-only tool results before sending Chat Completions", async () => {
  let payload: any;
  const result = await completions(
    { ...model, api: "openai-completions", compat: {} },
    {
      messages: [
        {
          ...assistant,
          api: "openai-completions",
          stopReason: "toolUse",
          content: [
            { type: "toolCall", id: "call", name: "bash", arguments: {} },
          ],
        },
        {
          role: "toolResult",
          toolCallId: "call",
          toolName: "bash",
          content: [{ type: "text", text: "\r\n  " }],
          isError: false,
          timestamp: 2,
        },
      ],
    },
    {
      apiKey: "synthetic-only",
      maxRetries: 0,
      fetch: async (_url, init) => {
        payload = JSON.parse(String(init?.body));
        return new Response(
          'data: {"choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
          { headers: { "content-type": "text/event-stream" } },
        );
      },
    },
  ).result();
  expect(result.stopReason, result.errorMessage).toBe("stop");
  const output = payload.messages.find(
    (message: any) => message.role === "tool",
  );
  expect(output.content.trim()).not.toBe("");
});

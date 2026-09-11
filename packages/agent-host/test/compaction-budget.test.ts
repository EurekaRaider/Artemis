import { describe, expect, it, vi } from "vitest";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Context,
  type Model,
  type Api,
} from "@earendil-works/pi-ai";
import { withCompactionBudget } from "../src/compaction-budget.js";
import {
  estimateRequestTokens,
  inputTokenLimit,
  withAttachmentContextBudget,
} from "../src/attachment-context.js";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

const model: Model<Api> = {
  id: "test",
  name: "test",
  provider: "test",
  api: "openai-completions",
  baseUrl: "http://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8000,
  maxTokens: 1000,
};
function response(
  text = "Short summary",
  stopReason: "stop" | "error" = "stop",
) {
  const stream = createAssistantMessageEventStream();
  const message: AssistantMessage = {
    role: "assistant",
    content: [{ type: "text", text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    stopReason,
    timestamp: Date.now(),
    usage: {
      input: 10,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 15,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    ...(stopReason === "error" ? { errorMessage: text } : {}),
  };
  if (stopReason === "error")
    stream.push({ type: "error", reason: "error", error: message });
  else stream.push({ type: "done", reason: "stop", message });
  return stream;
}
function request(): Context {
  return {
    systemPrompt: "Summarize the conversation.",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `<conversation>\n${"[User]: Keep the decision and completed tool result.\n".repeat(2000)}</conversation>\n\nAdditional focus: preserve file paths and pending work.`,
          },
        ],
        timestamp: 1,
      },
    ],
  };
}
describe("bounded Pi compaction", () => {
  it("shrinks chunks when the provider reports more tokens than the local estimate", async () => {
    const provider = vi.fn((_model, context) =>
      JSON.stringify(context).length > 4000
        ? response("context_length_exceeded", "error")
        : response(),
    );
    const result = await (
      await withCompactionBudget(provider)(model, request())
    ).result();
    expect(result.stopReason).toBe("stop");
    expect(provider.mock.calls.length).toBeGreaterThan(3);
  });
  it("summarizes oversized history in bounded requests, preserving the original focus and history", async () => {
    const contexts: Context[] = [];
    const provider = vi.fn((_model, context, options) => {
      expect(estimateRequestTokens(model, context)).toBeLessThanOrEqual(
        inputTokenLimit(model, options?.maxTokens),
      );
      contexts.push(context);
      return response();
    });
    const runtime = withAttachmentContextBudget({
      streamSimple: provider,
    } as unknown as ModelRuntime);
    const context = request();
    const before = JSON.stringify(context);
    const result = await (
      await withCompactionBudget(runtime.streamSimple)(model, context, {
        maxTokens: 800,
      })
    ).result();
    expect(result.stopReason).toBe("stop");
    expect(contexts.length).toBeGreaterThan(2);
    expect(JSON.stringify(contexts.at(-1))).toContain(
      "Additional focus: preserve file paths and pending work.",
    );
    expect(result.usage.input).toBe(contexts.length * 10);
    expect(JSON.stringify(context)).toBe(before);
  });
  it("does not commit partial summaries after failure or continue after cancellation", async () => {
    const controller = new AbortController();
    const provider = vi.fn(() => {
      controller.abort();
      return response();
    });
    await expect(
      withCompactionBudget(provider)(model, request(), {
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(provider).toHaveBeenCalledOnce();
  });
  it("does not retry authentication failures as compaction overflows", async () => {
    const provider = vi.fn(() =>
      response("401 authentication failed", "error"),
    );
    const result = await (
      await withCompactionBudget(provider)(model, request())
    ).result();
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toContain("401");
    expect(provider).toHaveBeenCalledOnce();
  });
  it("preserves Pi's transient provider retry policy", async () => {
    const { retryAssistantCall } = await import("@earendil-works/pi-ai");
    const provider = vi
      .fn()
      .mockImplementationOnce(() => response("429 rate limit", "error"))
      .mockImplementation(() => response());
    const compact = withCompactionBudget(provider);
    const result = await retryAssistantCall(
      async () =>
        (
          await compact(model, {
            messages: [
              {
                role: "user",
                content: "Summarize this short input.",
                timestamp: 1,
              },
            ],
          })
        ).result(),
      { enabled: true, maxRetries: 1, baseDelayMs: 0 },
    );
    expect(result.stopReason).toBe("stop");
    expect(provider).toHaveBeenCalledTimes(2);
  });
});

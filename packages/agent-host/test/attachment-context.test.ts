import { describe, it, expect, vi } from "vitest";
import type { Api, Model, Context } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  fitAttachmentContext,
  estimateRequestTokens,
  inputTokenLimit,
  withAttachmentContextBudget,
} from "../src/attachment-context.js";
const model = {
  provider: "openai",
  id: "gpt-test",
  contextWindow: 256000,
  maxTokens: 16384,
  input: ["text", "image"],
} as Model<Api>;
const image = { type: "image" as const, data: "YWJj", mimeType: "image/png" };
describe("attachment request boundary", () => {
  it("sends 20 images in a large window and retains references in a small window without editing history", () => {
    const content = Array.from({ length: 20 }, (_, i) => [
      { type: "text" as const, text: `[artemis-attachment id=image-${i}]` },
      image,
    ]).flat();
    const context = {
      messages: [{ role: "user", content, timestamp: 1 }],
    } as Context;
    expect(
      fitAttachmentContext(model, context).messages[0]!.content,
    ).toHaveLength(40);
    const small = { ...model, contextWindow: 32000 };
    const fitted = fitAttachmentContext(small, context);
    expect(estimateRequestTokens(small, fitted)).toBeLessThanOrEqual(
      inputTokenLimit(small),
    );
    expect(JSON.stringify(fitted)).toContain("Original remains available");
    expect(context.messages[0]!.content).toHaveLength(40);
  });
  it("reserves the output ceiling actually passed to the provider", () => {
    const streamSimple = vi.fn();
    const runtime = withAttachmentContextBudget({
      streamSimple,
    } as unknown as ModelRuntime);
    const small = { ...model, contextWindow: 32000 };
    runtime.streamSimple(small, { messages: [] });
    expect(streamSimple.mock.calls[0]?.[2]).toMatchObject({ maxTokens: 3200 });
    streamSimple.mockClear();
    expect(() =>
      runtime.streamSimple(
        small,
        {
          messages: [
            { role: "user", content: "x".repeat(80000), timestamp: 1 },
          ],
        },
        { maxTokens: 16000 },
      ),
    ).toThrow(/before sending/);
    expect(streamSimple).not.toHaveBeenCalled();
  });
  it("never truncates a large user request and stops before provider invocation", () => {
    const streamSimple = vi.fn();
    const runtime = withAttachmentContextBudget({
      streamSimple,
    } as unknown as ModelRuntime);
    expect(() =>
      runtime.streamSimple(
        { ...model, contextWindow: 2048 },
        {
          messages: [
            { role: "user", content: "中".repeat(8000), timestamp: 1 },
          ],
        },
      ),
    ).toThrow(/before sending/);
    expect(streamSimple).not.toHaveBeenCalled();
  });
  it("does not reject ordinary history by treating bytes as tokens", () => {
    const streamSimple = vi.fn();
    const runtime = withAttachmentContextBudget({
      streamSimple,
    } as unknown as ModelRuntime);
    const context: Context = {
      messages: [
        {
          role: "user",
          content: "The quick brown fox jumps over the lazy dog. ".repeat(5000),
          timestamp: 1,
        },
      ],
    };
    runtime.streamSimple({ ...model, contextWindow: 128000 }, context);
    expect(streamSimple).toHaveBeenCalledOnce();
    expect(streamSimple.mock.calls[0]![1]).toEqual(context);
  });
  it("lets Pi recognize local overflow and recomputes the budget after a model switch", async () => {
    const { isContextOverflow } = await import("@earendil-works/pi-ai/compat");
    const context: Context = {
      messages: [{ role: "user", content: "a".repeat(160000), timestamp: 1 }],
    };
    let failure: Error | undefined;
    try {
      fitAttachmentContext({ ...model, contextWindow: 32000 }, context);
    } catch (error) {
      failure = error as Error;
    }
    expect(failure).toBeDefined();
    expect(
      isContextOverflow(
        { stopReason: "error", errorMessage: failure!.message } as never,
        32000,
      ),
    ).toBe(true);
    expect(
      fitAttachmentContext({ ...model, contextWindow: 128000 }, context),
    ).toEqual(context);
  });
});

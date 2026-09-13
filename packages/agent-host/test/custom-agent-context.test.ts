import { describe, expect, it } from "vitest";
import type { Api, Model } from "@earendil-works/pi-ai";
import { assertCustomAgentContext } from "../src/custom-agent-context.js";

const model = {
  provider: "test",
  id: "model",
  contextWindow: 128000,
  maxTokens: 16000,
} as Model<Api>;
describe("custom agent invocation context budget", () => {
  it("accepts instructions beyond former byte ceilings when the actual model fits", () => {
    const context = {
      systemPrompt: "中文".repeat(18000),
      tools: [],
      messages: [],
    };
    expect(() => assertCustomAgentContext(model, context)).not.toThrow();
    expect(() =>
      assertCustomAgentContext({ ...model, contextWindow: 16000 }, context),
    ).toThrow(/CUSTOM_AGENT_CONTEXT_EXCEEDED/);
  });

  it("includes system instructions, tools, task, and output reserves without truncation", () => {
    const context = {
      systemPrompt: "x".repeat(32000),
      tools: [{ description: "y".repeat(32000) }],
      messages: [{ role: "user", content: "z".repeat(48000), timestamp: 1 }],
    };
    const original = structuredClone(context);
    expect(() =>
      assertCustomAgentContext({ ...model, contextWindow: 32000 }, context),
    ).toThrow(/test\/model.*32000.*tokens/);
    expect(context).toEqual(original);
    expect(() => assertCustomAgentContext(model, context)).not.toThrow();
  });
});

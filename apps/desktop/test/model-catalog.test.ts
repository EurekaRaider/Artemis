import { describe, expect, it } from "vitest";
import type { AgentModelInfo } from "@artemis/protocol";

import {
  filterVisibleModels,
  loadBundledModelCatalog,
} from "../src/main/model-catalog.js";

function model(
  providerId: string,
  modelId: string,
  name = modelId,
): AgentModelInfo {
  return {
    providerId,
    modelId,
    name,
    reasoning: true,
    contextWindow: 128_000,
    configured: false,
  };
}

describe("visible model catalog", () => {
  it("loads the bundled Pi catalog without credentials or an Agent Host", async () => {
    const models = filterVisibleModels(await loadBundledModelCatalog());

    expect(models.length).toBeGreaterThan(0);
    expect(
      models.some((candidate) => candidate.providerId === "anthropic"),
    ).toBe(true);
    expect(models.some((candidate) => candidate.providerId === "openai")).toBe(
      true,
    );
    expect(
      models.find(
        (candidate) =>
          candidate.providerId === "openai" &&
          candidate.modelId === "gpt-5.6-sol",
      )?.highestThinkingLevel,
    ).toBe("max");
    expect(models.every((candidate) => candidate.configured === false)).toBe(
      true,
    );
  });

  it("keeps mainstream direct model families and compatible inference providers", () => {
    const models = [
      model("anthropic", "claude-sonnet-4"),
      model("openai", "gpt-5.2"),
      model("google", "gemini-2.5-pro"),
      model("xai", "grok-4"),
      model("deepseek", "deepseek-reasoner"),
      model("zai", "glm-4.5"),
      model("moonshotai", "kimi-k2"),
      model("mistral", "mistral-large-latest"),
      model("minimax", "MiniMax-M2.1"),
      model("minimax-cn", "MiniMax-M2.1"),
      model("qwen-token-plan", "qwen3-coder-plus"),
      model("qwen-token-plan-cn", "qwen3-coder-plus"),
      model("xiaomi", "mimo-v2-pro"),
      model("xiaomi-token-plan-cn", "mimo-v2-pro"),
      model("xiaomi-token-plan-ams", "mimo-v2-pro"),
      model("xiaomi-token-plan-sgp", "mimo-v2-pro"),
      model("groq", "llama-3.3-70b-versatile"),
      model("amazon-bedrock", "anthropic.claude-sonnet-4", "Claude Sonnet 4"),
      model("google-vertex", "claude-opus-4", "Claude Opus 4"),
      model("openrouter", "openai/gpt-5", "OpenAI GPT-5"),
      model("amazon-bedrock", "us.amazon.nova-pro-v1:0"),
      model("ollama", "qwen2.5-coder:7b"),
    ];

    expect(
      filterVisibleModels(models).map(
        (candidate) => `${candidate.providerId}/${candidate.modelId}`,
      ),
    ).toEqual([
      "anthropic/claude-sonnet-4",
      "openai/gpt-5.2",
      "google/gemini-2.5-pro",
      "xai/grok-4",
      "deepseek/deepseek-reasoner",
      "zai/glm-4.5",
      "moonshotai/kimi-k2",
      "mistral/mistral-large-latest",
      "minimax/MiniMax-M2.1",
      "minimax-cn/MiniMax-M2.1",
      "qwen-token-plan/qwen3-coder-plus",
      "qwen-token-plan-cn/qwen3-coder-plus",
      "xiaomi/mimo-v2-pro",
      "xiaomi-token-plan-cn/mimo-v2-pro",
      "xiaomi-token-plan-ams/mimo-v2-pro",
      "xiaomi-token-plan-sgp/mimo-v2-pro",
      "groq/llama-3.3-70b-versatile",
    ]);
  });

  it("keeps every model explicitly configured through a custom provider", () => {
    expect(
      filterVisibleModels(
        [
          model("local-proxy", "claude-3-7-sonnet"),
          model("local-proxy", "gpt-4.1"),
          model("local-proxy", "deepseek-v3"),
          model("local-proxy", "glm-4-air"),
          model("local-proxy", "kimi-latest"),
          model("local-proxy", "llama-3.3"),
          model("local-proxy", "muse-park", "Muse Park"),
        ],
        ["local-proxy"],
      ).map((candidate) => candidate.name),
    ).toEqual([
      "claude-3-7-sonnet",
      "gpt-4.1",
      "deepseek-v3",
      "glm-4-air",
      "kimi-latest",
      "llama-3.3",
      "Muse Park",
    ]);
  });
});

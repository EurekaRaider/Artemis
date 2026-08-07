import { describe, expect, it } from "vitest";
import type { AgentModelInfo } from "@artemis/protocol";

import { filterVisibleModels } from "../src/main/model-catalog.js";

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
  it("keeps only Claude, OpenAI, DeepSeek, GLM, and Kimi families", () => {
    const models = [
      model("anthropic", "claude-sonnet-4"),
      model("openai", "gpt-5.2"),
      model("deepseek", "deepseek-reasoner"),
      model("zai", "glm-4.5"),
      model("moonshotai", "kimi-k2"),
      model("amazon-bedrock", "anthropic.claude-sonnet-4", "Claude Sonnet 4"),
      model("google-vertex", "claude-opus-4", "Claude Opus 4"),
      model("openrouter", "openai/gpt-5", "OpenAI GPT-5"),
      model("amazon-bedrock", "us.amazon.nova-pro-v1:0"),
      model("google", "gemini-2.5-pro"),
      model("ollama", "qwen2.5-coder:7b"),
    ];

    expect(
      filterVisibleModels(models).map(
        (candidate) => `${candidate.providerId}/${candidate.modelId}`,
      ),
    ).toEqual([
      "anthropic/claude-sonnet-4",
      "openai/gpt-5.2",
      "deepseek/deepseek-reasoner",
      "zai/glm-4.5",
      "moonshotai/kimi-k2",
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

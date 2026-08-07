import { describe, expect, it } from "vitest";
import type { ProviderConnection } from "@artemis/protocol";

import { toPiProviderConfig } from "../src/provider-configuration.js";
import { streamOpenAIResponsesWithAiSdk } from "../src/responses-ai-sdk-stream.js";

const provider: ProviderConnection = {
  id: "ollama",
  name: "Ollama",
  baseUrl: "http://127.0.0.1:11434/v1",
  models: [
    {
      id: "qwen2.5-coder:7b",
      name: "Qwen 2.5 Coder 7B",
      reasoning: false,
      input: ["text"],
      contextWindow: 128_000,
      maxTokens: 32_000,
    },
  ],
};

describe("toPiProviderConfig", () => {
  it("maps a local connection to Pi's OpenAI-compatible provider shape", () => {
    expect(toPiProviderConfig(provider, false)).toEqual({
      name: "Ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      api: "openai-completions",
      apiKey: "ollama",
      models: [
        {
          id: "qwen2.5-coder:7b",
          name: "Qwen 2.5 Coder 7B",
          reasoning: false,
          input: ["text"],
          contextWindow: 128_000,
          maxTokens: 32_000,
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
          },
        },
      ],
    });
  });

  it("uses the encrypted credential store when an API key exists", () => {
    expect(toPiProviderConfig(provider, true)).not.toHaveProperty("apiKey");
  });

  it("maps OpenCode @ai-sdk/openai connections to Pi's Responses API", () => {
    expect(
      toPiProviderConfig({ ...provider, api: "openai-responses" }, false).api,
    ).toBe("openai-responses");
  });

  it("installs the OpenCode-style AI SDK transport only for Responses providers", () => {
    const responses = toPiProviderConfig(
      { ...provider, api: "openai-responses" },
      false,
    );
    const completions = toPiProviderConfig(provider, false);

    expect(responses.streamSimple).toBe(streamOpenAIResponsesWithAiSdk);
    expect(completions).not.toHaveProperty("streamSimple");
  });
});

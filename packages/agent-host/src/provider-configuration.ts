import type { ProviderConnection } from "@artemis/protocol";

import { streamOpenAIResponsesWithAiSdk } from "./responses-ai-sdk-stream.js";

const zeroCost = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

export function toPiProviderConfig(
  provider: ProviderConnection,
  hasCredential: boolean,
) {
  return {
    name: provider.name,
    baseUrl: provider.baseUrl,
    api: provider.api ?? ("openai-completions" as const),
    ...(provider.api === "openai-responses"
      ? { streamSimple: streamOpenAIResponsesWithAiSdk }
      : {}),
    ...(!hasCredential ? { apiKey: "ollama" } : {}),
    models: provider.models.map((model) => ({
      id: model.id,
      name: model.name,
      reasoning: model.reasoning,
      input: [...model.input],
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      cost: { ...zeroCost },
    })),
  };
}

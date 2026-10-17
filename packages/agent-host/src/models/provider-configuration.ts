import type { Api, Model } from "@earendil-works/pi-ai";
import type { ProviderConnection, ProviderModel } from "@artemis/protocol";

import { streamOpenAIResponsesWithAiSdk } from "../runtime/responses-ai-sdk-stream.js";

const zeroCost = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

export function compatibleProviderBaseUrl(
  provider: Pick<ProviderConnection, "id" | "baseUrl">,
): string {
  if (provider.id !== "kimi-coding") return provider.baseUrl;
  const url = new URL(provider.baseUrl);
  if (
    url.origin === "https://api.kimi.com" &&
    /^\/coding\/?$/.test(url.pathname) &&
    !url.search &&
    !url.hash
  )
    return "https://api.kimi.com/coding/v1";
  return provider.baseUrl;
}

const customThinkingLevels: NonNullable<
  ProviderModel["highestThinkingLevel"]
>[] = ["minimal", "low", "medium", "high", "xhigh", "max"];

function customThinkingLevelMap(model: ProviderModel) {
  const highest = model.highestThinkingLevel ?? "high";
  const highestIndex = customThinkingLevels.indexOf(highest);
  return Object.fromEntries(
    customThinkingLevels.map((level, index) => [
      level,
      index <= highestIndex ? level : null,
    ]),
  );
}

export function toPiProviderConfig(
  provider: ProviderConnection,
  hasCredential: boolean,
) {
  return {
    name: provider.name,
    baseUrl: compatibleProviderBaseUrl(provider),
    api: provider.api ?? ("openai-completions" as const),
    ...(provider.api === "openai-responses"
      ? { streamSimple: streamOpenAIResponsesWithAiSdk }
      : {}),
    ...(!hasCredential ? { apiKey: "ollama" } : {}),
    models: provider.models
      .filter((model) => !model.virtualRoutes)
      .map((model) => ({
        id: model.id,
        name: model.name,
        reasoning: model.reasoning,
        ...(model.reasoning
          ? {
              thinkingLevelMap:
                model.thinkingLevelMap ?? customThinkingLevelMap(model),
            }
          : {}),
        input: [...model.input],
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        cost: { ...zeroCost },
        ...(model.samplingParams
          ? { samplingParams: model.samplingParams }
          : {}),
        ...(model.samplingParamsByThinkingLevel
          ? {
              samplingParamsByThinkingLevel:
                model.samplingParamsByThinkingLevel,
            }
          : {}),
        ...(model.promptCache
          ? {
              promptCache: JSON.parse(
                JSON.stringify(model.promptCache),
              ) as NonNullable<Model<Api>["promptCache"]>,
            }
          : {}),
        ...(model.inputLimits
          ? {
              inputLimits: JSON.parse(
                JSON.stringify(model.inputLimits),
              ) as NonNullable<Model<Api>["inputLimits"]>,
            }
          : {}),
      })),
  };
}

import type {
  AgentModelInfo,
  ProviderModel,
  ThinkingLevel,
} from "@artemis/protocol";
import type {
  ModelThinkingLevel,
  ThinkingLevelMap,
} from "@earendil-works/pi-ai";
import {
  getBuiltinModels,
  getBuiltinProviders,
} from "@earendil-works/pi-ai/providers/all";

const visibleProviderIds = new Set([
  "anthropic",
  "openai",
  "openai-codex",
  "google",
  "xai",
  "deepseek",
  "zai",
  "zai-coding-cn",
  "kimi-coding",
  "moonshotai",
  "moonshotai-cn",
  "mistral",
  "minimax",
  "minimax-cn",
  "qwen-token-plan",
  "qwen-token-plan-cn",
  "xiaomi",
  "xiaomi-token-plan-cn",
  "xiaomi-token-plan-ams",
  "xiaomi-token-plan-sgp",
  "groq",
]);

const thinkingLevels: ModelThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

const customThinkingLevels: Exclude<ThinkingLevel, "off">[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export function customModelThinkingLevels(
  model: Pick<ProviderModel, "reasoning" | "highestThinkingLevel">,
): ThinkingLevel[] {
  if (!model.reasoning) return ["off"];
  const highestIndex = customThinkingLevels.indexOf(
    model.highestThinkingLevel ?? "high",
  );
  return ["off", ...customThinkingLevels.slice(0, highestIndex + 1)];
}

function supportedThinkingLevels(model: {
  reasoning: boolean;
  thinkingLevelMap?: ThinkingLevelMap;
}): ModelThinkingLevel[] {
  if (!model.reasoning) return ["off"];
  return thinkingLevels.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === "xhigh" || level === "max") return mapped !== undefined;
    return true;
  });
}

export async function loadBundledModelCatalog(): Promise<AgentModelInfo[]> {
  return getBuiltinProviders().flatMap((providerId) =>
    getBuiltinModels(providerId).map((model) => {
      const supported = supportedThinkingLevels(model);
      return {
        providerId: model.provider,
        modelId: model.id,
        name: model.name,
        reasoning: model.reasoning,
        thinkingLevels: supported,
        highestThinkingLevel: supported.at(-1) ?? "off",
        contextWindow: model.contextWindow,
        configured: false,
      };
    }),
  );
}

export function mergeBundledModelCatalog(
  bundledModels: AgentModelInfo[],
  runtimeModels: AgentModelInfo[],
): AgentModelInfo[] {
  const runtimeByKey = new Map(
    runtimeModels.map((model) => [
      `${model.providerId}\0${model.modelId}`,
      model,
    ]),
  );
  const bundledKeys = new Set<string>();
  const merged = bundledModels.map((model) => {
    const key = `${model.providerId}\0${model.modelId}`;
    bundledKeys.add(key);
    return {
      ...model,
      configured:
        model.configured || Boolean(runtimeByKey.get(key)?.configured),
    };
  });
  for (const model of runtimeModels) {
    if (!bundledKeys.has(`${model.providerId}\0${model.modelId}`)) {
      merged.push(model);
    }
  }
  return merged;
}

export function filterVisibleModels(
  models: AgentModelInfo[],
  customProviderIds: Iterable<string> = [],
): AgentModelInfo[] {
  const customProviders = new Set(
    [...customProviderIds].map((providerId) => providerId.toLowerCase()),
  );
  return models.filter((model) => {
    const providerId = model.providerId.toLowerCase();
    return (
      visibleProviderIds.has(providerId) || customProviders.has(providerId)
    );
  });
}

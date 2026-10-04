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
import { withArtemisBuiltinModels } from "@artemis/agent-host/builtin-models";

const visibleProviderIds = new Set<string>(getBuiltinProviders());

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
  model: Pick<
    ProviderModel,
    "reasoning" | "highestThinkingLevel" | "thinkingLevelMap"
  >,
): ThinkingLevel[] {
  if (!model.reasoning) return ["off"];
  if (model.thinkingLevelMap) return supportedThinkingLevels(model);
  const highestIndex = customThinkingLevels.indexOf(
    model.highestThinkingLevel ?? "high",
  );
  return ["off", ...customThinkingLevels.slice(0, highestIndex + 1)];
}

function supportedThinkingLevels(model: {
  reasoning: boolean;
  thinkingLevelMap?: ThinkingLevelMap | undefined;
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
    withArtemisBuiltinModels(providerId, getBuiltinModels(providerId)).map(
      (model) => {
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
      },
    ),
  );
}

export function mergeBundledModelCatalog(
  bundledModels: AgentModelInfo[],
  runtimeModels: AgentModelInfo[],
  customProviderIds: Iterable<string> = [],
): AgentModelInfo[] {
  const customProviders = new Set(
    [...customProviderIds].map((providerId) => providerId.toLowerCase()),
  );
  const runtimeByKey = new Map(
    runtimeModels.map((model) => [
      `${model.providerId}\0${model.modelId}`,
      model,
    ]),
  );
  const bundledKeys = new Set<string>();
  const merged = bundledModels
    .filter((model) => !customProviders.has(model.providerId.toLowerCase()))
    .map((model) => {
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

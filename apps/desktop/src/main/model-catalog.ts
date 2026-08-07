import type { AgentModelInfo } from "@artemis/protocol";
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

export async function loadBundledModelCatalog(): Promise<AgentModelInfo[]> {
  return getBuiltinProviders().flatMap((providerId) =>
    getBuiltinModels(providerId).map((model) => ({
      providerId: model.provider,
      modelId: model.id,
      name: model.name,
      reasoning: model.reasoning,
      contextWindow: model.contextWindow,
      configured: false,
    })),
  );
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

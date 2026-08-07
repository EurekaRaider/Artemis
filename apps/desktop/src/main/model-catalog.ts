import type { AgentModelInfo } from "@artemis/protocol";

const visibleProviderIds = new Set([
  "anthropic",
  "openai",
  "openai-codex",
  "deepseek",
  "zai",
  "zai-coding-cn",
  "kimi-coding",
  "moonshotai",
  "moonshotai-cn",
]);

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

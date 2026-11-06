import {
  parseModelKey,
  normalizedModelLabel,
  modelKey,
  providerIdPattern,
} from "../settings-values.js";

import { useMemo } from "react";

import type { SettingsSnapshot } from "../../../shared/api.js";

interface UseModelFormContext {
  readonly settings: SettingsSnapshot | undefined;
  readonly selectedModel: string;
  readonly contextWindow: string;
  readonly providerContextWindow: string;
  readonly providerId: string;
  readonly providerMaxTokens: string;
  readonly baseUrl: string;
  readonly providerModelId: string;
  readonly agentConcurrencyLimit: string;
}
export function useModelForm(context: UseModelFormContext) {
  const {
    settings,
    selectedModel,
    contextWindow,
    providerContextWindow,
    providerId,
    providerMaxTokens,
    baseUrl,
    providerModelId,
    agentConcurrencyLimit,
  } = context;
  const models = useMemo(
    () =>
      [...(settings?.models ?? [])].sort(
        (left, right) =>
          left.providerId.localeCompare(right.providerId) ||
          left.name.localeCompare(right.name),
      ),
    [settings?.models],
  );
  const selectedModelInfo = useMemo(() => {
    if (!selectedModel) return undefined;
    const [providerId, modelId] = parseModelKey(selectedModel);
    return models.find(
      (model) => model.providerId === providerId && model.modelId === modelId,
    );
  }, [models, selectedModel]);
  const modelOptions = useMemo(() => {
    let labels = models.map((model) => model.name);
    for (const includeId of [false, true]) {
      const counts = new Map<string, number>();
      for (const label of labels) {
        const key = normalizedModelLabel(label);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      labels = labels.map((label, index) => {
        const key = normalizedModelLabel(label);
        if (key && counts.get(key) === 1) return label;
        const model = models[index]!;
        return includeId
          ? `${model.name} · ${model.providerId} · ${model.modelId}`
          : `${model.name} · ${model.providerId}`;
      });
    }
    const usedLabels = new Set<string>();
    return models.map((model, index) => {
      const base = labels[index]!;
      let label = base;
      let suffix = 2;
      while (usedLabels.has(normalizedModelLabel(label))) {
        label = `${base} (${suffix++})`;
      }
      usedLabels.add(normalizedModelLabel(label));
      return {
        value: modelKey(model.providerId, model.modelId),
        label,
        searchText: `${model.providerId} ${model.name} ${model.modelId}`,
        title: `${model.name}
${model.providerId} · ${model.modelId}`,
      };
    });
  }, [models]);
  const selectedModelUsesCustomProvider = Boolean(
    selectedModelInfo &&
    settings?.providers.some(
      (provider) => provider.id === selectedModelInfo.providerId,
    ),
  );
  const selectedAddedModel = settings?.addedModels.find(
    (model) =>
      model.providerId === selectedModelInfo?.providerId &&
      model.modelId === selectedModelInfo.modelId,
  );
  const selectedModelCredential = settings?.credentials.find(
    (credential) =>
      credential.providerId === selectedModelInfo?.providerId &&
      credential.type === "api_key",
  );
  const selectedModelCanBeAdded = Boolean(
    selectedModelInfo &&
    (selectedModelUsesCustomProvider ||
      selectedModelInfo.configured ||
      selectedModelCredential),
  );
  const parsedContextWindow = Number(contextWindow);
  const contextWindowValid =
    Number.isInteger(parsedContextWindow) &&
    parsedContextWindow >= 1_024 &&
    parsedContextWindow <=
      (selectedModelInfo?.contextWindow ?? Number.POSITIVE_INFINITY);
  const parsedProviderContextWindow = Number(providerContextWindow);
  const trimmedProviderId = providerId.trim();
  const providerIdValid =
    trimmedProviderId.length <= 80 && providerIdPattern.test(trimmedProviderId);
  const providerContextWindowValid =
    Number.isInteger(parsedProviderContextWindow) &&
    parsedProviderContextWindow >= 1_024 &&
    parsedProviderContextWindow <= 10_000_000;
  const parsedProviderMaxTokens = Number(providerMaxTokens);
  const providerMaxTokensValid =
    Number.isInteger(parsedProviderMaxTokens) &&
    parsedProviderMaxTokens >= 1 &&
    parsedProviderMaxTokens <= 1_000_000;
  const providerFormValid =
    providerIdValid &&
    Boolean(baseUrl.trim()) &&
    Boolean(providerModelId.trim()) &&
    providerContextWindowValid &&
    providerMaxTokensValid;
  const parsedAgentConcurrencyLimit = Number(agentConcurrencyLimit);
  const agentConcurrencyLimitValid =
    Number.isInteger(parsedAgentConcurrencyLimit) &&
    parsedAgentConcurrencyLimit >= 2 &&
    parsedAgentConcurrencyLimit <= (settings?.agentConcurrency.hardLimit ?? 64);
  return {
    models,
    selectedModelInfo,
    modelOptions,
    selectedAddedModel,
    selectedModelCanBeAdded,
    parsedContextWindow,
    contextWindowValid,
    parsedProviderContextWindow,
    trimmedProviderId,
    parsedProviderMaxTokens,
    providerFormValid,
    parsedAgentConcurrencyLimit,
    agentConcurrencyLimitValid,
  };
}

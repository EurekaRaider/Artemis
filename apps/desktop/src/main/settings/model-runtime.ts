import type { ModelSettingsSnapshot } from "../application/runtime-types.js";
import type { AgentModelInfo, ModelSelection } from "@artemis/protocol";
import {
  customModelThinkingLevels,
  filterVisibleModels,
  loadBundledModelCatalog,
  mergeBundledModelCatalog,
} from "../settings/model-catalog.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  "settingsStore" | "diagnosticBundleService" | "cachedAgentCatalog"
>;
export function createModelRuntime(services: Dependencies) {
  function normalizeModelSelection(
    selection: ModelSelection,
    supportsReasoning: boolean,
    highestThinkingLevel: ModelSelection["thinkingLevel"] = "high",
  ): ModelSelection {
    const ultraMode = supportsReasoning && selection.ultraMode === true;
    return {
      providerId: selection.providerId,
      modelId: selection.modelId,
      thinkingLevel: supportsReasoning
        ? ultraMode
          ? highestThinkingLevel
          : selection.thinkingLevel
        : "off",
      ...(ultraMode ? { ultraMode: true } : {}),
    };
  }

  async function resolveModelSelection(
    selection: ModelSelection,
    currentSelection?: ModelSelection,
  ): Promise<{ selection: ModelSelection; contextWindow: number }> {
    if (!services.settingsStore)
      throw new Error("Agent settings are not ready.");
    if (
      !selection ||
      typeof selection.providerId !== "string" ||
      typeof selection.modelId !== "string"
    ) {
      throw new Error("Model selection is invalid.");
    }
    if (
      selection.ultraMode !== undefined &&
      typeof selection.ultraMode !== "boolean"
    ) {
      throw new Error("Ultra mode setting is invalid.");
    }
    const allowedThinking = [
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ];
    if (!allowedThinking.includes(selection.thinkingLevel)) {
      throw new Error("Thinking level is invalid.");
    }
    const snapshot = await getModelSettingsSnapshot();
    const selectedModel = snapshot.models.find(
      (model) =>
        model.providerId === selection.providerId &&
        model.modelId === selection.modelId,
    );
    if (!selectedModel) {
      throw new Error("Selected model is not in the Pi model catalog.");
    }
    const addedModel = snapshot.addedModels.find(
      (model) =>
        model.providerId === selection.providerId &&
        model.modelId === selection.modelId,
    );
    const customProviderModel = snapshot.providers
      .find((provider) => provider.id === selection.providerId)
      ?.models.find((model) => model.id === selection.modelId);
    const isKnownSelection = [snapshot.selection, currentSelection].some(
      (candidate) =>
        candidate?.providerId === selection.providerId &&
        candidate.modelId === selection.modelId,
    );
    if (!addedModel && !customProviderModel && !isKnownSelection) {
      throw new Error("Add this model in Settings before selecting it.");
    }
    const hasStoredCredential = snapshot.credentials.some(
      (credential) => credential.providerId === selection.providerId,
    );
    if (
      !customProviderModel &&
      !hasStoredCredential &&
      !selectedModel.configured
    ) {
      throw new Error("This model no longer has configured credentials.");
    }
    const selectedHighestThinkingLevel =
      selectedModel.highestThinkingLevel ?? "high";
    const supportedSelection =
      selectedModel.reasoning &&
      selectedModel.thinkingLevels &&
      !selectedModel.thinkingLevels.includes(selection.thinkingLevel)
        ? { ...selection, thinkingLevel: selectedHighestThinkingLevel }
        : selection;
    return {
      selection: normalizeModelSelection(
        supportedSelection,
        selectedModel.reasoning,
        selectedHighestThinkingLevel,
      ),
      contextWindow: Math.min(
        addedModel?.contextWindow ??
          customProviderModel?.contextWindow ??
          snapshot.contextWindow,
        selectedModel.contextWindow,
      ),
    };
  }

  async function getModelSettingsSnapshot(): Promise<ModelSettingsSnapshot> {
    if (!services.settingsStore)
      throw new Error("Agent settings are not ready.");
    const [
      providers,
      credentials,
      bundledModels,
      addedModels,
      persistedSelection,
      contextWindowPreference,
    ] = await Promise.all([
      services.settingsStore.providerConnections(),
      services.settingsStore.credentialSummaries(),
      loadBundledModelCatalog().catch((error): AgentModelInfo[] => {
        services.diagnosticBundleService?.record({
          source: "main",
          severity: "error",
          message: `Bundled model catalog could not be loaded: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
        return [];
      }),
      services.settingsStore.addedModels(),
      services.settingsStore.modelSelection(),
      services.settingsStore.contextWindowPreference(),
    ]);
    const catalogModels = mergeBundledModelCatalog(
      bundledModels,
      services.cachedAgentCatalog.models,
      providers.map((provider) => provider.id),
      services.cachedAgentCatalog.authoritativeProviderIds,
    );
    const configuredProviderIds = new Set(
      credentials.map((credential) => credential.providerId),
    );
    const modelsByKey = new Map<string, AgentModelInfo>();
    for (const model of catalogModels) {
      modelsByKey.set(`${model.providerId}\0${model.modelId}`, {
        ...model,
        configured:
          model.configured || configuredProviderIds.has(model.providerId),
      });
    }
    for (const provider of providers) {
      if (
        services.cachedAgentCatalog.authoritativeProviderIds?.includes(
          provider.id,
        )
      )
        continue;
      for (const model of provider.models) {
        const thinkingLevels = customModelThinkingLevels(model);
        modelsByKey.set(`${provider.id}\0${model.id}`, {
          providerId: provider.id,
          modelId: model.id,
          name: model.name,
          reasoning: model.reasoning,
          thinkingLevels,
          highestThinkingLevel: thinkingLevels.at(-1) ?? "off",
          contextWindow: model.contextWindow,
          configured: true,
        });
      }
    }
    const models = filterVisibleModels(
      [...modelsByKey.values()],
      providers.map((provider) => provider.id),
    );
    const availableSelection = persistedSelection;
    const selection =
      availableSelection &&
      (models.length === 0 ||
        models.some(
          (model) =>
            model.providerId === availableSelection.providerId &&
            model.modelId === availableSelection.modelId,
        ))
        ? availableSelection
        : undefined;
    const selectedModel = selection
      ? models.find(
          (model) =>
            model.providerId === selection.providerId &&
            model.modelId === selection.modelId,
        )
      : undefined;
    const contextWindow =
      contextWindowPreference ??
      selectedModel?.contextWindow ??
      models[0]?.contextWindow ??
      128_000;

    return {
      contextWindow,
      models,
      addedModels,
      credentials,
      providers,
      ...(selection ? { selection } : {}),
    };
  }
  return {
    normalizeModelSelection,
    resolveModelSelection,
    getModelSettingsSnapshot,
  };
}

import { modelIdentity } from "./controller-values.js";
import { appCopy } from "../app-copy.js";

import { uiText } from "../../../shared/i18n/ui-text.js";

import { useMemo } from "react";

import { type ModelSelection } from "@artemis/protocol";
import type { SettingsSnapshot } from "../../../shared/api.js";

import { thinkingLevelLabel } from "../../settings/model-selection.js";

interface UseComposerModelDetailsContext {
  readonly pendingModelSelection: ModelSelection | undefined;
  readonly activeThread: import("@artemis/protocol").Thread | undefined;
  readonly runtimeSettings: SettingsSnapshot | undefined;
  readonly t: ReturnType<typeof appCopy>;
  readonly locale: import("@artemis/protocol").AppLocale;
  readonly modelFilter: string;
}
export function useComposerModelDetails(
  context: UseComposerModelDetailsContext,
) {
  const {
    pendingModelSelection,
    activeThread,
    runtimeSettings,
    t,
    locale,
    modelFilter,
  } = context;
  const activeSelection =
    pendingModelSelection ??
    activeThread?.modelSelection ??
    runtimeSettings?.selection;
  const activeModel = activeSelection
    ? runtimeSettings?.models.find(
        (model) =>
          model.providerId === activeSelection.providerId &&
          model.modelId === activeSelection.modelId,
      )
    : undefined;
  const activeProvider = activeSelection
    ? runtimeSettings?.providers.find(
        (provider) => provider.id === activeSelection.providerId,
      )
    : undefined;
  const activeProviderModel = activeProvider?.models.find(
    (model) => model.id === activeSelection?.modelId,
  );
  const activeModelLabel =
    activeModel?.name ??
    activeProviderModel?.name ??
    activeSelection?.modelId ??
    t.model;
  const activeModelSupportsReasoning =
    activeModel?.reasoning ?? activeProviderModel?.reasoning ?? false;
  const activeUltraMode =
    activeModelSupportsReasoning && activeSelection?.ultraMode === true;
  const activeThinkingLevel = activeUltraMode
    ? uiText(locale, "Review06.ultra")
    : activeSelection &&
        activeModelSupportsReasoning &&
        activeSelection.thinkingLevel !== "off"
      ? thinkingLevelLabel(activeSelection.thinkingLevel, locale)
      : undefined;
  const switchableModels = useMemo(() => {
    if (!runtimeSettings) return [];
    const addedModels = new Set(
      runtimeSettings.addedModels.map((model) =>
        modelIdentity(model.providerId, model.modelId),
      ),
    );
    const customProviders = new Set(
      runtimeSettings.providers.map((provider) => provider.id),
    );
    const selectedModelIdentity = activeSelection
      ? modelIdentity(activeSelection.providerId, activeSelection.modelId)
      : undefined;
    return runtimeSettings.models
      .filter((model) => {
        const identity = modelIdentity(model.providerId, model.modelId);
        return (
          addedModels.has(identity) ||
          customProviders.has(model.providerId) ||
          identity === selectedModelIdentity
        );
      })
      .sort(
        (left, right) =>
          left.name.localeCompare(right.name, locale) ||
          left.providerId.localeCompare(right.providerId, locale),
      );
  }, [activeSelection, locale, runtimeSettings]);
  const filteredModels = useMemo(() => {
    const query = modelFilter.trim().toLocaleLowerCase(locale);
    return switchableModels.filter((model) =>
      [model.name, model.modelId, model.providerId].some((value) =>
        value.toLocaleLowerCase(locale).includes(query),
      ),
    );
  }, [switchableModels, modelFilter, locale]);
  return {
    activeSelection,
    activeModel,
    activeProvider,
    activeModelLabel,
    activeModelSupportsReasoning,
    activeThinkingLevel,
    switchableModels,
    filteredModels,
  };
}

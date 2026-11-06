import type { ProviderThinkingLevel } from "../settings-values.js";
import {
  modelKey,
  DEFAULT_PROVIDER_CONTEXT_WINDOW,
  DEFAULT_PROVIDER_MAX_TOKENS,
  modelFormState,
} from "../settings-values.js";
import { modelAdvancedOptionsSchema } from "@artemis/protocol";

import { type FormEvent, type RefObject } from "react";
import type { ProviderConnection } from "@artemis/protocol";

import type { SettingsSnapshot } from "../../../shared/api.js";

interface UseProviderActionsContext {
  readonly editingProviderId: string | undefined;
  readonly settings: SettingsSnapshot | undefined;
  readonly providerAdvanced: string;
  readonly providerAdvancedDisclosure: import("react").RefObject<HTMLDetailsElement | null>;
  readonly run: (action: () => Promise<void>) => Promise<void>;
  readonly providerModelId: string;
  readonly providerModelName: string;
  readonly providerReasoning: boolean;
  readonly providerHighestThinkingLevel: ProviderThinkingLevel;
  readonly providerImages: boolean;
  readonly parsedProviderContextWindow: number;
  readonly parsedProviderMaxTokens: number;
  readonly trimmedProviderId: string;
  readonly providerName: string;
  readonly baseUrl: string;
  readonly providerApi: NonNullable<ProviderConnection["api"]>;
  readonly editingProviderModelId: string | undefined;
  readonly setSettings: import("react").Dispatch<
    import("react").SetStateAction<SettingsSnapshot | undefined>
  >;
  readonly onSettingsChange: (
    settings: SettingsSnapshot,
    options?: {
      refreshThreads?: boolean;
    },
  ) => void;
  readonly setSelectedModel: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setContextWindow: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setSelectedProviderId: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setShowProviderForm: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly setEditingProviderId: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
  readonly setEditingProviderModelId: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
  readonly setProviderAdvanced: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setProviderId: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setProviderName: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setBaseUrl: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setProviderApi: import("react").Dispatch<
    import("react").SetStateAction<NonNullable<ProviderConnection["api"]>>
  >;
  readonly setProviderModelId: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setProviderModelName: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setProviderContextWindow: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setProviderMaxTokens: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setProviderReasoning: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly setProviderHighestThinkingLevel: import("react").Dispatch<
    import("react").SetStateAction<ProviderThinkingLevel>
  >;
  readonly setProviderImages: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly setProviderDeleteTarget: import("react").Dispatch<
    import("react").SetStateAction<ProviderConnection | undefined>
  >;
}
export function useProviderActions(context: UseProviderActionsContext) {
  const {
    editingProviderId,
    settings,
    providerAdvanced,
    providerAdvancedDisclosure,
    providerModelId,
    providerModelName,
    providerReasoning,
    providerHighestThinkingLevel,
    providerImages,
    parsedProviderContextWindow,
    parsedProviderMaxTokens,
    trimmedProviderId,
    providerName,
    baseUrl,
    providerApi,
    editingProviderModelId,
    setSettings,
    onSettingsChange,
    setSelectedModel,
    setContextWindow,
    setSelectedProviderId,
    setShowProviderForm,
    setEditingProviderId,
    setEditingProviderModelId,
    setProviderAdvanced,
    setProviderId,
    setProviderName,
    setBaseUrl,
    setProviderApi,
    setProviderModelId,
    setProviderModelName,
    setProviderContextWindow,
    setProviderMaxTokens,
    setProviderReasoning,
    setProviderHighestThinkingLevel,
    setProviderImages,
    setProviderDeleteTarget,
  } = context;
  async function saveProviderConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const existingProvider = settings?.providers.find(
      (provider) => provider.id === editingProviderId,
    );
    let advanced;
    try {
      advanced = modelAdvancedOptionsSchema.parse(JSON.parse(providerAdvanced));
    } catch (error) {
      if (providerAdvancedDisclosure.current) {
        providerAdvancedDisclosure.current.open = true;
        providerAdvancedDisclosure.current.querySelector("textarea")?.focus();
      }
      await context.run(async () => {
        throw error;
      });
      return;
    }
    const editedModel: ProviderConnection["models"][number] = {
      ...advanced,
      id: providerModelId.trim(),
      name: providerModelName.trim() || providerModelId.trim(),
      reasoning: providerReasoning,
      ...(providerReasoning
        ? { highestThinkingLevel: providerHighestThinkingLevel }
        : {}),
      input: providerImages ? ["text", "image"] : ["text"],
      contextWindow: parsedProviderContextWindow,
      maxTokens: parsedProviderMaxTokens,
    };
    const provider: ProviderConnection = {
      ...existingProvider,
      id: trimmedProviderId,
      name: providerName.trim() || trimmedProviderId,
      baseUrl: baseUrl.trim(),
      api: providerApi,
      models: existingProvider
        ? editingProviderModelId
          ? existingProvider.models.map((model) =>
              model.id === editingProviderModelId ? editedModel : model,
            )
          : [...existingProvider.models, editedModel]
        : [editedModel],
    };
    await context.run(async () => {
      const updated = await window.artemis.saveProviderConnection(
        provider,
        undefined,
      );
      setSettings(updated);
      onSettingsChange(updated);
      const savedModel = updated.models.find(
        (model) =>
          model.providerId === provider.id && model.modelId === editedModel.id,
      );
      if (savedModel) {
        setSelectedModel(modelKey(savedModel.providerId, savedModel.modelId));
        setContextWindow(String(savedModel.contextWindow));
      } else if (updated.models[0]) {
        setSelectedModel(
          modelKey(updated.models[0].providerId, updated.models[0].modelId),
        );
        setContextWindow(String(updated.models[0].contextWindow));
      }
      resetProviderForm();
      setSelectedProviderId(provider.id);
    });
  }

  function resetProviderForm() {
    setShowProviderForm(false);
    setEditingProviderId(undefined);
    setEditingProviderModelId(undefined);
    setProviderAdvanced("{}");
    setProviderId("");
    setProviderName("");
    setBaseUrl("");
    setProviderApi("openai-completions");
    setProviderModelId("");
    setProviderModelName("");
    setProviderContextWindow(String(DEFAULT_PROVIDER_CONTEXT_WINDOW));
    setProviderMaxTokens(String(DEFAULT_PROVIDER_MAX_TOKENS));
    setProviderReasoning(false);
    setProviderHighestThinkingLevel("high");
    setProviderImages(false);
  }

  function editProviderConnection(
    provider: ProviderConnection,
    modelId?: string,
  ) {
    const model =
      provider.models.find((candidate) => candidate.id === modelId) ??
      provider.models[0];
    setShowProviderForm(true);
    setEditingProviderId(provider.id);
    setEditingProviderModelId(model?.id);
    setProviderId(provider.id);
    setProviderName(provider.name);
    setBaseUrl(provider.baseUrl);
    setProviderApi(provider.api ?? "openai-completions");
    setProviderModelId(model?.id ?? "");
    setProviderModelName(model?.name ?? "");
    setProviderContextWindow(
      String(model?.contextWindow ?? DEFAULT_PROVIDER_CONTEXT_WINDOW),
    );
    setProviderMaxTokens(
      String(model?.maxTokens ?? DEFAULT_PROVIDER_MAX_TOKENS),
    );
    setProviderReasoning(model?.reasoning ?? false);
    setProviderHighestThinkingLevel(model?.highestThinkingLevel ?? "high");
    setProviderAdvanced(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(model ?? {}).filter(
            ([key]) => key in modelAdvancedOptionsSchema.shape,
          ),
        ),
        null,
        2,
      ),
    );
    setProviderImages(model?.input.includes("image") ?? false);
  }

  async function deleteProviderConnection(provider: ProviderConnection) {
    await context.run(async () => {
      const updated = await window.artemis.deleteProviderConnection(
        provider.id,
      );
      setSettings(updated);
      onSettingsChange(updated);
      setProviderDeleteTarget(undefined);
      if (editingProviderId === provider.id) {
        resetProviderForm();
      }
      const modelState = modelFormState(updated);
      setSelectedModel(modelState.selectedModel);
      setContextWindow(modelState.contextWindow);
    });
  }
  return {
    saveProviderConnection,
    resetProviderForm,
    editProviderConnection,
    deleteProviderConnection,
  };
}

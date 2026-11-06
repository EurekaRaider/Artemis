import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { app, dialog } from "electron";
import type { ModelSelection, ProviderConnection } from "@artemis/protocol";
import {
  contextWindowSchema,
  providerConnectionSchema,
} from "@artemis/protocol";
import { mainText } from "../settings/i18n.js";
import {
  IPC,
  type AddedModelConfiguration,
  type SettingsSnapshot,
} from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "settingsStore"
  | "getSettingsSnapshot"
  | "applyAgentRuntime"
  | "ipcMain"
  | "store"
  | "activeTurns"
  | "resetAgentThreadsForToolChange"
  | "resolveModelSelection"
  | "mainWindow"
  | "currentLocale"
>;

export function registerModelsProvidersIpc(services: Dependencies): void {
  const {
    getSettingsSnapshot,
    applyAgentRuntime,
    ipcMain,
    activeTurns,
    resetAgentThreadsForToolChange,
    resolveModelSelection,
    currentLocale,
  } = services;

  ipcMain.handle(
    IPC.settingsModelAdd,
    async (
      _event,
      modelInput: AddedModelConfiguration,
      apiKeyInput?: string,
    ): Promise<SettingsSnapshot> => {
      if (!services.settingsStore) {
        throw new Error("Agent settings are not ready.");
      }
      if (
        !modelInput ||
        typeof modelInput.providerId !== "string" ||
        typeof modelInput.modelId !== "string"
      ) {
        throw new Error("Model configuration is invalid.");
      }
      const snapshot = await getSettingsSnapshot();
      const selectedModel = snapshot.models.find(
        (model) =>
          model.providerId === modelInput.providerId &&
          model.modelId === modelInput.modelId,
      );
      if (!selectedModel) {
        throw new Error("Selected model is not in the Pi model catalog.");
      }
      const contextWindow = contextWindowSchema.parse(modelInput.contextWindow);
      if (contextWindow > selectedModel.contextWindow) {
        throw new Error(
          `Context window cannot exceed the model limit of ${selectedModel.contextWindow}.`,
        );
      }
      const apiKey = apiKeyInput?.trim() || undefined;
      if (apiKey && Buffer.byteLength(apiKey, "utf8") > 16 * 1024) {
        throw new Error("API key cannot exceed 16 KiB.");
      }
      if (apiKey && !services.settingsStore.encryptionAvailable) {
        throw new Error("OS credential encryption is unavailable");
      }
      const isCustomProvider = snapshot.providers.some(
        (provider) => provider.id === selectedModel.providerId,
      );
      const hasStoredCredential = snapshot.credentials.some(
        (credential) => credential.providerId === selectedModel.providerId,
      );
      if (
        !apiKey &&
        !isCustomProvider &&
        !hasStoredCredential &&
        !selectedModel.configured
      ) {
        throw new Error("Add an API key before adding this model.");
      }
      if (apiKey) {
        const configuration =
          await services.settingsStore.runtimeConfiguration();
        configuration.credentials[selectedModel.providerId] = {
          type: "api_key",
          key: apiKey,
        };
        await applyAgentRuntime(configuration);
      }
      await services.settingsStore.addModel(
        {
          providerId: selectedModel.providerId,
          modelId: selectedModel.modelId,
          contextWindow,
        },
        apiKey,
      );
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.settingsModelDelete,
    async (
      _event,
      modelInput: Pick<AddedModelConfiguration, "providerId" | "modelId">,
    ): Promise<SettingsSnapshot> => {
      if (!services.settingsStore) {
        throw new Error("Agent settings are not ready.");
      }
      if (
        !modelInput ||
        typeof modelInput.providerId !== "string" ||
        typeof modelInput.modelId !== "string"
      ) {
        throw new Error("Model configuration is invalid.");
      }
      const snapshot = await getSettingsSnapshot();
      const target = snapshot.addedModels.find(
        (model) =>
          model.providerId === modelInput.providerId &&
          model.modelId === modelInput.modelId,
      );
      if (!target) return snapshot;

      const deletesActiveModel =
        snapshot.selection?.providerId === target.providerId &&
        snapshot.selection.modelId === target.modelId;
      const remainingAddedModels = snapshot.addedModels.filter(
        (model) =>
          model.providerId !== target.providerId ||
          model.modelId !== target.modelId,
      );
      const customProviderExists = snapshot.providers.some(
        (provider) => provider.id === target.providerId,
      );
      const referencingThreads = customProviderExists
        ? []
        : (services.store?.listThreads() ?? []).filter(
            (thread) =>
              thread.modelSelection?.providerId === target.providerId &&
              thread.modelSelection.modelId === target.modelId,
          );
      const removesActiveSelection =
        deletesActiveModel && !customProviderExists;
      if (
        (removesActiveSelection || referencingThreads.length > 0) &&
        activeTurns.size > 0
      ) {
        throw new Error("Stop the active turn before deleting its model.");
      }
      const deleteCredential =
        !customProviderExists &&
        !remainingAddedModels.some(
          (model) => model.providerId === target.providerId,
        );
      const configuration = await services.settingsStore.runtimeConfiguration();
      let replacement:
        { selection: ModelSelection; contextWindow: number } | undefined;

      if (removesActiveSelection || referencingThreads.length > 0) {
        const fallbackProvider = snapshot.providers.find(
          (provider) => provider.models.length > 0,
        );
        const fallbackProviderModel = fallbackProvider?.models[0];
        if (fallbackProvider && fallbackProviderModel) {
          replacement = {
            selection: {
              providerId: fallbackProvider.id,
              modelId: fallbackProviderModel.id,
              thinkingLevel: fallbackProviderModel.reasoning ? "medium" : "off",
            },
            contextWindow: fallbackProviderModel.contextWindow,
          };
        } else {
          const fallbackAddedModel = remainingAddedModels.find((candidate) =>
            snapshot.models.some(
              (model) =>
                model.providerId === candidate.providerId &&
                model.modelId === candidate.modelId &&
                (model.configured ||
                  Boolean(configuration.credentials[model.providerId])),
            ),
          );
          const fallbackCatalogModel = fallbackAddedModel
            ? snapshot.models.find(
                (model) =>
                  model.providerId === fallbackAddedModel.providerId &&
                  model.modelId === fallbackAddedModel.modelId,
              )
            : undefined;
          if (fallbackAddedModel && fallbackCatalogModel) {
            replacement = {
              selection: {
                providerId: fallbackAddedModel.providerId,
                modelId: fallbackAddedModel.modelId,
                thinkingLevel: fallbackCatalogModel.reasoning
                  ? "medium"
                  : "off",
              },
              contextWindow: Math.min(
                fallbackAddedModel.contextWindow,
                fallbackCatalogModel.contextWindow,
              ),
            };
          }
        }
      }

      if (removesActiveSelection) {
        if (replacement) {
          configuration.selection = replacement.selection;
          configuration.contextWindow = replacement.contextWindow;
        } else {
          delete configuration.selection;
          delete configuration.contextWindow;
        }
      }
      if (
        referencingThreads.length > 0 ||
        (removesActiveSelection && !replacement)
      ) {
        await resetAgentThreadsForToolChange();
      }
      if (deleteCredential) {
        delete configuration.credentials[target.providerId];
      }
      if (removesActiveSelection || deleteCredential) {
        await applyAgentRuntime(configuration);
      }
      await services.settingsStore.removeModel(target, {
        deleteCredential,
        ...(replacement ? { replacement } : {}),
      });
      for (const thread of referencingThreads) {
        services.store?.updateThread(thread.id, {
          modelSelection: replacement?.selection ?? null,
          contextWindow: replacement?.contextWindow ?? null,
        });
      }
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.settingsModelSet,
    async (_event, selection: ModelSelection): Promise<SettingsSnapshot> => {
      if (!services.settingsStore) {
        throw new Error("Agent settings are not ready.");
      }
      const resolved = await resolveModelSelection(selection);
      const configuration = await services.settingsStore.runtimeConfiguration();
      configuration.selection = resolved.selection;
      configuration.contextWindow = resolved.contextWindow;
      await applyAgentRuntime(configuration);
      await services.settingsStore.setModel(
        resolved.selection,
        resolved.contextWindow,
      );
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.settingsApiKeySave,
    async (
      _event,
      providerId: string,
      apiKey: string,
    ): Promise<SettingsSnapshot> => {
      if (!services.settingsStore) {
        throw new Error("Agent settings are not ready.");
      }
      if (!apiKey.trim() || Buffer.byteLength(apiKey, "utf8") > 16 * 1024) {
        throw new Error("API key must contain between 1 byte and 16 KiB.");
      }
      await services.settingsStore.saveCredential(providerId, {
        type: "api_key",
        key: apiKey.trim(),
      });
      await applyAgentRuntime();
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.settingsProviderSave,
    async (
      _event,
      providerInput: ProviderConnection,
      apiKeyInput?: string,
    ): Promise<SettingsSnapshot> => {
      if (!services.settingsStore) {
        throw new Error("Agent settings are not ready.");
      }
      const provider = providerConnectionSchema.parse(providerInput);
      const providerModelIds = new Set(
        provider.models.map((model) => model.id),
      );
      if (
        services.store
          ?.listThreads()
          .some(
            (thread) =>
              thread.modelSelection?.providerId === provider.id &&
              !providerModelIds.has(thread.modelSelection.modelId),
          )
      ) {
        throw new Error(
          "Keep every model used by a conversation in this provider.",
        );
      }
      const apiKey = apiKeyInput?.trim() || undefined;
      if (apiKey && Buffer.byteLength(apiKey, "utf8") > 16 * 1024) {
        throw new Error("API key cannot exceed 16 KiB.");
      }
      if (apiKey && !services.settingsStore.encryptionAvailable) {
        throw new Error("OS credential encryption is unavailable");
      }
      const configuration = await services.settingsStore.runtimeConfiguration();
      configuration.providers = [
        ...(configuration.providers ?? []).filter(
          (candidate) => candidate.id !== provider.id,
        ),
        provider,
      ];
      const activatesProvider = !configuration.selection;
      const updatesActiveProvider =
        configuration.selection?.providerId === provider.id;
      const providerModel = provider.models[0];
      if (!providerModel) {
        throw new Error("A provider connection must include a model.");
      }
      const selectedProviderModel = updatesActiveProvider
        ? provider.models.find(
            (model) => model.id === configuration.selection?.modelId,
          )
        : undefined;
      const effectiveProviderModel = selectedProviderModel ?? providerModel;
      const preserveUltraMode =
        effectiveProviderModel.reasoning &&
        Boolean(selectedProviderModel && configuration.selection?.ultraMode);
      const providerSelection: ModelSelection = {
        providerId: provider.id,
        modelId: effectiveProviderModel.id,
        thinkingLevel: effectiveProviderModel.reasoning
          ? preserveUltraMode
            ? "high"
            : (selectedProviderModel &&
                configuration.selection?.thinkingLevel) ||
              "medium"
          : "off",
        ...(preserveUltraMode ? { ultraMode: true } : {}),
      };
      const providerContextWindow =
        updatesActiveProvider && selectedProviderModel
          ? Math.min(
              configuration.contextWindow ??
                effectiveProviderModel.contextWindow,
              effectiveProviderModel.contextWindow,
            )
          : effectiveProviderModel.contextWindow;
      if (activatesProvider || updatesActiveProvider) {
        configuration.selection = providerSelection;
        configuration.contextWindow = providerContextWindow;
      }
      if (apiKey) {
        configuration.credentials[provider.id] = {
          type: "api_key",
          key: apiKey,
        };
      }
      await applyAgentRuntime(configuration);
      await services.settingsStore.saveProviderConnection(provider, apiKey);
      if (activatesProvider || updatesActiveProvider) {
        await services.settingsStore.setModel(
          providerSelection,
          providerContextWindow,
        );
      }
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.settingsProviderDelete,
    async (_event, providerIdInput: string): Promise<SettingsSnapshot> => {
      if (!services.settingsStore) {
        throw new Error("Agent settings are not ready.");
      }
      const providerId =
        typeof providerIdInput === "string" ? providerIdInput.trim() : "";
      const provider = (
        await services.settingsStore.providerConnections()
      ).find((candidate) => candidate.id === providerId);
      if (!provider) {
        throw new Error("Provider connection was not found.");
      }
      const referencingThreads = (services.store?.listThreads() ?? []).filter(
        (thread) => thread.modelSelection?.providerId === provider.id,
      );

      const configuration = await services.settingsStore.runtimeConfiguration();
      configuration.providers = (configuration.providers ?? []).filter(
        (candidate) => candidate.id !== provider.id,
      );
      delete configuration.credentials[provider.id];

      const deletesActiveProvider =
        configuration.selection?.providerId === provider.id;
      if (
        (deletesActiveProvider || referencingThreads.length > 0) &&
        activeTurns.size > 0
      ) {
        throw new Error("Stop the active turn before deleting its provider.");
      }
      let replacement:
        { selection: ModelSelection; contextWindow: number } | undefined;
      if (deletesActiveProvider || referencingThreads.length > 0) {
        const fallbackProvider = configuration.providers.find(
          (candidate) => candidate.models.length > 0,
        );
        const fallbackProviderModel = fallbackProvider?.models[0];
        if (fallbackProvider && fallbackProviderModel) {
          replacement = {
            selection: {
              providerId: fallbackProvider.id,
              modelId: fallbackProviderModel.id,
              thinkingLevel: fallbackProviderModel.reasoning ? "medium" : "off",
            },
            contextWindow: fallbackProviderModel.contextWindow,
          };
        } else {
          const snapshot = await getSettingsSnapshot();
          const fallbackAddedModel = snapshot.addedModels.find(
            (candidate) =>
              candidate.providerId !== provider.id &&
              snapshot.models.some(
                (model) =>
                  model.providerId === candidate.providerId &&
                  model.modelId === candidate.modelId &&
                  (model.configured ||
                    Boolean(configuration.credentials[model.providerId])),
              ),
          );
          const fallbackCatalogModel = fallbackAddedModel
            ? snapshot.models.find(
                (model) =>
                  model.providerId === fallbackAddedModel.providerId &&
                  model.modelId === fallbackAddedModel.modelId,
              )
            : undefined;
          if (fallbackAddedModel && fallbackCatalogModel) {
            replacement = {
              selection: {
                providerId: fallbackAddedModel.providerId,
                modelId: fallbackAddedModel.modelId,
                thinkingLevel: fallbackCatalogModel.reasoning
                  ? "medium"
                  : "off",
              },
              contextWindow: Math.min(
                fallbackAddedModel.contextWindow,
                fallbackCatalogModel.contextWindow,
              ),
            };
          }
        }
      }

      if (deletesActiveProvider) {
        if (replacement) {
          configuration.selection = replacement.selection;
          configuration.contextWindow = replacement.contextWindow;
        } else {
          delete configuration.selection;
          delete configuration.contextWindow;
        }
      }
      if (
        referencingThreads.length > 0 ||
        (deletesActiveProvider && !replacement)
      ) {
        await resetAgentThreadsForToolChange();
      }

      await applyAgentRuntime(configuration);
      await services.settingsStore.deleteProviderConnection(
        provider.id,
        replacement,
      );
      for (const thread of referencingThreads) {
        services.store?.updateThread(thread.id, {
          modelSelection: replacement?.selection ?? null,
          contextWindow: replacement?.contextWindow ?? null,
        });
      }
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.settingsCredentialDelete,
    async (_event, providerId: string): Promise<SettingsSnapshot> => {
      if (!services.settingsStore) {
        throw new Error("Agent settings are not ready.");
      }
      if (
        services.store
          ?.listThreads()
          .some((thread) => thread.modelSelection?.providerId === providerId)
      ) {
        throw new Error(
          "Switch conversations using this provider before deleting its credential.",
        );
      }
      await services.settingsStore.deleteCredential(providerId);
      await applyAgentRuntime();
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.settingsPiImport,
    async (): Promise<
      { imported: number; settings: SettingsSnapshot } | undefined
    > => {
      if (!services.settingsStore || !services.mainWindow) {
        throw new Error("Agent settings are not ready.");
      }
      const selection = await dialog.showOpenDialog(services.mainWindow, {
        properties: ["openFile"],
        title: mainText(currentLocale(), "importPiAuth"),
        defaultPath: join(app.getPath("home"), ".pi", "agent", "auth.json"),
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      const selectedPath = selection.filePaths[0];
      if (selection.canceled || !selectedPath) {
        return undefined;
      }
      const fileInfo = await stat(selectedPath);
      if (!fileInfo.isFile() || fileInfo.size > 2 * 1024 * 1024) {
        throw new Error("Pi auth.json must be a JSON file smaller than 2 MiB.");
      }
      const imported = await services.settingsStore.importPiAuth(
        JSON.parse(await readFile(selectedPath, "utf8")),
      );
      await applyAgentRuntime();
      return { imported, settings: await getSettingsSnapshot() };
    },
  );
}

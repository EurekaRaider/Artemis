import { parseModelKey, modelFormState, modelKey } from "../settings-values.js";

import { type RefObject } from "react";

import type {
  AddedModelConfiguration,
  SettingsSnapshot,
} from "../../../shared/api.js";

interface UseModelActionsContext {
  readonly setSelectedModel: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly models: import("@artemis/protocol").AgentModelInfo[];
  readonly settings: SettingsSnapshot | undefined;
  readonly setContextWindow: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly operationPendingRef: RefObject<boolean>;
  readonly selectedModel: string;
  readonly contextWindowValid: boolean;
  readonly selectedModelCanBeAdded: boolean;
  readonly setBusy: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly setModelApplyResult: import("react").Dispatch<
    import("react").SetStateAction<
      | {
          kind: "success" | "failure";
          title?: string;
          detail: string;
        }
      | undefined
    >
  >;
  readonly parsedContextWindow: number;
  readonly setSettings: import("react").Dispatch<
    import("react").SetStateAction<SettingsSnapshot | undefined>
  >;
  readonly onSettingsChange: (
    settings: SettingsSnapshot,
    options?: {
      refreshThreads?: boolean;
    },
  ) => void;
  readonly t: {
    title: string;
    close: string;
    tabGeneral: string;
    tabProviders: string;
    providerConfigBuiltin: string;
    providerConfigCustom: string;
    tabAgents: string;
    tabCapabilities: string;
    tabMaintenance: string;
    model: string;
    modelSearch: string;
    modelSearchEmpty: string;
    modelUnavailable: string;
    contextWindow: string;
    contextWindowHint: string;
    saveModel: string;
    modelSaved: string;
    modelSaveFailed: string;
    modelSavedDetail: string;
    saveChanges: string;
    modelUpdated: string;
    modelUpdatedDetail: string;
    sharedApiKey: string;
    confirmDelete: string;
    cancel: string;
    addedModels: string;
    noAddedModels: string;
    removeModel: string;
    removeModelConfirm: string;
    removeModelCredentialConfirm: string;
    deleteProviderConfirm: string;
    confirm: string;
    language: string;
    languageSystem: string;
    languageEnglish: string;
    languageChinese: string;
    languageHint: string;
    theme: string;
    themeSystem: string;
    themeLight: string;
    themeDark: string;
    themeHint: string;
    profileAvatar: string;
    profileAvatarUpload: string;
    profileAvatarChange: string;
    profileAvatarRemove: string;
    profileAvatarHint: string;
    customProviders: string;
    provider: string;
    providerName: string;
    baseUrl: string;
    providerApi: string;
    chatCompletionsApi: string;
    responsesApi: string;
    modelId: string;
    modelName: string;
    maxTokens: string;
    reasoningModel: string;
    highestReasoningLevel: string;
    thinkingMinimal: string;
    thinkingLow: string;
    thinkingMedium: string;
    thinkingHigh: string;
    thinkingXHigh: string;
    thinkingMax: string;
    imageInput: string;
    saveProvider: string;
    cancelEdit: string;
    providerHint: string;
    configuredProviders: string;
    noProviders: string;
    apiKey: string;
    optionalApiKey: string;
    storedApiKey: string;
    importPi: string;
    delete: string;
    encrypted: string;
    unavailable: string;
    imported: string;
    loading: string;
    mcp: string;
    addServer: string;
    backToServers: string;
    addMcp: string;
    updateMcp: string;
    newServerHint: string;
    transportChangeHint: string;
    serverId: string;
    serverName: string;
    transport: string;
    endpoint: string;
    launchCommand: string;
    serverUrl: string;
    arguments: string;
    addArgument: string;
    environmentVariables: string;
    environmentKey: string;
    environmentValue: string;
    addEnvironment: string;
    environmentVariablePassthrough: string;
    environmentVariableName: string;
    addEnvironmentVariable: string;
    workspace: string;
    bearer: string;
    authentication: string;
    authNone: string;
    authBearer: string;
    authOAuth: string;
    authorize: string;
    oauthHint: string;
    capabilityAccess: string;
    shellRuntime: string;
    shellRuntimeHint: string;
    windowsShell: string;
    windowsShellAuto: string;
    windowsShellPowerShell7: string;
    windowsShellLegacy: string;
    shellProfileMode: string;
    shellProfileEnvironment: string;
    shellProfileFull: string;
    shellProfileDisabled: string;
    localFullAccess: string;
    localFullAccessDetail: string;
    saveServer: string;
    edit: string;
    uninstall: string;
    reconnect: string;
    tools: string;
    noServers: string;
    extensions: string;
    trustExtension: string;
    noExtensions: string;
    enabled: string;
    extensionNetwork: string;
    retrust: string;
    extensionWarning: string;
    updates: string;
    checkUpdates: string;
    installUpdate: string;
    rollbackReady: string;
    diagnostics: string;
    diagnosticsHint: string;
    exportDiagnostics: string;
    diagnosticsExported: string;
    globalAgents: string;
    globalAgentsHint: string;
    saveGlobalAgents: string;
    agentConcurrency: string;
    agentConcurrencyHint: string;
    concurrencyMode: string;
    concurrencyAutomatic: string;
    concurrencyManual: string;
    concurrencyManualLimit: string;
    concurrencyApply: string;
    concurrencyLogical: string;
    concurrencyConfigured: string;
    concurrencyAutomaticSafe: string;
    concurrencyEffective: string;
    concurrencyActive: string;
    concurrencyQueued: string;
    concurrencyWaiting: string;
    concurrencyHighWarning: string;
    concurrencyHardware: string;
    concurrencyHardwareValue: string;
    concurrencyThrottled: string;
    concurrencyCpu: string;
    concurrencyEventLoop: string;
    concurrencyMemory: string;
    configurationImport: string;
    configurationImportHint: string;
    scanImports: string;
    applyImports: string;
    importInstructions: string;
    importSkills: string;
    importMcp: string;
    detected: string;
    notDetected: string;
    importCompleted: string;
  };
  readonly selectedAddedModel: AddedModelConfiguration | undefined;
  readonly modelDeleteTarget: AddedModelConfiguration | undefined;
  readonly setModelDeleteTarget: import("react").Dispatch<
    import("react").SetStateAction<AddedModelConfiguration | undefined>
  >;
  readonly run: (action: () => Promise<void>) => Promise<void>;
  readonly setSavedModelKey: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
  readonly setEditingModelKey: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
}
export function useModelActions(context: UseModelActionsContext) {
  const {
    setSelectedModel,
    models,
    settings,
    setContextWindow,
    operationPendingRef,
    selectedModel,
    contextWindowValid,
    selectedModelCanBeAdded,
    setBusy,
    setModelApplyResult,
    parsedContextWindow,
    setSettings,
    onSettingsChange,
    t,
    selectedAddedModel,
    modelDeleteTarget,
    setModelDeleteTarget,
    setSavedModelKey,
    setEditingModelKey,
  } = context;
  function selectModel(value: string) {
    const [providerId, modelId] = parseModelKey(value);
    setSelectedModel(value);
    const model = models.find(
      (candidate) =>
        candidate.providerId === providerId && candidate.modelId === modelId,
    );
    if (!model) return;
    const saved = settings?.addedModels.find(
      (candidate) =>
        candidate.providerId === providerId && candidate.modelId === modelId,
    );
    setContextWindow(
      String(
        Math.min(
          saved?.contextWindow ?? model.contextWindow,
          model.contextWindow,
        ),
      ),
    );
  }

  async function addModel() {
    if (
      operationPendingRef.current ||
      !selectedModel ||
      !contextWindowValid ||
      !selectedModelCanBeAdded
    )
      return;
    operationPendingRef.current = true;
    const [selectedProvider, modelId] = parseModelKey(selectedModel);
    setBusy(true);
    setModelApplyResult(undefined);
    try {
      const updated = await window.artemis.addModel(
        {
          providerId: selectedProvider,
          modelId,
          contextWindow: parsedContextWindow,
        },
        undefined,
      );
      setSettings(updated);
      onSettingsChange(updated);
      setModelApplyResult({
        kind: "success",
        title: selectedAddedModel ? t.modelUpdated : t.modelSaved,
        detail: selectedAddedModel ? t.modelUpdatedDetail : t.modelSavedDetail,
      });
    } catch (error) {
      setModelApplyResult({
        kind: "failure",
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      operationPendingRef.current = false;
      setBusy(false);
    }
  }

  async function removeModel() {
    if (!modelDeleteTarget) return;
    await context.run(async () => {
      const updated = await window.artemis.removeModel({
        providerId: modelDeleteTarget.providerId,
        modelId: modelDeleteTarget.modelId,
      });
      setSettings(updated);
      onSettingsChange(updated, { refreshThreads: true });
      setModelDeleteTarget(undefined);
      const modelState = modelFormState(updated);
      setSelectedModel(modelState.selectedModel);
      setContextWindow(modelState.contextWindow);
    });
  }

  async function saveModelEdit(
    model: AddedModelConfiguration,
    apiKey?: string,
  ) {
    if (operationPendingRef.current) return;
    operationPendingRef.current = true;
    setBusy(true);
    try {
      const updated = await window.artemis.addModel(model, apiKey);
      setSettings(updated);
      onSettingsChange(updated);
      const key = modelKey(model.providerId, model.modelId);
      if (selectedModel === key) setContextWindow(String(model.contextWindow));
      setSavedModelKey(key);
      setEditingModelKey(undefined);
    } finally {
      operationPendingRef.current = false;
      setBusy(false);
    }
  }
  return { selectModel, addModel, removeModel, saveModelEdit };
}

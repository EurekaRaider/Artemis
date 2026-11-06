import { type RefObject } from "react";

import type {
  ConfigurationImportCategory,
  ConfigurationImportPreview,
  ConfigurationImportSource,
  SettingsSnapshot,
} from "../../../shared/api.js";

interface UseConfigurationImportActionsContext {
  readonly globalAgentsContent: string;
  readonly setSettings: import("react").Dispatch<
    import("react").SetStateAction<SettingsSnapshot | undefined>
  >;
  readonly setGlobalAgentsContent: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly onSettingsChange: (
    settings: SettingsSnapshot,
    options?: {
      refreshThreads?: boolean;
    },
  ) => void;
  readonly setImportPreview: import("react").Dispatch<
    import("react").SetStateAction<ConfigurationImportPreview | undefined>
  >;
  readonly setImportSources: import("react").Dispatch<
    import("react").SetStateAction<ConfigurationImportSource[]>
  >;
  readonly importSources: ConfigurationImportSource[];
  readonly importCategories: ConfigurationImportCategory[];
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
  readonly setMessage: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setImportCategories: import("react").Dispatch<
    import("react").SetStateAction<ConfigurationImportCategory[]>
  >;
  readonly operationPendingRef: RefObject<boolean>;
  readonly setBusy: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
}
export function useConfigurationImportActions(
  context: UseConfigurationImportActionsContext,
) {
  const {
    globalAgentsContent,
    setSettings,
    setGlobalAgentsContent,
    onSettingsChange,
    setImportPreview,
    setImportSources,
    importSources,
    importCategories,
    t,
    setMessage,
    setImportCategories,
    operationPendingRef,
    setBusy,
  } = context;
  async function saveGlobalAgents() {
    await run(async () => {
      const updated =
        await window.artemis.saveGlobalAgents(globalAgentsContent);
      setSettings(updated);
      setGlobalAgentsContent(updated.globalAgents.content);
      onSettingsChange(updated);
    });
  }

  async function scanConfigurationImports() {
    await run(async () => {
      const preview = await window.artemis.scanConfigurationImports();
      setImportPreview(preview);
      setImportSources(
        preview.sources
          .filter((source) => source.detected)
          .map((source) => source.source),
      );
    });
  }

  async function importConfiguration() {
    await run(async () => {
      const result = await window.artemis.importConfiguration({
        sources: importSources,
        categories: importCategories,
      });
      setSettings(result.settings);
      setGlobalAgentsContent(result.settings.globalAgents.content);
      onSettingsChange(result.settings);
      setMessage(
        `${t.importCompleted}: ${Object.values(result.summary.imported).reduce(
          (total, count) => total + count,
          0,
        )}`,
      );
      setImportPreview(await window.artemis.scanConfigurationImports());
    });
  }

  function toggleImportSource(
    source: ConfigurationImportSource,
    selected: boolean,
  ) {
    setImportSources((current) =>
      selected
        ? [...new Set([...current, source])]
        : current.filter((candidate) => candidate !== source),
    );
  }

  function toggleImportCategory(
    category: ConfigurationImportCategory,
    selected: boolean,
  ) {
    setImportCategories((current) =>
      selected
        ? [...new Set([...current, category])]
        : current.filter((candidate) => candidate !== category),
    );
  }

  async function run(action: () => Promise<void>) {
    if (operationPendingRef.current) return;
    operationPendingRef.current = true;
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      operationPendingRef.current = false;
      setBusy(false);
    }
  }
  return {
    saveGlobalAgents,
    scanConfigurationImports,
    importConfiguration,
    toggleImportSource,
    toggleImportCategory,
    run,
  };
}

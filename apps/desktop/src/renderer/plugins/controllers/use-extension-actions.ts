import { type ManagementTab } from "../resource-types.js";

interface UseExtensionActionsContext {
  readonly setBusyId: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
  readonly setMessage: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
  readonly onSettingsChange: (
    settings: import("../../../shared/api.js").SettingsSnapshot,
  ) => void;
  readonly setMode: import("react").Dispatch<
    import("react").SetStateAction<
      "marketplace" | "manage" | "add-plugin" | "mcp-editor"
    >
  >;
  readonly setManagementTab: import("react").Dispatch<
    import("react").SetStateAction<ManagementTab>
  >;
  readonly t: {
    title: string;
    marketDescription: string;
    manageDescription: string;
    plugins: string;
    connectors: string;
    mcp: string;
    skills: string;
    public: string;
    local: string;
    marketplaces: string;
    manageMarketplaces: string;
    marketplaceSource: string;
    marketplaceRemoved: string;
    marketplaceStale: string;
    removeMarketplace: string;
    confirmRemoveMarketplace: string;
    moveMarketplaceUp: string;
    moveMarketplaceDown: string;
    skillConflict: string;
    featured: string;
    installed: string;
    manage: string;
    backToMarketplace: string;
    refresh: string;
    add: string;
    addPlugin: string;
    addPluginDescription: string;
    backToPlugins: string;
    localPlugin: string;
    executableExtension: string;
    executableExtensionHint: string;
    trustExtension: string;
    extensionNetwork: string;
    retrust: string;
    extensionChanged: string;
    addConnector: string;
    addMcp: string;
    addSkill: string;
    browseOfficialMcp: string;
    browseSkills: string;
    searchPlugins: string;
    searchInstalled: string;
    searchMcp: string;
    searchSkills: string;
    searchingMcp: string;
    searchingSkills: string;
    gitMarketplace: string;
    gitMarketplaceHint: string;
    offlineMarketplace: string;
    offlineMarketplaceHint: string;
    importOfflineMarketplace: string;
    offline: string;
    loadMarketplace: string;
    openOfficialMarketplace: string;
    publicMarketplace: string;
    bundledPlugins: string;
    inspectLocalPlugin: string;
    installLocalSkill: string;
    installRequiredDocuments: string;
    requiredDocumentsDescription: string;
    confirmRequiredDocuments: string;
    install: string;
    configureInstall: string;
    installMcpTitle: string;
    installMcpMethod: string;
    installMcpCredentialHint: string;
    installMcpLocalWarning: string;
    optional: string;
    cancel: string;
    installedLabel: string;
    installing: string;
    update: string;
    remove: string;
    removeMcpAction: string;
    enabled: string;
    disabled: string;
    connected: string;
    tools: string;
    source: string;
    noMarketplaceResults: string;
    noPlugins: string;
    noConnectors: string;
    noMcp: string;
    noSkills: string;
    noCatalogResults: string;
    noMcpCatalogResults: string;
    noSkillCatalogResults: string;
    needsSetup: string;
    thirdParty: string;
    confirmMcp: string;
    confirmSkill: string;
    confirmPlugin: string;
    confirmUpdatePlugin: string;
    confirmRemovePlugin: string;
    confirmRemoveMcp: string;
    confirmRemoveConnector: string;
    confirmRemoveSkill: string;
    confirmRemoveExtension: string;
    installedNow: string;
    removedNow: string;
    pluginWarnings: string;
    mcpSaved: string;
    mcpRemoved: string;
    pluginEnabled: string;
    pluginDisabled: string;
    supported: string;
    unsupported: string;
    skillsCount: string;
    mcpCount: string;
    appsCount: string;
    mcpDisabled: string;
    managedByPlugin: string;
    connectorName: string;
    connectorUrl: string;
    connectorAuth: string;
    connectorBearer: string;
    connectorHelp: string;
    configure: string;
    authorize: string;
    saveConnector: string;
    standalone: string;
    fromPlugins: string;
    allResults: string;
  };
  readonly onConfirm: (
    message: string,
    tone?: "default" | "danger",
    options?: {
      title?: string;
      acceptLabel?: string;
    },
  ) => Promise<boolean>;
}
export function useExtensionActions(context: UseExtensionActionsContext) {
  const {
    setBusyId,
    setMessage,
    onSettingsChange,
    setMode,
    setManagementTab,
    t,
    onConfirm,
  } = context;
  async function trustExtension() {
    setBusyId("extension:new");
    setMessage(undefined);
    try {
      const next = await window.artemis.trustExtension();
      if (!next) return;
      onSettingsChange(next);
      setMode("manage");
      setManagementTab("plugins");
      setMessage(t.installedNow);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(undefined);
    }
  }

  async function setExtensionEnabled(extensionId: string, enabled: boolean) {
    setMessage(undefined);
    try {
      onSettingsChange(
        await window.artemis.setTrustedExtensionEnabled(extensionId, enabled),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function setExtensionNetwork(
    extensionId: string,
    allowNetwork: boolean,
  ) {
    setBusyId(extensionId);
    setMessage(undefined);
    try {
      onSettingsChange(
        await window.artemis.setTrustedExtensionNetwork(
          extensionId,
          allowNetwork,
        ),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(undefined);
    }
  }

  async function retrustExtension(extensionId: string) {
    setBusyId(extensionId);
    setMessage(undefined);
    try {
      onSettingsChange(await window.artemis.retrustExtension(extensionId));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(undefined);
    }
  }

  async function removeExtension(extensionId: string) {
    if (!(await onConfirm(t.confirmRemoveExtension, "danger"))) return;
    setBusyId(extensionId);
    setMessage(undefined);
    try {
      onSettingsChange(
        await window.artemis.removeTrustedExtension(extensionId),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(undefined);
    }
  }
  return {
    trustExtension,
    setExtensionEnabled,
    setExtensionNetwork,
    retrustExtension,
    removeExtension,
  };
}

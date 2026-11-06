import { resourceCache } from "../resource-cache.js";

import type {
  ArtemisPluginMarketplaceState,
  ArtemisPluginMutationResult,
  ArtemisPluginPreview,
  InstalledArtemisPlugin,
  InstalledSkill,
  McpServerStatus,
  ResourceInstallProgress,
} from "../../../shared/api.js";

interface UsePluginActionsContext {
  readonly setInstalledPlugins: import("react").Dispatch<
    import("react").SetStateAction<InstalledArtemisPlugin[]>
  >;
  readonly setInstalledSkills: import("react").Dispatch<
    import("react").SetStateAction<InstalledSkill[]>
  >;
  readonly setMcpServers: import("react").Dispatch<
    import("react").SetStateAction<McpServerStatus[]>
  >;
  readonly onSettingsChange: (
    settings: import("../../../shared/api.js").SettingsSnapshot,
  ) => void;
  readonly setMessage: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
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
  readonly setBusyId: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
  readonly applyMarketplaceState: (next: ArtemisPluginMarketplaceState) => void;
  readonly setMode: import("react").Dispatch<
    import("react").SetStateAction<
      "marketplace" | "manage" | "add-plugin" | "mcp-editor"
    >
  >;
  readonly pluginSkillConflict: (
    plugin: ArtemisPluginPreview,
  ) => string | undefined;
  readonly pluginDisplayName: (plugin: ArtemisPluginPreview) => string;
  readonly beginInstallation: (
    kind: ResourceInstallProgress["kind"],
    resourceId: string,
  ) => string;
  readonly setConnectionPlugin: import("react").Dispatch<
    import("react").SetStateAction<InstalledArtemisPlugin | undefined>
  >;
  readonly setInstallProgress: import("react").Dispatch<
    import("react").SetStateAction<ResourceInstallProgress | undefined>
  >;
  readonly onConfirm: (
    message: string,
    tone?: "default" | "danger",
    options?: {
      title?: string;
      acceptLabel?: string;
    },
  ) => Promise<boolean>;
}
export function usePluginActions(context: UsePluginActionsContext) {
  const {
    setInstalledPlugins,
    setInstalledSkills,
    setMcpServers,
    onSettingsChange,
    setMessage,
    t,
    setBusyId,
    applyMarketplaceState,
    setMode,
    beginInstallation,
    setConnectionPlugin,
    setInstallProgress,
    onConfirm,
  } = context;
  function applyPluginMutation(
    result: ArtemisPluginMutationResult,
    successMessage: string = t.installedNow,
  ): void {
    resourceCache.installedPluginsCache = result.plugins;
    resourceCache.installedSkillsCache = result.skills;
    setInstalledPlugins(result.plugins);
    setInstalledSkills(result.skills);
    setMcpServers(result.settings.mcpServers);
    onSettingsChange(result.settings);
    setMessage(
      result.warnings.length ? result.warnings.join("\n") : successMessage,
    );
  }

  async function inspectLocalPlugin() {
    setBusyId("local-plugin");
    setMessage(undefined);
    try {
      const preview = await window.artemis.inspectLocalArtemisPlugin();
      if (!preview) return;
      applyMarketplaceState(
        await window.artemis.selectArtemisPluginMarketplace("local"),
      );
      if (await installPlugin(preview)) setMode("marketplace");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(undefined);
    }
  }

  async function installPlugin(plugin: ArtemisPluginPreview): Promise<boolean> {
    const conflict = context.pluginSkillConflict(plugin);
    if (conflict) {
      setMessage(conflict);
      return false;
    }
    if (!plugin.installable) {
      setMessage(
        plugin.unsupported.join(", ") ||
          plugin.warnings.join(" · ") ||
          t.needsSetup,
      );
      return false;
    }
    const operationId = beginInstallation(
      "plugin",
      context.pluginDisplayName(plugin),
    );
    setBusyId(plugin.id);
    setMessage(undefined);
    try {
      const result = await window.artemis.installArtemisPlugin(
        plugin.source,
        operationId,
      );
      applyPluginMutation(result);
      const installed = result.plugins.find((entry) => entry.id === plugin.id);
      if (
        installed &&
        result.settings.mcpServers.some(
          (server) =>
            server.config.connector &&
            installed.mcpServerIds.includes(server.config.id),
        )
      )
        setConnectionPlugin(installed);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setBusyId(undefined);
      setInstallProgress(undefined);
    }
  }

  async function updatePlugin(plugin: InstalledArtemisPlugin) {
    if (!(await onConfirm(t.confirmUpdatePlugin))) return;
    const operationId = beginInstallation(
      "plugin",
      context.pluginDisplayName(plugin),
    );
    setBusyId(plugin.id);
    setMessage(undefined);
    try {
      const result = await window.artemis.updateArtemisPlugin(
        plugin.id,
        operationId,
      );
      applyPluginMutation(result);
      const updated = result.plugins.find((entry) => entry.id === plugin.id);
      if (
        updated &&
        result.settings.mcpServers.some(
          (server) =>
            server.config.connector &&
            !server.config.enabled &&
            updated.mcpServerIds.includes(server.config.id),
        )
      )
        setConnectionPlugin(updated);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(undefined);
      setInstallProgress(undefined);
    }
  }

  async function setPluginEnabled(
    plugin: InstalledArtemisPlugin,
    enabled: boolean,
  ) {
    setMessage(undefined);
    try {
      applyPluginMutation(
        await window.artemis.setArtemisPluginEnabled(plugin.id, enabled),
        enabled ? t.pluginEnabled : t.pluginDisabled,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function removePlugin(plugin: InstalledArtemisPlugin) {
    setBusyId(plugin.id);
    setMessage(undefined);
    try {
      applyPluginMutation(
        await window.artemis.removeArtemisPlugin(plugin.id),
        t.removedNow,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(undefined);
    }
  }
  return {
    inspectLocalPlugin,
    installPlugin,
    updatePlugin,
    setPluginEnabled,
    removePlugin,
  };
}

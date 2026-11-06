import { resourceCache } from "../resource-cache.js";

import { type McpInstallDraft, type ManagementTab } from "../resource-types.js";

import type {
  InstalledSkill,
  McpCatalogInstallOption,
  McpCatalogItem,
  McpServerStatus,
  ResourceInstallProgress,
  SkillCatalogItem,
} from "../../../shared/api.js";

interface UseResourceInstallActionsContext {
  readonly beginInstallation: (
    kind: ResourceInstallProgress["kind"],
    resourceId: string,
  ) => string;
  readonly setBusyId: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
  readonly setMcpInstallDraft: import("react").Dispatch<
    import("react").SetStateAction<McpInstallDraft | undefined>
  >;
  readonly setMessage: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
  readonly setMcpServers: import("react").Dispatch<
    import("react").SetStateAction<McpServerStatus[]>
  >;
  readonly onSettingsChange: (
    settings: import("../../../shared/api.js").SettingsSnapshot,
  ) => void;
  readonly setMcpResults: import("react").Dispatch<
    import("react").SetStateAction<McpCatalogItem[]>
  >;
  readonly setInstallProgress: import("react").Dispatch<
    import("react").SetStateAction<ResourceInstallProgress | undefined>
  >;
  readonly focusCatalogSearch: () => void;
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
  readonly mcpInstallDraft: McpInstallDraft | undefined;
  readonly installedSkills: InstalledSkill[];
  readonly setInstalledSkills: import("react").Dispatch<
    import("react").SetStateAction<InstalledSkill[]>
  >;
  readonly setSkillResults: import("react").Dispatch<
    import("react").SetStateAction<SkillCatalogItem[]>
  >;
  readonly setMode: import("react").Dispatch<
    import("react").SetStateAction<
      "marketplace" | "manage" | "add-plugin" | "mcp-editor"
    >
  >;
  readonly setManagementTab: import("react").Dispatch<
    import("react").SetStateAction<ManagementTab>
  >;
}
export function useResourceInstallActions(
  context: UseResourceInstallActionsContext,
) {
  const {
    beginInstallation,
    setBusyId,
    setMcpInstallDraft,
    setMessage,
    setMcpServers,
    onSettingsChange,
    setMcpResults,
    setInstallProgress,
    focusCatalogSearch,
    t,
    onConfirm,
    mcpInstallDraft,
    installedSkills,
    setInstalledSkills,
    setSkillResults,
    setMode,
    setManagementTab,
  } = context;
  async function executeMcpInstall(
    item: McpCatalogItem,
    option: McpCatalogInstallOption,
    inputValues: Record<string, string>,
  ) {
    const operationId = beginInstallation("mcp", item.title);
    setBusyId(item.configId);
    setMcpInstallDraft(undefined);
    setMessage(undefined);
    try {
      const next = await window.artemis.installMcpCatalog({
        registryName: item.registryName,
        version: item.version,
        optionId: option.id,
        inputValues,
        operationId,
      });
      setMcpServers(next.mcpServers);
      onSettingsChange(next);
      setMcpResults((current) =>
        current.map((candidate) =>
          candidate.configId === item.configId
            ? { ...candidate, installed: true }
            : candidate,
        ),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(undefined);
      setInstallProgress(undefined);
      focusCatalogSearch();
    }
  }

  async function installMcp(item: McpCatalogItem) {
    const option = item.installOption;
    if (!item.installable || !option) return;
    if (option.inputs.length > 0) {
      setMcpInstallDraft({
        item,
        option,
        values: Object.fromEntries(
          option.inputs.flatMap((field) =>
            field.defaultValue ? [[field.id, field.defaultValue]] : [],
          ),
        ),
      });
      return;
    }
    if (!(await onConfirm(t.confirmMcp))) return;
    await executeMcpInstall(item, option, {});
  }

  async function submitMcpInstall(): Promise<void> {
    if (!mcpInstallDraft) return;
    await executeMcpInstall(
      mcpInstallDraft.item,
      mcpInstallDraft.option,
      mcpInstallDraft.values,
    );
  }

  async function installSkill(item: SkillCatalogItem) {
    if (!(await onConfirm(t.confirmSkill))) return;
    const operationId = beginInstallation("skill", item.name);
    setBusyId(item.id);
    setMessage(undefined);
    try {
      const installed = await window.artemis.installSkillCatalog(
        item.id,
        operationId,
      );
      resourceCache.installedSkillsCache = [
        ...installedSkills.filter((skill) => skill.id !== installed.id),
        installed,
      ].sort((left, right) => left.name.localeCompare(right.name));
      setInstalledSkills(resourceCache.installedSkillsCache);
      setSkillResults((current) =>
        current.map((candidate) =>
          candidate.id === item.id
            ? { ...candidate, installed: true }
            : candidate,
        ),
      );
      setMessage(t.installedNow);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(undefined);
      setInstallProgress(undefined);
      focusCatalogSearch();
    }
  }

  async function installLocalSkill() {
    const operationId = beginInstallation("skill", t.installLocalSkill);
    setBusyId("local-skill");
    setMessage(undefined);
    try {
      const installed = await window.artemis.installLocalSkill(operationId);
      if (!installed) return;
      resourceCache.installedSkillsCache =
        await window.artemis.listInstalledSkills();
      setInstalledSkills(resourceCache.installedSkillsCache);
      setMode("manage");
      setManagementTab("skills");
      setMessage(t.installedNow);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(undefined);
      setInstallProgress(undefined);
      focusCatalogSearch();
    }
  }

  async function setMcpEnabled(serverId: string, enabled: boolean) {
    setMessage(undefined);
    try {
      const next = await window.artemis.setMcpServerEnabled(serverId, enabled);
      setMcpServers(next.mcpServers);
      onSettingsChange(next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function authorizeAdvancedMcp(serverId: string) {
    setBusyId(serverId);
    setMessage(undefined);
    try {
      const next = await window.artemis.authorizeMcpServer(serverId);
      setMcpServers(next.mcpServers);
      onSettingsChange(next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(undefined);
    }
  }

  async function removeMcp(serverId: string) {
    setBusyId(serverId);
    setMessage(undefined);
    try {
      const next = await window.artemis.removeMcpServer(serverId);
      setMcpServers(next.mcpServers);
      onSettingsChange(next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(undefined);
      focusCatalogSearch();
    }
  }

  async function setSkillEnabled(skillId: string, enabled: boolean) {
    setMessage(undefined);
    try {
      resourceCache.installedSkillsCache = await window.artemis.setSkillEnabled(
        skillId,
        enabled,
      );
      setInstalledSkills(resourceCache.installedSkillsCache);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function removeSkill(skill: InstalledSkill) {
    setBusyId(skill.id);
    setMessage(undefined);
    try {
      resourceCache.installedSkillsCache = await window.artemis.removeSkill(
        skill.id,
      );
      setInstalledSkills(resourceCache.installedSkillsCache);
      setSkillResults((current) =>
        current.map((candidate) =>
          candidate.id === skill.id
            ? { ...candidate, installed: false }
            : candidate,
        ),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(undefined);
      focusCatalogSearch();
    }
  }
  return {
    installMcp,
    submitMcpInstall,
    installSkill,
    installLocalSkill,
    setMcpEnabled,
    removeMcp,
    setSkillEnabled,
    removeSkill,
  };
}

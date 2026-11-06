import {
  type ManagementTab,
  type CatalogSearchTab,
  type CatalogSearchPhase,
} from "../resource-types.js";

import { uiText } from "../../../shared/i18n/ui-text.js";

import type {
  ArtemisPluginMarketplaceSource,
  ArtemisPluginMarketplaceState,
  McpCatalogItem,
  ResourceInstallProgress,
  SkillCatalogItem,
} from "../../../shared/api.js";

interface UseMarketplaceActionsContext {
  readonly marketplaceState: ArtemisPluginMarketplaceState | undefined;
  readonly searching: boolean;
  readonly installProgress: ResourceInstallProgress | undefined;
  readonly beginInstallation: (
    kind: ResourceInstallProgress["kind"],
    resourceId: string,
  ) => string;
  readonly setSearching: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly setMessage: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
  readonly applyMarketplaceState: (next: ArtemisPluginMarketplaceState) => void;
  readonly setInstallProgress: import("react").Dispatch<
    import("react").SetStateAction<ResourceInstallProgress | undefined>
  >;
  readonly sourceInput: string;
  readonly locale:
    | "ar"
    | "de"
    | "en"
    | "es"
    | "fr"
    | "hi"
    | "id"
    | "it"
    | "ja"
    | "ko"
    | "pt-BR"
    | "ru"
    | "zh-CN"
    | "zh-TW";
  readonly onConfirm: (
    message: string,
    tone?: "default" | "danger",
    options?: {
      title?: string;
      acceptLabel?: string;
    },
  ) => Promise<boolean>;
  readonly setSourceInput: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setMode: import("react").Dispatch<
    import("react").SetStateAction<
      "marketplace" | "manage" | "add-plugin" | "mcp-editor"
    >
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
  readonly catalogQuery: string;
  readonly managementTab: ManagementTab;
  readonly setCatalogSearchPhase: import("react").Dispatch<
    import("react").SetStateAction<Record<CatalogSearchTab, CatalogSearchPhase>>
  >;
  readonly setSkillResults: import("react").Dispatch<
    import("react").SetStateAction<SkillCatalogItem[]>
  >;
  readonly setMcpResults: import("react").Dispatch<
    import("react").SetStateAction<McpCatalogItem[]>
  >;
}
export function useMarketplaceActions(context: UseMarketplaceActionsContext) {
  const {
    marketplaceState,
    searching,
    installProgress,
    beginInstallation,
    setSearching,
    setMessage,
    applyMarketplaceState,
    setInstallProgress,
    sourceInput,
    locale,
    onConfirm,
    setSourceInput,
    setMode,
    t,
    setBusyId,
    catalogQuery,
    managementTab,
    setCatalogSearchPhase,
    setSkillResults,
    setMcpResults,
  } = context;
  async function refreshSelectedMarketplace(): Promise<void> {
    const sourceId = marketplaceState?.selectedView;
    const source = marketplaceState?.sources.find(
      (candidate) => candidate.id === sourceId,
    );
    if (
      !sourceId ||
      sourceId === "local" ||
      source?.builtIn ||
      source?.refreshable === false ||
      searching ||
      installProgress
    ) {
      return;
    }
    const operationId = beginInstallation(
      "plugin",
      source?.displayName ?? sourceId,
    );
    setSearching(true);
    setMessage(undefined);
    try {
      applyMarketplaceState(
        await window.artemis.refreshArtemisPluginMarketplace(
          sourceId,
          operationId,
        ),
      );
    } catch (error) {
      try {
        applyMarketplaceState(
          await window.artemis.getArtemisPluginMarketplaces(),
        );
      } catch {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setSearching(false);
      setInstallProgress(undefined);
    }
  }

  async function selectMarketplace(sourceId: string): Promise<void> {
    if (sourceId === marketplaceState?.selectedView || searching) return;
    setSearching(true);
    setMessage(undefined);
    try {
      applyMarketplaceState(
        await window.artemis.selectArtemisPluginMarketplace(sourceId),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSearching(false);
    }
  }

  async function addCustomMarketplace() {
    if (!sourceInput.trim() || searching) return;
    const operationId = beginInstallation("plugin", sourceInput.trim());
    setSearching(true);
    setMessage(undefined);
    try {
      const trust = await window.artemis.inspectArtemisPluginMarketplaceTrust(
        sourceInput.trim(),
      );
      const trustMessage = trust.signed
        ? uiText(locale, "ResourceCenter.inline3", {
            value1: trust.repository,
            value2: String(trust.signingKeyFingerprint),
          })
        : uiText(locale, "ResourceCenter.inline2", {
            value1: trust.repository,
          });
      if (!(await onConfirm(trustMessage))) return;
      applyMarketplaceState(
        await window.artemis.addArtemisPluginMarketplace(
          sourceInput.trim(),
          operationId,
          trust.signingKeyFingerprint,
        ),
      );
      setSourceInput("");
      setMode("marketplace");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSearching(false);
      setInstallProgress(undefined);
    }
  }

  async function importOfflineMarketplace(): Promise<void> {
    if (searching || installProgress) return;
    setSearching(true);
    setMessage(undefined);
    try {
      const inspected =
        await window.artemis.inspectOfflineArtemisPluginMarketplace();
      if (!inspected) return;
      const { trust } = inspected;
      const trustMessage = uiText(locale, "ResourceCenter.inline4", {
        value1: trust.repository,
        value2: String(trust.signingKeyFingerprint),
      });
      if (!(await onConfirm(trustMessage))) return;
      const operationId = beginInstallation("plugin", trust.displayName);
      applyMarketplaceState(
        await window.artemis.addOfflineArtemisPluginMarketplace(
          inspected.path,
          operationId,
          trust.signingKeyFingerprint ?? "",
        ),
      );
      setMode("marketplace");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSearching(false);
      setInstallProgress(undefined);
    }
  }

  async function removeMarketplace(
    source: ArtemisPluginMarketplaceSource,
  ): Promise<void> {
    if (
      !source.removable ||
      !(await onConfirm(t.confirmRemoveMarketplace, "danger"))
    ) {
      return;
    }
    setBusyId(`marketplace:${source.id}`);
    setMessage(undefined);
    try {
      applyMarketplaceState(
        await window.artemis.removeArtemisPluginMarketplace(source.id),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(undefined);
    }
  }

  async function reorderMarketplace(
    sourceId: string,
    destination: number,
  ): Promise<void> {
    const sourceIds = (marketplaceState?.sources ?? [])
      .filter((source) => !source.builtIn)
      .map((source) => source.id);
    const index = sourceIds.indexOf(sourceId);
    if (
      index < 0 ||
      destination < 0 ||
      destination >= sourceIds.length ||
      index === destination
    )
      return;
    const [moved] = sourceIds.splice(index, 1);
    sourceIds.splice(destination, 0, moved!);
    setBusyId(`marketplace:${sourceId}`);
    setMessage(undefined);
    try {
      applyMarketplaceState(
        await window.artemis.reorderArtemisPluginMarketplaces(sourceIds),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(undefined);
    }
  }

  async function searchCatalog() {
    if (
      !catalogQuery.trim() ||
      searching ||
      (managementTab !== "mcp" && managementTab !== "skills")
    ) {
      return;
    }
    const searchTab = managementTab;
    setSearching(true);
    setMessage(undefined);
    setCatalogSearchPhase((current) => ({
      ...current,
      [searchTab]: "searching",
    }));
    if (searchTab === "mcp") setMcpResults([]);
    else setSkillResults([]);
    try {
      if (searchTab === "mcp") {
        setMcpResults(await window.artemis.searchMcpCatalog(catalogQuery));
      } else {
        setSkillResults(await window.artemis.searchSkillCatalog(catalogQuery));
      }
      setCatalogSearchPhase((current) => ({
        ...current,
        [searchTab]: "complete",
      }));
    } catch (error) {
      setCatalogSearchPhase((current) => ({
        ...current,
        [searchTab]: "idle",
      }));
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSearching(false);
    }
  }
  return {
    refreshSelectedMarketplace,
    selectMarketplace,
    addCustomMarketplace,
    importOfflineMarketplace,
    removeMarketplace,
    reorderMarketplace,
    searchCatalog,
  };
}

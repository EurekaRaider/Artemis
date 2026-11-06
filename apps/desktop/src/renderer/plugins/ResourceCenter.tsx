import { createResourceDialogRenderers } from "./resource-dialog-renderers.js";
import { createCapabilityCardRenderers } from "./capability-card-renderers.js";
import { createPluginCardRenderers } from "./plugin-card-renderers.js";
import {
  isLegacyOfficePlugin,
  pluginPageText,
  labels,
  CatalogIcon,
  GearIcon,
  RefreshIcon,
  PlusIcon,
  TrashIcon,
  BackIcon,
  EmptyResource,
  CatalogSearchNotice,
  FEATURED_PLUGINS,
} from "./resource-presentation.js";
import {
  type ResourceCenterProps,
  type McpInstallDraft,
  type ManagementTab,
  type CatalogSearchTab,
  type CatalogSearchPhase,
  type ResourceRemovalDraft,
} from "./resource-types.js";
import designPluginIcon from "../assets/design-plugin-icon.svg";
// Microsoft Fluent UI: https://res-1.cdn.office.net/files/fabric-cdn-prod_20230815.002/assets/brand-icons/product/svg/office_48x1.svg
import officeSuiteIcon from "../assets/office-suite-icon.svg";

import { PluginInstallDialog } from "./PluginInstallDialog.js";

import { designPackCopy } from "../design/design-pack-copy.js";
import { officeCopy } from "../office/office-copy.js";

import {
  localizedPluginText,
  localizedPluginCategory,
} from "../../shared/i18n/plugin-localization.js";

import { statusText } from "../../shared/i18n/status-text.js";
import { uiText } from "../../shared/i18n/ui-text.js";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import type { CapabilityPackStatus } from "@artemis/protocol";
import { Button, IconButton } from "@artemis/ui/actions";
import { Dialog, InlineNotice } from "@artemis/ui/feedback";
import { SearchField, Select, Switch, TextField } from "@artemis/ui/forms";
import {
  ManagementCard,
  ManagementHeader,
  ManagementRow,
  ManagementSection,
  ResourceSurface,
} from "@artemis/ui/management";
import { SegmentedControl } from "@artemis/ui/navigation";

import type {
  ArtemisPluginMarketplace,
  ArtemisPluginMarketplaceSource,
  ArtemisPluginMarketplaceState,
  ArtemisPluginMutationResult,
  ArtemisPluginPreview,
  InstalledArtemisPlugin,
  InstalledSkill,
  McpCatalogInstallOption,
  McpCatalogItem,
  McpServerStatus,
  ResourceInstallProgress,
  SkillCatalogItem,
} from "../../shared/api.js";
import { McpServerEditor } from "../mcp/McpServerEditor.js";
import { ArtemisIcon } from "@artemis/ui/icons";
import {
  resourceIconName,
  ResourceAvatar,
  type ResourceIconName,
} from "./resource-icons.js";

let installedSkillsCache: InstalledSkill[] | undefined;
let installedPluginsCache: InstalledArtemisPlugin[] | undefined;
let marketplaceStateCache: ArtemisPluginMarketplaceState | undefined;
let runtimeMarketplaceCache: ArtemisPluginMarketplace | undefined;
let runtimeMarketplaceLoaded = false;

async function loadInstalledSkills(): Promise<InstalledSkill[]> {
  if (!installedSkillsCache) {
    installedSkillsCache = await window.artemis.listInstalledSkills();
  }
  return installedSkillsCache;
}

async function loadInstalledPlugins(): Promise<InstalledArtemisPlugin[]> {
  if (!installedPluginsCache) {
    installedPluginsCache = await window.artemis.listArtemisPlugins();
  }
  return installedPluginsCache;
}

export function ResourceCenter({
  headerActionTarget,
  onReviewHooks,
  locale,
  settings,
  onConfirm,
  onSettingsChange,
}: ResourceCenterProps) {
  const [mode, setMode] = useState<
    "marketplace" | "manage" | "add-plugin" | "mcp-editor"
  >("marketplace");
  const [connectionPlugin, setConnectionPlugin] =
    useState<InstalledArtemisPlugin>();
  const [managementTab, setManagementTab] = useState<ManagementTab>("plugins");
  const [draggingMarketplaceId, setDraggingMarketplaceId] = useState<
    string | undefined
  >(undefined);
  const [addPluginReturnMode, setAddPluginReturnMode] = useState<
    "marketplace" | "manage"
  >("marketplace");
  const [marketplaceQuery, setMarketplaceQuery] = useState("");
  const [allMarkets, setAllMarkets] = useState(true);
  const [managementQuery, setManagementQuery] = useState("");
  const [sourceInput, setSourceInput] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [editingMcpServer, setEditingMcpServer] = useState<McpServerStatus>();
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [mcpResults, setMcpResults] = useState<McpCatalogItem[]>([]);
  const [catalogSearchPhase, setCatalogSearchPhase] = useState<
    Record<CatalogSearchTab, CatalogSearchPhase>
  >({ mcp: "idle", skills: "idle" });
  const [mcpInstallDraft, setMcpInstallDraft] = useState<McpInstallDraft>();
  const [pluginInstallDraft, setPluginInstallDraft] =
    useState<ArtemisPluginPreview>();
  const [officePackStatus, setOfficePackStatus] =
    useState<CapabilityPackStatus>();
  const [computerRuntime, setComputerRuntime] =
    useState<import("@artemis/protocol").ComputerUseRuntimeStatus>();
  const [officeUpdating, setOfficeUpdating] = useState(false);
  const [officeCapabilityActive, setOfficeCapabilityActive] = useState(false);
  const [officeCapabilityOpen, setOfficeCapabilityOpen] = useState(false);
  const [officeCapabilityInstalled, setOfficeCapabilityInstalled] =
    useState<boolean>();
  // 设计插件卡（随应用提供的插件，todo ⑤→④）：状态轮询 + 管理弹窗。
  const [designPackStatus, setDesignPackStatus] =
    useState<CapabilityPackStatus>();
  const designPackInstalled = Boolean(designPackStatus?.versions.length);
  const [designPackOpen, setDesignPackOpen] = useState(false);
  const [pluginUninstallDraft, setPluginUninstallDraft] =
    useState<InstalledArtemisPlugin>();
  const [resourceRemovalDraft, setResourceRemovalDraft] =
    useState<ResourceRemovalDraft>();
  const [mcpServers, setMcpServers] = useState(settings?.mcpServers ?? []);
  const resourceDialogRenderers = createResourceDialogRenderers({
    pluginUninstallDraft,
    pluginDisplayName,
    locale,
    setPluginUninstallDraft,
    removePlugin,
    runResourceOperation,
    resourceRemovalDraft,
    visualForSkill,
    visualForMcp,
    setResourceRemovalDraft,
    removeSkill,
    removeMcp,
    setDesignPackOpen,
    designPackOpen,
    officeCapabilityInstalled,
    setOfficeCapabilityInstalled,
    setOfficeCapabilityOpen,
    officeCapabilityOpen,
    connectionPlugin,
    setConnectionPlugin,
    setMcpServers,
    onSettingsChange,
  });

  const [skillResults, setSkillResults] = useState<SkillCatalogItem[]>([]);
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([]);
  const [marketplaceState, setMarketplaceState] = useState<
    ArtemisPluginMarketplaceState | undefined
  >(marketplaceStateCache);
  const [installedPlugins, setInstalledPlugins] = useState<
    InstalledArtemisPlugin[]
  >([]);
  const localPluginResults = installedPlugins.filter(
    (plugin) => plugin.source.kind === "local",
  );
  const [runtimeMarketplace, setRuntimeMarketplace] = useState<
    ArtemisPluginMarketplace | undefined
  >(runtimeMarketplaceCache);
  const [installProgress, setInstallProgress] =
    useState<ResourceInstallProgress>();
  const [busyId, setBusyId] = useState<string>();
  const [pendingToggleIds, setPendingToggleIds] = useState<Set<string>>(
    new Set(),
  );
  const pendingToggleIdsRef = useRef(new Set<string>());
  const toggleQueueRef = useRef(Promise.resolve());
  const [pendingPackTargets, setPendingPackTargets] = useState<
    Record<string, boolean>
  >({});
  const [operationPending, setOperationPending] = useState(false);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState<string>();
  const catalogSearchRef = useRef<HTMLInputElement>(null);
  const operationPendingRef = useRef(false);
  const t = labels[locale];
  const office = officeCopy(locale);
  const capabilityCardRenderers = createCapabilityCardRenderers({
    officePackStatus,
    officeUpdating,
    setOfficeUpdating,
    setOfficePackStatus,
    setOfficeCapabilityActive,
    setOfficeCapabilityInstalled,
    runResourceOperation,
    office,
    t,
    setOfficeCapabilityOpen,
    locale,
    designPackStatus,
    setDesignPackStatus,
    designPackInstalled,
    operationPending,
    setDesignPackOpen,
  });

  // Older installed receipts may lack dependencies that are present in the
  // current catalog used to render the Office entry buttons.
  const hasOfficePlugins = [
    ...installedPlugins,
    ...(runtimeMarketplace?.plugins ?? []),
    ...localPluginResults,
  ].some((plugin) =>
    plugin.capabilityDependencies?.some(
      (dependency) => dependency.id === "office-core",
    ),
  );

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const status = await window.artemis.computerRuntimeStatus?.();
        if (active) setComputerRuntime(status);
      } catch (error) {
        if (active) setMessage(String(error));
      }
    };
    void window.artemis
      .checkComputerRuntimeUpdates?.()
      .then(refresh)
      .catch(() => {});
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = () =>
      void window.artemis
        .officeCapabilityStatus?.()
        .then((status) => {
          if (active) {
            setOfficePackStatus(status);
            setOfficeCapabilityInstalled(status.versions.length > 0);
            setOfficeCapabilityActive(Boolean(status.activeVersion));
          }
        })
        .catch((error: unknown) => {
          if (active) setMessage(String(error));
        });
    refresh();
    const timer = setInterval(refresh, 1000);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [hasOfficePlugins, officeCapabilityOpen, officeUpdating]);

  useEffect(() => {
    let active = true;
    void window.artemis
      .checkOfficeCapabilityUpdates?.()
      .then(() => window.artemis.officeCapabilityStatus())
      .then((status) => {
        if (active) setOfficePackStatus(status);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Check the signed catalog each time the store opens; polling only reads status.
  useEffect(() => {
    let active = true;
    void window.artemis
      .checkDesignCapabilityUpdates?.()
      .then(() => window.artemis.designCapabilityStatus())
      .then((status) => {
        if (active) setDesignPackStatus(status);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // 设计插件状态轮询：轻量本地 IPC，跟随窗口焦点刷新。
  useEffect(() => {
    let active = true;
    const refresh = () =>
      void window.artemis
        .designCapabilityStatus?.()
        .then((status) => {
          if (active) setDesignPackStatus(status);
        })
        .catch(() => {});
    refresh();
    const timer = setInterval(refresh, 1000);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [designPackOpen]);

  useEffect(() => {
    let mounted = true;
    void window.artemis
      .listMcpServers()
      .then((servers) => {
        if (mounted) setMcpServers(servers);
      })
      .catch((error) => {
        if (mounted) {
          setMessage(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    void loadInstalledPlugins()
      .then((plugins) => {
        if (mounted) setInstalledPlugins(plugins);
      })
      .catch((error) => {
        if (mounted) {
          setMessage(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    void loadInstalledSkills()
      .then((skills) => {
        if (mounted) setInstalledSkills(skills);
      })
      .catch((error) => {
        if (mounted) {
          setMessage(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(
    () =>
      window.artemis.onMcpServerStatus?.((status) => {
        setMcpServers((current) =>
          current.map((server) =>
            server.config.id === status.config.id ? status : server,
          ),
        );
      }),
    [],
  );

  useEffect(() => {
    if (settings) setMcpServers(settings.mcpServers);
  }, [settings]);

  useEffect(
    () =>
      window.artemis.onResourceInstallProgress((progress) => {
        setInstallProgress((current) =>
          current?.operationId === progress.operationId ? progress : current,
        );
      }),
    [],
  );

  useEffect(() => {
    let mounted = true;
    const marketplaceRequest = marketplaceStateCache
      ? Promise.resolve(marketplaceStateCache)
      : window.artemis.getArtemisPluginMarketplaces();
    const runtimeRequest = runtimeMarketplaceLoaded
      ? Promise.resolve(runtimeMarketplaceCache)
      : window.artemis.loadBundledPluginMarketplace();
    void runtimeRequest
      .then((runtime) => {
        runtimeMarketplaceLoaded = true;
        runtimeMarketplaceCache = runtime;
        if (!mounted) return;
        setRuntimeMarketplace(runtime);
      })
      .catch((error) => {
        if (mounted && !marketplaceStateCache) {
          setMessage(error instanceof Error ? error.message : String(error));
        }
      });
    void marketplaceRequest
      .then((next) => {
        if (!mounted) return;
        applyMarketplaceState(next);
      })
      .catch((error) => {
        if (mounted) {
          setMessage(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  function beginInstallation(
    kind: ResourceInstallProgress["kind"],
    resourceId: string,
  ): string {
    const operationId = crypto.randomUUID();
    setInstallProgress({ operationId, kind, resourceId, percent: 0 });
    return operationId;
  }

  function runResourceOperation(operation: () => Promise<void>): void {
    if (operationPendingRef.current) return;
    operationPendingRef.current = true;
    setOperationPending(true);
    let pending: Promise<void>;
    try {
      pending = operation();
    } catch (error) {
      operationPendingRef.current = false;
      setOperationPending(false);
      setMessage(error instanceof Error ? error.message : String(error));
      return;
    }
    void pending
      .catch((error) =>
        setMessage(error instanceof Error ? error.message : String(error)),
      )
      .finally(() => {
        operationPendingRef.current = false;
        setOperationPending(false);
      });
  }

  function runToggleOperation(
    id: string,
    operation: () => Promise<void>,
  ): void {
    if (pendingToggleIdsRef.current.has(id)) return;
    pendingToggleIdsRef.current.add(id);
    setPendingToggleIds(new Set(pendingToggleIdsRef.current));
    // Mutations return full snapshots. Serialize saves so an older response
    // cannot undo a newer toggle, while only requested rows become busy.
    toggleQueueRef.current = toggleQueueRef.current
      .then(async () => {
        await operation();
        window.dispatchEvent(new Event("artemis:resources-changed"));
      })
      .catch((error: unknown) =>
        setMessage(error instanceof Error ? error.message : String(error)),
      )
      .finally(() => {
        pendingToggleIdsRef.current.delete(id);
        setPendingToggleIds(new Set(pendingToggleIdsRef.current));
      });
  }

  function runResourceSubmit(
    event: FormEvent,
    operation: () => Promise<void>,
  ): void {
    event.preventDefault();
    runResourceOperation(operation);
  }

  function focusCatalogSearch(): void {
    requestAnimationFrame(() => catalogSearchRef.current?.focus());
  }

  function toggleCatalogDiscovery(tab: CatalogSearchTab): void {
    const opening = !discoveryOpen;
    setDiscoveryOpen(opening);
    setCatalogQuery("");
    setCatalogSearchPhase((current) => ({ ...current, [tab]: "idle" }));
    if (tab === "mcp") setMcpResults([]);
    else setSkillResults([]);
    if (opening) focusCatalogSearch();
  }

  function applyMarketplaceState(next: ArtemisPluginMarketplaceState): void {
    marketplaceStateCache = next;
    setMarketplaceState(next);
    const error = next.errors.find(
      (candidate) => candidate.sourceId === next.selectedView,
    )?.message;
    setMessage(error);
  }

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
      installedSkillsCache = [
        ...installedSkills.filter((skill) => skill.id !== installed.id),
        installed,
      ].sort((left, right) => left.name.localeCompare(right.name));
      setInstalledSkills(installedSkillsCache);
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
      installedSkillsCache = await window.artemis.listInstalledSkills();
      setInstalledSkills(installedSkillsCache);
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
      installedSkillsCache = await window.artemis.setSkillEnabled(
        skillId,
        enabled,
      );
      setInstalledSkills(installedSkillsCache);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function removeSkill(skill: InstalledSkill) {
    setBusyId(skill.id);
    setMessage(undefined);
    try {
      installedSkillsCache = await window.artemis.removeSkill(skill.id);
      setInstalledSkills(installedSkillsCache);
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

  function applyPluginMutation(
    result: ArtemisPluginMutationResult,
    successMessage: string = t.installedNow,
  ): void {
    installedPluginsCache = result.plugins;
    installedSkillsCache = result.skills;
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
    const conflict = pluginSkillConflict(plugin);
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
    const operationId = beginInstallation("plugin", pluginDisplayName(plugin));
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
    const operationId = beginInstallation("plugin", pluginDisplayName(plugin));
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

  function openMcpEditor(server?: McpServerStatus) {
    setEditingMcpServer(server);
    setMode("mcp-editor");
    setMessage(undefined);
  }

  function closeMcpEditor() {
    setMode("manage");
    setManagementTab("mcp");
    setEditingMcpServer(undefined);
  }

  function openManagement(tab: ManagementTab = "plugins") {
    setMode("manage");
    setManagementTab(tab);
    setManagementQuery("");
    setDiscoveryOpen(false);
    setMessage(undefined);
  }

  function switchManagementTab(tab: ManagementTab) {
    setManagementTab(tab);
    setManagementQuery("");
    setCatalogQuery("");
    setDiscoveryOpen(false);
    setMessage(undefined);
  }

  const installedPluginIds = new Set(
    installedPlugins.map((plugin) => plugin.id),
  );
  const managedMcpIds = new Set(
    installedPlugins.flatMap((plugin) => plugin.mcpServerIds),
  );
  const managedSkillNames = new Set(
    installedPlugins.flatMap((plugin) => plugin.skillNames),
  );
  const enabledSkillNames = new Set(
    installedSkills.filter((skill) => skill.enabled).map((skill) => skill.name),
  );
  const enabledMcpIds = new Set(
    mcpServers
      .filter((server) => server.config.enabled)
      .map((server) => server.config.id),
  );

  function owningPluginForSkill(skill: InstalledSkill) {
    return installedPlugins.find((plugin) =>
      plugin.skillNames.includes(skill.name),
    );
  }

  function owningPluginForMcp(server: McpServerStatus) {
    return installedPlugins.find((plugin) =>
      plugin.mcpServerIds.includes(server.config.id),
    );
  }

  const marketplaceBySourceId = new Map(
    (marketplaceState?.marketplaces ?? []).map((entry) => [
      entry.sourceId,
      entry.marketplace,
    ]),
  );
  const marketplaceSourceById = new Map(
    (marketplaceState?.sources ?? []).map((source) => [source.id, source]),
  );
  const pluginCardRenderers = createPluginCardRenderers({
    installedSkills,
    installedPlugins,
    t,
    locale,
    officeCapabilityActive,
    mcpServers,
    installedPluginIds,
    computerRuntime,
    marketplaceSourceForPlugin,
    marketplaceSourceById,
    pluginMarketplaceLabel,
    marketplaceSourceLabel,
    office,
    operationPending,
    setPluginInstallDraft,
    updatePlugin,
    onReviewHooks,
    busyId,
    installProgress,
    officePackStatus,
    officeUpdating,
    setMessage,
    setOfficeUpdating,
    runResourceOperation,
    officeCapabilityInstalled,
    setOfficeCapabilityOpen,
    setConnectionPlugin,
    setPluginUninstallDraft,
  });

  function pluginsForMarketplace(sourceId: string): ArtemisPluginPreview[] {
    const marketplace = marketplaceBySourceId.get(sourceId);
    return sourceId === "bundled"
      ? (runtimeMarketplace?.plugins ?? [])
      : (marketplace?.plugins ?? []);
  }

  const allMarketplacePlugins = [
    ...(marketplaceState?.sources ?? []).flatMap((source) =>
      pluginsForMarketplace(source.id),
    ),
    ...localPluginResults,
  ];

  function marketplaceSourceLabel(
    source: ArtemisPluginMarketplaceSource,
  ): string {
    if (source.id === "bundled") return t.bundledPlugins;
    const normalizedDisplayName = source.displayName.toLocaleLowerCase();
    const duplicate = (marketplaceState?.sources ?? []).filter(
      (candidate) =>
        candidate.displayName.toLocaleLowerCase() === normalizedDisplayName,
    ).length;
    const base =
      duplicate > 1
        ? `${source.displayName} · ${source.repository}`
        : source.displayName;
    const mode = source.offline ? `${base} · ${t.offline}` : base;
    const stale =
      marketplaceBySourceId.has(source.id) &&
      (marketplaceState?.errors ?? []).some(
        (error) => error.sourceId === source.id,
      );
    return stale ? `${mode} · ${t.marketplaceStale}` : mode;
  }

  function marketplaceSourceForPlugin(
    plugin: ArtemisPluginPreview,
  ): ArtemisPluginMarketplaceSource | undefined {
    if (
      plugin.source.kind === "builtin" ||
      plugin.source.kind === "bundled" ||
      plugin.source.kind === "runtime"
    ) {
      return undefined;
    }
    if (plugin.source.kind !== "git") return undefined;
    const marketplaceUrl = plugin.source.marketplaceUrl.toLowerCase();
    return (marketplaceState?.sources ?? []).find(
      (source) => source.url.toLowerCase() === marketplaceUrl,
    );
  }

  function pluginMarketplaceLabel(plugin: ArtemisPluginPreview): string {
    if (plugin.source.kind === "local") return t.local;
    const source = marketplaceSourceForPlugin(plugin);
    if (source) return marketplaceSourceLabel(source);
    if (
      plugin.source.kind === "builtin" ||
      plugin.source.kind === "bundled" ||
      plugin.source.kind === "runtime"
    ) {
      return t.bundledPlugins;
    }
    return `${plugin.source.marketplaceName} · ${t.marketplaceRemoved}`;
  }

  function visualForPlugin(plugin: ArtemisPluginPreview) {
    const bundled =
      plugin.source.kind === "builtin" ||
      plugin.source.kind === "bundled" ||
      plugin.source.kind === "runtime"
        ? (runtimeMarketplace?.plugins ?? []).find(
            (candidate) => candidate.id === plugin.id,
          )
        : undefined;
    return {
      brandColor: bundled?.brandColor ?? plugin.brandColor,
      iconDataUrl: bundled?.iconDataUrl ?? plugin.iconDataUrl,
      pluginName: plugin.name,
      iconKey: plugin.hasHooks ? ("hook-plugin" as const) : undefined,
    };
  }

  function visualForSkill(skill: InstalledSkill) {
    const plugin = owningPluginForSkill(skill);
    const visual = plugin ? visualForPlugin(plugin) : undefined;
    return {
      brandColor: visual?.brandColor,
      iconDataUrl: visual?.iconDataUrl,
      pluginName: visual?.pluginName,
      iconKey: resourceIconName(skill.name, "skill", {
        id: skill.id,
        description: skill.description,
        pluginName: visual?.pluginName,
      }),
    };
  }

  function visualForMcp(server: McpServerStatus) {
    const plugin = owningPluginForMcp(server);
    const visual = plugin ? visualForPlugin(plugin) : undefined;
    return {
      brandColor: visual?.brandColor,
      iconDataUrl: visual?.iconDataUrl,
      pluginName: visual?.pluginName,
      iconKey: resourceIconName(
        server.config.name || server.config.id,
        server.config.resourceKind === "connector" ? "connectors" : "mcp",
        {
          transport: server.config.transport,
          command:
            server.config.transport === "stdio"
              ? [server.config.command, ...server.config.args].join(" ")
              : undefined,
        },
      ),
    };
  }

  function pluginIsEnabled(plugin: InstalledArtemisPlugin): boolean {
    return (
      (Boolean(plugin.skins?.length) &&
        plugin.skinsEnabled !== false &&
        !plugin.formatMigrationRequired) ||
      (plugin.hasHooks && plugin.hooksEnabled !== false) ||
      plugin.skillNames.some((name) => enabledSkillNames.has(name)) ||
      plugin.mcpServerIds.some((id) => enabledMcpIds.has(id))
    );
  }

  const selectedMarketplaceView = allMarkets
    ? "all"
    : (marketplaceState?.selectedView ?? "bundled");
  const marketplaceTabOptions = [
    {
      id: "resource-marketplace-all",
      panelId: "resource-marketplace-all-panel",
      value: "all",
      label: uiText(locale, "Review01.allMarkets"),
    },
    ...(marketplaceState?.sources ?? []).map((source) => ({
      id: `resource-marketplace-tab-${encodeURIComponent(source.id)}`,
      label: marketplaceSourceLabel(source),
      panelId: `resource-marketplace-panel-${encodeURIComponent(source.id)}`,
      value: source.id,
    })),
    {
      id: "resource-marketplace-tab-local",
      label: t.local,
      panelId: "resource-marketplace-panel-local",
      value: "local",
    },
  ];
  const activeMarketplaceTabOption =
    marketplaceTabOptions.find(
      (option) => option.value === selectedMarketplaceView,
    ) ?? marketplaceTabOptions.at(-1)!;
  const marketplaceFilter = marketplaceQuery.trim().toLowerCase();
  const matchingMarketplacePlugins = (plugins: ArtemisPluginPreview[]) =>
    plugins.filter((plugin) => {
      if (isLegacyOfficePlugin(plugin)) return false;
      return (
        !marketplaceFilter ||
        plugin.displayName.toLowerCase().includes(marketplaceFilter) ||
        pluginDisplayName(plugin).toLowerCase().includes(marketplaceFilter) ||
        plugin.name.toLowerCase().includes(marketplaceFilter) ||
        localizedPluginText(plugin, locale)
          .description?.toLowerCase()
          .includes(marketplaceFilter) ||
        plugin.description.toLowerCase().includes(marketplaceFilter) ||
        pluginDescription(plugin).toLowerCase().includes(marketplaceFilter) ||
        plugin.category?.toLowerCase().includes(marketplaceFilter) ||
        (plugin.category &&
          localizedPluginCategory(plugin.category, locale)
            .toLowerCase()
            .includes(marketplaceFilter))
      );
    });
  const selectedMarketplacePlugins = matchingMarketplacePlugins(
    selectedMarketplaceView === "local"
      ? localPluginResults
      : pluginsForMarketplace(selectedMarketplaceView),
  );

  const marketplaceGroups: Array<{
    title: string;
    plugins: ArtemisPluginPreview[];
    sourceId?: string;
  }> = [];
  if (marketplaceFilter || allMarkets) {
    for (const source of marketplaceState?.sources ?? []) {
      const plugins = matchingMarketplacePlugins(
        pluginsForMarketplace(source.id),
      );
      if (plugins.length) {
        marketplaceGroups.push({
          title: marketplaceSourceLabel(source),
          plugins,
          sourceId: source.id,
        });
      }
    }
    const local = matchingMarketplacePlugins(localPluginResults);
    if (local.length)
      marketplaceGroups.push({
        title: t.local,
        plugins: local,
        sourceId: "local",
      });
  } else if (selectedMarketplaceView === "local") {
    marketplaceGroups.push({
      title: t.local,
      plugins: selectedMarketplacePlugins,
      sourceId: "local",
    });
  } else {
    const runtimeIds = new Set(
      selectedMarketplaceView === "bundled"
        ? (runtimeMarketplace?.plugins ?? []).map((plugin) => plugin.id)
        : [],
    );
    const runtimePlugins = selectedMarketplacePlugins.filter((plugin) =>
      runtimeIds.has(plugin.id),
    );
    if (runtimePlugins.length) {
      marketplaceGroups.push({
        title: t.bundledPlugins,
        plugins: runtimePlugins,
        sourceId: "bundled",
      });
    }
    const featuredNames = new Set(FEATURED_PLUGINS);
    const featured = selectedMarketplacePlugins.filter(
      (plugin) => !runtimeIds.has(plugin.id) && featuredNames.has(plugin.name),
    );
    for (const plugin of selectedMarketplacePlugins) {
      if (featured.length >= 6) break;
      if (
        !runtimeIds.has(plugin.id) &&
        !featured.some((candidate) => candidate.id === plugin.id)
      ) {
        featured.push(plugin);
      }
    }
    const featuredIds = new Set(featured.map((plugin) => plugin.id));
    if (featured.length)
      marketplaceGroups.push({
        title: t.featured,
        plugins: featured,
        sourceId: selectedMarketplaceView,
      });
    const byCategory = new Map<string, ArtemisPluginPreview[]>();
    for (const plugin of selectedMarketplacePlugins) {
      if (runtimeIds.has(plugin.id) || featuredIds.has(plugin.id)) continue;
      const category = plugin.category ?? t.plugins;
      byCategory.set(category, [...(byCategory.get(category) ?? []), plugin]);
    }
    for (const [title, plugins] of [...byCategory.entries()].sort(
      ([left], [right]) => left.localeCompare(right),
    )) {
      marketplaceGroups.push({
        title,
        plugins,
        sourceId: selectedMarketplaceView,
      });
    }
  }

  const managementFilter = managementQuery.trim().toLowerCase();
  const matchesManagement = (...values: Array<string | undefined>) =>
    !managementFilter ||
    values.some((value) => value?.toLowerCase().includes(managementFilter));
  const installedPacks = [
    {
      id: "office-core",
      name: "Office",
      keywords: "office word excel powerpoint pdf",
      status: officePackStatus,
      icon: officeSuiteIcon,
      activate: (version: string) =>
        window.artemis.activateOfficeCapability(version),
      deactivate: () => window.artemis.deactivateOfficeCapability(),
      refresh: async () => {
        const status = await window.artemis.officeCapabilityStatus();
        setOfficePackStatus(status);
        setOfficeCapabilityActive(Boolean(status.activeVersion));
        setOfficeCapabilityInstalled(status.versions.length > 0);
      },
      open: () => setOfficeCapabilityOpen(true),
    },
    {
      id: "artemis-design",
      name: uiText(locale, "App_copy.designTab"),
      keywords: "design",
      status: designPackStatus,
      icon: designPluginIcon,
      activate: (version: string) =>
        window.artemis.activateDesignCapability(version),
      deactivate: () => window.artemis.deactivateDesignCapability(),
      refresh: async () =>
        setDesignPackStatus(await window.artemis.designCapabilityStatus()),
      open: () => setDesignPackOpen(true),
    },
  ].filter((pack) => Boolean(pack.status?.versions.length));
  const visibleInstalledPacks = installedPacks.filter((pack) =>
    matchesManagement(pack.name, pack.keywords, t.bundledPlugins),
  );
  function renderInstalledPack(pack: (typeof installedPacks)[number]) {
    const enabled = Boolean(pack.status?.activeVersion);
    return (
      <ManagementRow
        key={pack.id}
        className="resource-installed-row"
        title={pack.name}
        description={`${t.plugins} · ${t.bundledPlugins}`}
        leading={
          <ResourceAvatar
            kind="plugin"
            name={pack.name}
            iconDataUrl={pack.icon}
          />
        }
        actions={
          <>
            <span
              className="resource-capability-status"
              data-state={enabled ? "enabled" : "disabled"}
              role="status"
              aria-busy={pendingToggleIds.has(pack.id)}
            >
              {pendingToggleIds.has(pack.id)
                ? uiText(
                    locale,
                    pendingPackTargets[pack.id]
                      ? "ResourceCenter.enabling"
                      : "ResourceCenter.disabling",
                  )
                : enabled
                  ? t.enabled
                  : t.disabled}
            </span>
            <Button
              variant="quiet"
              className="management-text-action"
              disabled={operationPending || Boolean(busyId)}
              label={`${t.configure} ${pack.name}`}
              onClick={pack.open}
            >
              {t.configure}
            </Button>
            <Switch
              checked={enabled}
              label={`${t.enabled}: ${pack.name}`}
              labelVisibility="hidden"
              disabled={
                operationPending ||
                Boolean(busyId) ||
                pendingToggleIds.has(pack.id) ||
                pack.status?.phase !== "idle"
              }
              onCheckedChange={(nextEnabled) => {
                setPendingPackTargets((current) => ({
                  ...current,
                  [pack.id]: nextEnabled,
                }));
                runToggleOperation(pack.id, async () => {
                  try {
                    if (nextEnabled) {
                      const version = pack.status!.versions.toSorted(
                        (left, right) =>
                          right.version.localeCompare(left.version, "en", {
                            numeric: true,
                          }),
                      )[0]!.version;
                      await pack.activate(version);
                    } else {
                      await pack.deactivate();
                    }
                    await pack.refresh();
                  } finally {
                    setPendingPackTargets((current) => {
                      const next = { ...current };
                      delete next[pack.id];
                      return next;
                    });
                  }
                });
              }}
            />
          </>
        }
      />
    );
  }
  const visibleInstalledPlugins = installedPlugins.filter(
    (plugin) =>
      !isLegacyOfficePlugin(plugin) &&
      matchesManagement(
        plugin.displayName,
        plugin.name,
        plugin.shortDescription,
        plugin.description,
        pluginDisplayName(plugin),
        pluginDescription(plugin),
        localizedPluginText(plugin, locale).description,
        pluginMarketplaceLabel(plugin),
      ),
  );
  const visibleExtensions = (settings?.trustedExtensions ?? []).filter(
    (extension) =>
      matchesManagement(
        extension.config.name,
        extension.config.path,
        extension.state,
      ),
  );
  const visibleMcp = mcpServers
    .filter((server) => server.config.resourceKind !== "connector")
    .filter((server) =>
      matchesManagement(
        server.config.name,
        server.config.transport,
        server.state,
      ),
    );
  const visibleSkills = installedSkills.filter((skill) =>
    matchesManagement(skill.name, skill.description, skill.source),
  );

  const installedTiles: Array<{
    id: string;
    name: string;
    kind: "plugin" | "skill" | "mcp" | "connectors";
    iconDataUrl?: string | undefined;
    pluginName?: string | undefined;
    brandColor?: string | undefined;
    iconKey?: ResourceIconName | undefined;
    description: string;
    enabled: boolean;
    status?: string | undefined;
    actionLabel?: string;
    needsAttention?: boolean;
    disabled?: boolean;
    configure(): void;
    toggle(enabled: boolean): Promise<void>;
  }> = [
    ...installedPlugins
      .filter((plugin) => !isLegacyOfficePlugin(plugin))
      .map((plugin) => {
        const visual = visualForPlugin(plugin);
        return {
          id: `plugin:${plugin.id}`,
          name: pluginDisplayName(plugin),
          kind: "plugin" as const,
          description: `${t.plugins} · ${pluginMarketplaceLabel(plugin)}`,
          enabled: pluginIsEnabled(plugin),
          disabled: !plugin.installable && !pluginIsEnabled(plugin),
          configure: () =>
            pluginHasConnection(plugin)
              ? setConnectionPlugin(plugin)
              : openManagement("plugins"),
          toggle: (enabled: boolean) => setPluginEnabled(plugin, enabled),
          ...visual,
        };
      }),
    ...installedSkills
      .filter((skill) => !managedSkillNames.has(skill.name))
      .map((skill) => {
        const visual = visualForSkill(skill);
        return {
          id: `skill:${skill.id}`,
          name: skill.name,
          kind: "skill" as const,
          description: t.skills,
          enabled: skill.enabled,
          configure: () => openManagement("skills"),
          toggle: (enabled: boolean) => setSkillEnabled(skill.id, enabled),
          ...visual,
        };
      }),
    ...mcpServers
      .filter((server) => !managedMcpIds.has(server.config.id))
      .map((server) => {
        const owner = owningPluginForMcp(server);
        const visual = visualForMcp(server);
        return {
          id: `mcp:${server.config.id}`,
          name: owner ? pluginPageText(server.config.name) : server.config.name,
          kind:
            server.config.resourceKind === "connector"
              ? ("connectors" as const)
              : ("mcp" as const),
          description:
            server.config.transport === "stdio"
              ? `${t.mcp} · ${server.config.fullAccess ? uiText(locale, "ResourceCenter.inline8") : uiText(locale, "ResourceCenter.inline7")}`
              : `${t.mcp} · ${uiText(locale, "ResourceCenter.inline6")}`,
          enabled: server.config.enabled,
          status:
            server.state === "connected"
              ? t.connected
              : server.state === "failed" ||
                  server.state === "configuration-required" ||
                  server.state === "authorization-required"
                ? t.needsSetup
                : undefined,
          needsAttention:
            server.state === "failed" ||
            server.state === "configuration-required" ||
            server.state === "authorization-required",
          configure: () => openMcpEditor(server),
          toggle: (enabled: boolean) =>
            setMcpEnabled(server.config.id, enabled),
          ...visual,
        };
      }),
    ...(settings?.trustedExtensions ?? []).map((extension) => ({
      id: `extension:${extension.config.id}`,
      name: extension.config.name,
      kind: "plugin" as const,
      iconKey: "terminal" as const,
      description: t.executableExtension,
      enabled: extension.config.enabled,
      status:
        extension.state === "changed"
          ? uiText(locale, "ResourceCenter.inline9")
          : extension.state === "failed"
            ? t.needsSetup
            : undefined,
      actionLabel:
        extension.state === "changed"
          ? uiText(locale, "ResourceCenter.inline10")
          : t.configure,
      needsAttention:
        extension.state === "changed" || extension.state === "failed",
      disabled: extension.state === "changed",
      configure: () =>
        extension.state === "changed"
          ? runResourceOperation(() => retrustExtension(extension.config.id))
          : openManagement("plugins"),
      toggle: (enabled: boolean) =>
        setExtensionEnabled(extension.config.id, enabled),
    })),
  ];
  function renderProgressAndMessage() {
    const warnings =
      marketplaceState?.marketplaces.find(
        (entry) => entry.sourceId === marketplaceState.selectedView,
      )?.marketplace.warnings ?? [];
    return (
      <>
        {installProgress && (
          <div
            aria-label={`${t.installing} ${pluginPageText(installProgress.resourceId)}`}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={installProgress.percent}
            className="catalog-progress"
            role="progressbar"
          >
            <div className="catalog-progress-label">
              <span>
                {t.installing} {pluginPageText(installProgress.resourceId)}
              </span>
              <strong>{installProgress.percent}%</strong>
            </div>
            <div className="catalog-progress-track">
              <span style={{ width: `${installProgress.percent}%` }} />
            </div>
          </div>
        )}
        {message && (
          <InlineNotice tone="info">{pluginPageText(message)}</InlineNotice>
        )}
        {mode === "marketplace" && warnings.length > 0 && (
          <details
            className="resource-marketplace-diagnostics"
            key={marketplaceState?.selectedView}
          >
            <summary>
              {uiText(locale, "EnvironmentPullRequestError_labels.details")} (
              {warnings.length})
            </summary>
            <ul>
              {warnings.map((warning, index) => (
                <li key={index}>{pluginPageText(warning)}</li>
              ))}
            </ul>
          </details>
        )}
      </>
    );
  }

  function pluginSkillConflict(
    plugin: ArtemisPluginPreview,
  ): string | undefined {
    return pluginCardRenderers.pluginSkillConflict(plugin);
  }

  function pluginDisplayName(plugin: ArtemisPluginPreview): string {
    return pluginCardRenderers.pluginDisplayName(plugin);
  }

  function pluginDescription(plugin: ArtemisPluginPreview): string {
    return pluginCardRenderers.pluginDescription(plugin);
  }

  function pluginHasConnection(plugin: InstalledArtemisPlugin): boolean {
    return pluginCardRenderers.pluginHasConnection(plugin);
  }

  function renderPluginUninstall(): import("react").JSX.Element | null {
    return resourceDialogRenderers.renderPluginUninstall();
  }

  function renderResourceRemoval(): import("react").JSX.Element | null {
    return resourceDialogRenderers.renderResourceRemoval();
  }

  function renderOfficePackCard(): import("react").JSX.Element {
    return capabilityCardRenderers.renderOfficePackCard();
  }

  /** 随应用提供的设计插件卡：安装/卸载决定设计面板入口的显隐（todo ⑤）。 */
  function renderDesignPackCard(): import("react").JSX.Element {
    return capabilityCardRenderers.renderDesignPackCard();
  }

  function renderPluginConnection(): import("react").JSX.Element | null {
    return resourceDialogRenderers.renderPluginConnection();
  }

  function renderPluginCard(
    plugin: ArtemisPluginPreview,
    sourceId?: string,
  ): import("react").JSX.Element {
    return pluginCardRenderers.renderPluginCard(plugin, sourceId);
  }

  if (mode === "add-plugin") {
    return (
      <ResourceSurface
        busy={operationPending || Boolean(busyId) || searching}
        className="resource-page resource-standalone-page"
        label={t.addPlugin}
      >
        <ManagementHeader
          className="resource-page-header resource-management-header"
          description={t.addPluginDescription}
          leading={
            <IconButton
              className="resource-back-button"
              disabled={operationPending}
              icon={<BackIcon />}
              label={
                addPluginReturnMode === "marketplace"
                  ? t.backToMarketplace
                  : t.backToPlugins
              }
              onClick={() => {
                if (addPluginReturnMode === "marketplace") {
                  setMode("marketplace");
                } else {
                  setMode("manage");
                  setManagementTab("plugins");
                }
                setMessage(undefined);
              }}
              title={
                addPluginReturnMode === "marketplace"
                  ? t.backToMarketplace
                  : t.backToPlugins
              }
            />
          }
          title={t.addPlugin}
        />

        {renderProgressAndMessage()}

        <section className="resource-add-plugin-options">
          <ManagementCard className="resource-add-plugin-card">
            <strong>{t.mcp}</strong>
            <Button
              disabled={operationPending}
              icon={<PlusIcon />}
              onClick={() => openMcpEditor()}
            >
              {t.addMcp}
            </Button>
          </ManagementCard>
          <ManagementCard className="resource-add-plugin-card">
            <div>
              <strong>{t.gitMarketplace}</strong>
              <small>{t.gitMarketplaceHint}</small>
            </div>
            <form
              onSubmit={(event) =>
                runResourceSubmit(event, addCustomMarketplace)
              }
            >
              <TextField
                autoFocus
                disabled={operationPending}
                label={t.gitMarketplaceHint}
                labelVisibility="hidden"
                onValueChange={setSourceInput}
                placeholder={t.gitMarketplaceHint}
                value={sourceInput}
              />
              <Button
                disabled={operationPending || !sourceInput.trim() || searching}
                type="submit"
              >
                {t.loadMarketplace}
              </Button>
            </form>
          </ManagementCard>

          <ManagementCard className="resource-add-plugin-card">
            <div>
              <strong>{t.offlineMarketplace}</strong>
              <small>{t.offlineMarketplaceHint}</small>
            </div>
            <Button
              disabled={
                operationPending || searching || installProgress !== undefined
              }
              icon={<CatalogIcon kind="plugin" />}
              onClick={() => runResourceOperation(importOfflineMarketplace)}
            >
              {t.importOfflineMarketplace}
            </Button>
          </ManagementCard>

          {(marketplaceState?.sources ?? []).some(
            (source) => !source.builtIn,
          ) && (
            <ManagementCard className="resource-add-plugin-card resource-marketplace-manager">
              <div>
                <strong>{t.manageMarketplaces}</strong>
                <small>{t.gitMarketplaceHint}</small>
              </div>
              <div className="resource-marketplace-source-list">
                {(marketplaceState?.sources ?? [])
                  .filter((source) => !source.builtIn)
                  .map((source, index, sources) => (
                    <ManagementRow
                      actions={
                        <>
                          <span className="resource-marketplace-reorder-actions">
                            <IconButton
                              disabled={operationPending || index === 0}
                              icon={<span aria-hidden="true">↑</span>}
                              label={`${t.moveMarketplaceUp}: ${source.displayName}`}
                              onClick={() =>
                                runResourceOperation(() =>
                                  reorderMarketplace(source.id, index - 1),
                                )
                              }
                              title={t.moveMarketplaceUp}
                            />
                            <IconButton
                              disabled={
                                operationPending || index === sources.length - 1
                              }
                              icon={<span aria-hidden="true">↓</span>}
                              label={`${t.moveMarketplaceDown}: ${source.displayName}`}
                              onClick={() =>
                                runResourceOperation(() =>
                                  reorderMarketplace(source.id, index + 1),
                                )
                              }
                              title={t.moveMarketplaceDown}
                            />
                          </span>
                          <IconButton
                            className="resource-icon-button resource-marketplace-remove-button"
                            disabled={
                              operationPending ||
                              busyId === `marketplace:${source.id}`
                            }
                            icon={<TrashIcon />}
                            label={`${t.removeMarketplace}: ${source.displayName}`}
                            onClick={() =>
                              runResourceOperation(() =>
                                removeMarketplace(source),
                              )
                            }
                            title={t.removeMarketplace}
                          />
                        </>
                      }
                      className="resource-marketplace-source-row"
                      data-dragging={
                        draggingMarketplaceId === source.id || undefined
                      }
                      description={`${source.repository}${source.offline ? ` · ${t.offline}` : ""}`}
                      draggable={!operationPending}
                      key={source.id}
                      onDragEnd={() => setDraggingMarketplaceId(undefined)}
                      onDragOver={(event) => {
                        event.dataTransfer.dropEffect = "move";
                        event.preventDefault();
                      }}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", source.id);
                        setDraggingMarketplaceId(source.id);
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const draggedId =
                          event.dataTransfer.getData("text/plain");
                        const destination = Number(
                          event.currentTarget.dataset.index,
                        );
                        setDraggingMarketplaceId(undefined);
                        if (
                          !draggedId ||
                          Number.isNaN(destination) ||
                          draggedId === source.id
                        )
                          return;
                        void runResourceOperation(() =>
                          reorderMarketplace(draggedId, destination),
                        );
                      }}
                      data-index={index}
                      title={marketplaceSourceLabel(source)}
                    />
                  ))}
              </div>
            </ManagementCard>
          )}

          <ManagementCard className="resource-add-plugin-card">
            <div>
              <strong>{t.localPlugin}</strong>
              <small>{t.inspectLocalPlugin}</small>
            </div>
            <Button
              disabled={operationPending || busyId === "local-plugin"}
              icon={<CatalogIcon kind="plugin" />}
              onClick={() => runResourceOperation(inspectLocalPlugin)}
            >
              {t.inspectLocalPlugin}
            </Button>
          </ManagementCard>

          <ManagementCard className="resource-add-plugin-card">
            <div>
              <strong>{t.executableExtension}</strong>
              <small>{t.executableExtensionHint}</small>
            </div>
            <Button
              disabled={operationPending || busyId === "extension:new"}
              icon={<CatalogIcon kind="plugin" />}
              onClick={() => runResourceOperation(trustExtension)}
            >
              {t.trustExtension}
            </Button>
          </ManagementCard>
        </section>
      </ResourceSurface>
    );
  }

  if (mode === "mcp-editor") {
    return (
      <ResourceSurface
        className="resource-page resource-standalone-page"
        label={t.mcp}
      >
        <McpServerEditor
          existingServers={mcpServers}
          key={editingMcpServer?.config.id ?? "new"}
          locale={locale}
          onConfirm={onConfirm}
          onCancel={() => closeMcpEditor()}
          onRemoved={(next) => {
            setMcpServers(next.mcpServers);
            onSettingsChange(next);
            closeMcpEditor();
            setMessage(t.mcpRemoved);
          }}
          onSaved={(next) => {
            setMcpServers(next.mcpServers);
            onSettingsChange(next);
            closeMcpEditor();
            setMessage(t.mcpSaved);
          }}
          {...(editingMcpServer ? { server: editingMcpServer } : {})}
        />
      </ResourceSurface>
    );
  }

  const managementCounts: Record<ManagementTab, number> = {
    plugins:
      new Set([
        ...marketplaceGroups.flatMap((group) =>
          group.plugins.map((plugin) => plugin.id),
        ),
        ...selectedMarketplacePlugins.map((plugin) => plugin.id),
      ]).size + 2,
    mcp: mcpServers.filter(
      (server) => server.config.resourceKind !== "connector",
    ).length,
    skills: installedSkills.length,
  };
  const managementTabOptions = (["plugins", "mcp", "skills"] as const).map(
    (tab) => ({
      id: `resource-management-tab-${tab}`,
      label: t[tab],
      count: managementCounts[tab] || undefined,
      panelId: `resource-management-panel-${tab}`,
      value: tab,
      icon: (
        <ArtemisIcon
          name={tab === "plugins" ? "plugin" : tab === "mcp" ? "mcp" : "skill"}
          width={14}
          height={14}
        />
      ),
    }),
  );
  const activeManagementTabOption = managementTabOptions.find(
    (option) => option.value === managementTab,
  )!;

  const headerActions = (
    <div className="resource-header-actions">
      <IconButton
        className="resource-icon-button resource-refresh"
        variant="quiet"
        disabled={
          operationPending ||
          selectedMarketplaceView === "local" ||
          marketplaceSourceById.get(selectedMarketplaceView)?.builtIn ||
          marketplaceSourceById.get(selectedMarketplaceView)?.refreshable ===
            false ||
          searching ||
          installProgress !== undefined
        }
        icon={<RefreshIcon />}
        label={t.refresh}
        onClick={() => runResourceOperation(refreshSelectedMarketplace)}
        title={t.refresh}
      />
      <Button
        className="resource-add-button"
        disabled={operationPending}
        icon={<PlusIcon />}
        onClick={() => {
          setAddPluginReturnMode("marketplace");
          setMode("add-plugin");
        }}
      >
        {uiText(locale, "Review02.addMarketServer")}
      </Button>
    </div>
  );
  const resourceHeader = (
    <ManagementHeader
      className="resource-page-header"
      description={t.marketDescription}
      title={uiText(locale, "Review01.resources")}
      actions={headerActionTarget ? undefined : headerActions}
    />
  );
  const resourceTabs = (
    <SegmentedControl
      className="resource-category-tabs"
      disabled={operationPending}
      label={t.manage}
      onValueChange={(tab) => {
        if (tab === "plugins") setMode("marketplace");
        else openManagement(tab);
      }}
      options={managementTabOptions}
      size="compact"
      value={mode === "marketplace" ? "plugins" : managementTab}
    />
  );
  if (mode === "marketplace") {
    return (
      <ResourceSurface
        busy={
          operationPending ||
          Boolean(busyId) ||
          searching ||
          Boolean(installProgress)
        }
        className="resource-page resource-marketplace-page"
        label={t.title}
      >
        {headerActionTarget && createPortal(headerActions, headerActionTarget)}
        {resourceHeader}
        <div className="resource-marketplace-toolbar">
          {resourceTabs}
          <Select
            className="resource-marketplace-filter"
            label={t.marketplaces}
            labelVisibility="hidden"
            size="compact"
            value={selectedMarketplaceView}
            options={marketplaceTabOptions}
            disabled={operationPending}
            onValueChange={(sourceId) => {
              setAllMarkets(sourceId === "all");
              if (sourceId !== "all")
                runResourceOperation(() => selectMarketplace(sourceId));
            }}
          />
          <SearchField
            className="resource-search-field resource-market-search"
            disabled={operationPending}
            label={t.searchPlugins}
            onValueChange={setMarketplaceQuery}
            placeholder={t.searchPlugins}
            value={marketplaceQuery}
          />
        </div>
        {managementTabOptions
          .filter((option) => option.value !== "plugins")
          .map((option) => (
            <div
              aria-labelledby={option.id}
              hidden
              id={option.panelId}
              key={option.value}
              role="region"
            />
          ))}
        <div
          className="resource-marketplace-content"
          role="region"
          id="resource-management-panel-plugins"
          aria-label={t.plugins}
        >
          {renderProgressAndMessage()}
          {officePackStatus?.updateVersion && (
            <InlineNotice tone="info">
              Office:{" "}
              {office.updateAvailable.replace(
                "{version}",
                officePackStatus.updateVersion,
              )}
              <Button
                className="plugin-market-update-action"
                variant="secondary"
                size="compact"
                onClick={() => setOfficeCapabilityOpen(true)}
              >
                {office.updateNow.replace(
                  "{version}",
                  officePackStatus.updateVersion,
                )}
              </Button>
            </InlineNotice>
          )}
          {officePackStatus?.updateCheck === "error" && (
            <InlineNotice tone="warning">
              Office: {office.checkFailed}
            </InlineNotice>
          )}
          {designPackStatus?.updateVersion && (
            <InlineNotice tone="info">
              {`${uiText(locale, "App_copy.designTab")}: `}
              {designPackCopy(locale).updateAvailable.replace(
                "{version}",
                designPackStatus.updateVersion,
              )}
              <Button
                className="plugin-market-update-action"
                variant="secondary"
                size="compact"
                onClick={() => setDesignPackOpen(true)}
              >
                {designPackCopy(locale).updateNow.replace(
                  "{version}",
                  designPackStatus.updateVersion,
                )}
              </Button>
            </InlineNotice>
          )}
          {designPackStatus?.updateCheck === "error" && (
            <InlineNotice tone="warning">
              {designPackCopy(locale).checkFailed}
            </InlineNotice>
          )}

          {/* 第三方提示在来源 tab 条之上（先讲清风险再选来源）。 */}
          <div className="resource-section-heading">
            <h2>{uiText(locale, "Review02.bundledPlugins")}</h2>
            <div className="resource-risk-meta">
              <ArtemisIcon name="approval" width={14} height={14} />
              {t.thirdParty}
            </div>
          </div>

          {marketplaceTabOptions
            .filter(
              (option) => option.value !== activeMarketplaceTabOption.value,
            )
            .map((option) => (
              <div
                aria-labelledby={option.id}
                hidden
                id={option.panelId}
                key={option.value}
                role="region"
              />
            ))}
          <div
            aria-labelledby={activeMarketplaceTabOption.id}
            className="plugin-market-groups"
            id={activeMarketplaceTabOption.panelId}
            role="region"
          >
            {(allMarkets ||
              selectedMarketplaceView === "bundled" ||
              marketplaceFilter) && (
              <div className="plugin-market-grid">
                {(!marketplaceFilter ||
                  `office word excel powerpoint pdf ${office.runtime}`
                    .toLowerCase()
                    .includes(marketplaceFilter)) &&
                  renderOfficePackCard()}
                {!marketplaceFilter && renderDesignPackCard()}
                {selectedMarketplaceView === "bundled" &&
                  !marketplaceFilter &&
                  selectedMarketplacePlugins.map((plugin) =>
                    renderPluginCard(plugin, "bundled"),
                  )}
              </div>
            )}
            {marketplaceGroups
              .filter(
                () =>
                  selectedMarketplaceView !== "bundled" ||
                  Boolean(marketplaceFilter),
              )
              .map((group) => (
                <section
                  className="plugin-market-group"
                  key={`${group.sourceId ?? "group"}:${group.title}`}
                >
                  <h2>
                    {marketplaceFilter
                      ? group.title
                      : pluginPageText(
                          localizedPluginCategory(group.title, locale),
                        )}
                  </h2>
                  <div className="plugin-market-grid">
                    {group.plugins.map((plugin) =>
                      renderPluginCard(plugin, group.sourceId),
                    )}
                  </div>
                </section>
              ))}
            {!searching &&
              marketplaceGroups.length === 0 &&
              selectedMarketplaceView !== "bundled" &&
              !(
                marketplaceFilter &&
                `office word excel powerpoint pdf ${office.runtime}`
                  .toLowerCase()
                  .includes(marketplaceFilter)
              ) && <EmptyResource>{t.noMarketplaceResults}</EmptyResource>}
          </div>

          {mcpServers.some(
            (server) =>
              server.config.enabled &&
              server.config.resourceKind !== "connector",
          ) && (
            <ManagementSection
              title={uiText(locale, "Review01.enabledServers")}
              actions={
                <Button variant="quiet" onClick={() => openManagement("mcp")}>
                  {t.mcp} {managementCounts.mcp} ›
                </Button>
              }
            >
              {mcpServers
                .filter(
                  (server) =>
                    server.config.enabled &&
                    server.config.resourceKind !== "connector",
                )
                .slice(0, 4)
                .map((server) => (
                  <ManagementRow
                    key={server.config.id}
                    title={server.config.name}
                    leading={<ArtemisIcon name="mcp" />}
                    description={server.state}
                  />
                ))}
            </ManagementSection>
          )}
          <ManagementSection
            actions={
              <IconButton
                className="resource-icon-button"
                disabled={operationPending}
                icon={<GearIcon />}
                label={t.manage}
                onClick={() => openManagement()}
                title={t.manage}
              />
            }
            className="resource-installed-overview"
            title={`${t.manage} · ${t.plugins}`}
          >
            <div className="resource-installed-list">
              {installedPacks.map(renderInstalledPack)}
              {installedTiles
                .filter((item) => item.kind === "plugin")
                .map((item) => (
                  <ManagementRow
                    className="resource-installed-row"
                    title={item.name}
                    description={item.description}
                    leading={
                      <ResourceAvatar
                        brandColor={item.brandColor}
                        iconKey={item.iconKey}
                        iconDataUrl={item.iconDataUrl}
                        pluginName={item.pluginName}
                        kind={item.kind}
                        name={item.name}
                      />
                    }
                    key={item.id}
                    actions={
                      <>
                        <span
                          className="resource-capability-status"
                          data-state={
                            item.needsAttention
                              ? "warning"
                              : item.enabled
                                ? "enabled"
                                : "disabled"
                          }
                        >
                          {item.status ??
                            (item.enabled ? t.enabled : t.disabled)}
                        </span>
                        <Button
                          variant="quiet"
                          className="management-text-action"
                          disabled={operationPending || Boolean(busyId)}
                          label={`${item.actionLabel ?? t.configure} ${item.name}`}
                          onClick={item.configure}
                        >
                          {item.actionLabel ?? t.configure}
                        </Button>
                        <Switch
                          checked={item.enabled}
                          label={`${t.enabled}: ${item.name}`}
                          labelVisibility="hidden"
                          disabled={
                            operationPending ||
                            Boolean(busyId) ||
                            pendingToggleIds.has(item.id) ||
                            item.disabled
                          }
                          onCheckedChange={(enabled) =>
                            runToggleOperation(item.id, () =>
                              item.toggle(enabled),
                            )
                          }
                        />
                      </>
                    }
                  />
                ))}
              {installedPacks.length === 0 &&
                !installedTiles.some((item) => item.kind === "plugin") && (
                  <span className="resource-empty-inline">{t.noPlugins}</span>
                )}
            </div>
          </ManagementSection>
        </div>
        {pluginInstallDraft && (
          <PluginInstallDialog
            plugin={pluginInstallDraft}
            displayName={pluginDisplayName(pluginInstallDraft)}
            locale={locale}
            onCancel={() => setPluginInstallDraft(undefined)}
            onInstall={() => {
              setPluginInstallDraft(undefined);
              runResourceOperation(async () => {
                await installPlugin(pluginInstallDraft);
              });
            }}
          />
        )}
        {renderPluginUninstall()}
        {renderPluginConnection()}
      </ResourceSurface>
    );
  }

  const managementSearchLabel =
    managementTab === "plugins"
      ? t.searchPlugins
      : managementTab === "mcp"
        ? `${t.searchInstalled} · ${t.mcp}`
        : `${t.searchInstalled} · ${t.skills}`;

  return (
    <ResourceSurface
      busy={
        operationPending ||
        Boolean(busyId) ||
        searching ||
        Boolean(installProgress)
      }
      className="resource-page resource-management-page"
      label={`${t.manage}: ${t[managementTab]}`}
    >
      {headerActionTarget && createPortal(headerActions, headerActionTarget)}
      {resourceHeader}
      <div className="resource-management-toolbar">
        {resourceTabs}
        <SearchField
          className="resource-search-field resource-management-search"
          disabled={operationPending}
          label={managementSearchLabel}
          onValueChange={setManagementQuery}
          placeholder={managementSearchLabel}
          size="compact"
          value={managementQuery}
        />
      </div>

      {renderProgressAndMessage()}

      {managementTabOptions
        .filter((option) => option.value !== managementTab)
        .map((option) => (
          <div
            aria-labelledby={option.id}
            hidden
            id={option.panelId}
            key={option.value}
            role="region"
          />
        ))}

      {managementTab === "plugins" && (
        <ManagementSection
          actions={
            <Button
              className="resource-add-button subtle"
              disabled={operationPending}
              icon={<PlusIcon />}
              onClick={() => {
                setAddPluginReturnMode("manage");
                setMode("add-plugin");
              }}
            >
              {t.addPlugin}
            </Button>
          }
          className="resource-management-section"
          id={activeManagementTabOption.panelId}
          labelledBy={activeManagementTabOption.id}
          role="region"
          title={t.plugins}
        >
          <div className="resource-management-list">
            {visibleInstalledPacks.map(renderInstalledPack)}
            {visibleInstalledPlugins.map((plugin) => {
              const visual = visualForPlugin(plugin);
              const unavailable = mcpServers.filter(
                (server) =>
                  plugin.mcpServerIds.includes(server.config.id) &&
                  server.config.enabled &&
                  [
                    "configuration-required",
                    "authorization-required",
                    "failed",
                  ].includes(server.state),
              );
              return (
                <ManagementRow
                  actions={
                    <div className="resource-row-actions">
                      {plugin.hasHooks && onReviewHooks && (
                        <Button
                          variant="quiet"
                          size="compact"
                          icon={<ArtemisIcon name="hooks" />}
                          onClick={(event) =>
                            onReviewHooks(plugin.id, event.currentTarget)
                          }
                        >
                          {uiText(locale, "Hooks.title")}
                        </Button>
                      )}

                      {pluginHasConnection(plugin) && (
                        <Button
                          variant="quiet"
                          disabled={operationPending || busyId === plugin.id}
                          onClick={() => setConnectionPlugin(plugin)}
                        >
                          {t.configure}
                        </Button>
                      )}
                      {!pluginHasConnection(plugin) && unavailable[0] ? (
                        <Button
                          variant="quiet"
                          disabled={operationPending}
                          onClick={() => openMcpEditor(unavailable[0])}
                        >
                          {t.configure}
                        </Button>
                      ) : null}
                      <IconButton
                        className="resource-icon-button"
                        disabled={operationPending || busyId === plugin.id}
                        icon={<RefreshIcon />}
                        label={`${t.update} ${pluginDisplayName(plugin)}`}
                        onClick={() =>
                          runResourceOperation(() => updatePlugin(plugin))
                        }
                        title={t.update}
                      />
                      <IconButton
                        className="resource-icon-button management-destructive-action"
                        disabled={operationPending || busyId === plugin.id}
                        icon={<TrashIcon />}
                        label={`${t.remove} ${pluginDisplayName(plugin)}`}
                        onClick={() => setPluginUninstallDraft(plugin)}
                        title={t.remove}
                        variant="quiet"
                      />
                      <Switch
                        checked={pluginIsEnabled(plugin)}
                        className="resource-switch"
                        disabled={
                          operationPending ||
                          busyId === plugin.id ||
                          pendingToggleIds.has(`plugin:${plugin.id}`) ||
                          (!plugin.installable && !pluginIsEnabled(plugin))
                        }
                        label={pluginIsEnabled(plugin) ? t.enabled : t.disabled}
                        labelVisibility="hidden"
                        onCheckedChange={(enabled) =>
                          runToggleOperation(`plugin:${plugin.id}`, () =>
                            setPluginEnabled(plugin, enabled),
                          )
                        }
                        title={pluginIsEnabled(plugin) ? t.enabled : t.disabled}
                      />
                    </div>
                  }
                  className="resource-management-row"
                  description={
                    <>
                      <span>
                        {plugin.installable
                          ? pluginDescription(plugin)
                          : t.needsSetup}
                      </span>
                      <span className="plugin-market-source">
                        {t.marketplaceSource}: {pluginMarketplaceLabel(plugin)}
                      </span>
                      {unavailable.map((server) => (
                        <span key={server.config.id} role="status">
                          {server.config.name}:{" "}
                          {statusText(locale, server.state)}
                          {server.error ? ` · ${server.error}` : ""}
                        </span>
                      ))}
                    </>
                  }
                  key={plugin.id}
                  leading={
                    <ResourceAvatar
                      brandColor={visual.brandColor}
                      iconDataUrl={visual.iconDataUrl}
                      iconKey={visual.iconKey}
                      kind="plugin"
                      name={plugin.name}
                    />
                  }
                  title={pluginDisplayName(plugin)}
                />
              );
            })}
            {visibleExtensions.map((extension) => (
              <ManagementRow
                actions={
                  <div className="resource-row-actions">
                    <Button
                      className="resource-inline-action"
                      variant="secondary"
                      disabled={
                        operationPending ||
                        busyId === extension.config.id ||
                        !extension.config.enabled
                      }
                      label={`${t.extensionNetwork}: ${extension.config.name}`}
                      onClick={() =>
                        runResourceOperation(() =>
                          setExtensionNetwork(
                            extension.config.id,
                            !extension.config.allowNetwork,
                          ),
                        )
                      }
                      selected={extension.config.allowNetwork}
                      title={t.extensionNetwork}
                    >
                      {t.extensionNetwork}
                    </Button>
                    {extension.state === "changed" && (
                      <IconButton
                        className="resource-icon-button"
                        disabled={
                          operationPending || busyId === extension.config.id
                        }
                        icon={<RefreshIcon />}
                        label={`${t.retrust}: ${extension.config.name}`}
                        onClick={() =>
                          runResourceOperation(() =>
                            retrustExtension(extension.config.id),
                          )
                        }
                        title={t.retrust}
                      />
                    )}
                    <IconButton
                      className="resource-icon-button"
                      disabled={
                        operationPending || busyId === extension.config.id
                      }
                      icon={<TrashIcon />}
                      label={`${t.remove} ${extension.config.name}`}
                      onClick={() =>
                        runResourceOperation(() =>
                          removeExtension(extension.config.id),
                        )
                      }
                      title={t.remove}
                      variant="danger"
                    />
                    <Switch
                      checked={extension.config.enabled}
                      className="resource-switch"
                      disabled={
                        operationPending ||
                        busyId === extension.config.id ||
                        pendingToggleIds.has(`extension:${extension.config.id}`)
                      }
                      label={extension.config.enabled ? t.enabled : t.disabled}
                      labelVisibility="hidden"
                      onCheckedChange={(enabled) =>
                        runToggleOperation(
                          `extension:${extension.config.id}`,
                          () =>
                            setExtensionEnabled(extension.config.id, enabled),
                        )
                      }
                      title={extension.config.enabled ? t.enabled : t.disabled}
                    />
                  </div>
                }
                className="resource-management-row"
                description={
                  extension.state === "changed"
                    ? t.extensionChanged
                    : `${statusText(locale, extension.state)} · ${extension.tools.length} ${t.tools}`
                }
                key={extension.config.id}
                leading={
                  <ResourceAvatar kind="plugin" name={extension.config.name} />
                }
                title={extension.config.name}
              />
            ))}
            {visibleInstalledPacks.length === 0 &&
              visibleInstalledPlugins.length === 0 &&
              visibleExtensions.length === 0 && (
                <EmptyResource>{t.noPlugins}</EmptyResource>
              )}
          </div>
        </ManagementSection>
      )}

      {managementTab === "mcp" && (
        <ManagementSection
          actions={
            <div className="resource-list-heading-actions">
              <Button
                className="resource-add-button subtle"
                disabled={operationPending}
                icon={<PlusIcon />}
                onClick={() => toggleCatalogDiscovery("mcp")}
              >
                {t.browseOfficialMcp}
              </Button>
              <Button
                className="resource-add-button subtle"
                disabled={operationPending}
                icon={<PlusIcon />}
                onClick={() => openMcpEditor()}
              >
                {t.addMcp}
              </Button>
            </div>
          }
          className="resource-management-section resource-mcp-section"
          id={activeManagementTabOption.panelId}
          labelledBy={activeManagementTabOption.id}
          role="region"
          title={t.mcp}
        >
          {discoveryOpen && (
            <ManagementCard className="resource-discovery-panel">
              <form
                onSubmit={(event) => runResourceSubmit(event, searchCatalog)}
              >
                <SearchField
                  disabled={operationPending}
                  inputRef={catalogSearchRef}
                  label={t.searchMcp}
                  onValueChange={setCatalogQuery}
                  placeholder={t.searchMcp}
                  value={catalogQuery}
                />
                <Button
                  disabled={
                    operationPending || !catalogQuery.trim() || searching
                  }
                  type="submit"
                >
                  {catalogSearchPhase.mcp === "searching"
                    ? t.searchingMcp
                    : t.searchMcp}
                </Button>
              </form>
              <div className="resource-discovery-results">
                {catalogSearchPhase.mcp === "searching" ? (
                  <CatalogSearchNotice loading>
                    {t.searchingMcp}
                  </CatalogSearchNotice>
                ) : mcpResults.length > 0 ? (
                  mcpResults.map((item) => (
                    <ManagementRow
                      actions={
                        <Button
                          disabled={
                            operationPending ||
                            item.installed ||
                            !item.installable ||
                            busyId === item.configId ||
                            installProgress !== undefined
                          }
                          onClick={() =>
                            runResourceOperation(() => installMcp(item))
                          }
                        >
                          {item.installed
                            ? t.installedLabel
                            : item.installable
                              ? item.installMode === "needs-input"
                                ? t.configureInstall
                                : t.install
                              : t.needsSetup}
                        </Button>
                      }
                      className="resource-discovery-row"
                      description={
                        <>
                          <span>{item.description}</span>
                          <span className="resource-discovery-detail">
                            {item.installOption?.detail ?? item.reason}
                          </span>
                        </>
                      }
                      key={item.registryName}
                      leading={<ResourceAvatar kind="mcp" name={item.title} />}
                      title={item.title}
                    />
                  ))
                ) : (
                  <CatalogSearchNotice>
                    {catalogSearchPhase.mcp === "complete"
                      ? t.noMcpCatalogResults
                      : t.noCatalogResults}
                  </CatalogSearchNotice>
                )}
              </div>
            </ManagementCard>
          )}
          <div className="resource-management-list resource-mcp-list grouped">
            {visibleMcp.map((server) => {
              const owner = owningPluginForMcp(server);
              const displayName = owner
                ? pluginPageText(server.config.name)
                : server.config.name;
              const visual = visualForMcp(server);
              return (
                <ManagementRow
                  actions={
                    <div className="resource-row-actions">
                      <IconButton
                        className="resource-icon-button"
                        disabled={operationPending}
                        icon={<GearIcon />}
                        label={`${t.addMcp}: ${displayName}`}
                        onClick={() => openMcpEditor(server)}
                        title={t.addMcp}
                      />
                      <IconButton
                        className="resource-icon-button resource-remove-button"
                        disabled={
                          operationPending ||
                          busyId === server.config.id ||
                          pendingToggleIds.has(`mcp:${server.config.id}`) ||
                          managedMcpIds.has(server.config.id)
                        }
                        icon={<TrashIcon />}
                        label={`${t.removeMcpAction} ${displayName}`}
                        onClick={() =>
                          setResourceRemovalDraft({ kind: "mcp", server })
                        }
                        title={
                          managedMcpIds.has(server.config.id)
                            ? t.managedByPlugin
                            : t.removeMcpAction
                        }
                        variant="quiet"
                      />
                      <Switch
                        checked={server.config.enabled}
                        className="resource-switch"
                        disabled={
                          operationPending ||
                          busyId === server.config.id ||
                          pendingToggleIds.has(`mcp:${server.config.id}`)
                        }
                        label={server.config.enabled ? t.enabled : t.disabled}
                        labelVisibility="hidden"
                        onCheckedChange={(enabled) =>
                          runToggleOperation(`mcp:${server.config.id}`, () =>
                            setMcpEnabled(server.config.id, enabled),
                          )
                        }
                        title={server.config.enabled ? t.enabled : t.disabled}
                      />
                    </div>
                  }
                  className="resource-management-row resource-mcp-row"
                  description={
                    <span className="resource-mcp-chips">
                      {server.config.transport === "stdio" ? (
                        <>
                          <span className="resource-mcp-local">
                            <span
                              data-mode={
                                server.config.fullAccess
                                  ? "compatibility"
                                  : "sandbox"
                              }
                              title={uiText(
                                locale,
                                server.config.fullAccess
                                  ? "McpServerEditor_labels.mcpFullAccessHint"
                                  : "McpServerEditor_labels.mcpAllowNetworkHint",
                              )}
                            >
                              <ArtemisIcon
                                name={
                                  server.config.fullAccess ? "alert" : "sandbox"
                                }
                              />
                              {server.config.fullAccess
                                ? uiText(locale, "Review05.compatibility")
                                : uiText(locale, "ResourceCenter.sandbox")}
                            </span>
                            <span className="resource-mcp-scope">
                              {uiText(
                                locale,
                                server.config.fullAccess
                                  ? "Review05.fullPermissions"
                                  : "Review05.workspaceOnly",
                              )}
                            </span>
                          </span>
                          <span>
                            {uiText(locale, "Review03.network")}
                            {locale.startsWith("zh") ? "：" : ": "}
                            {server.config.fullAccess ||
                            server.config.allowNetwork
                              ? t.enabled
                              : uiText(locale, "Review03.networkDisabled")}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="resource-mcp-remote">
                            <span data-mode="remote">
                              <ArtemisIcon name="browser" />
                              {uiText(locale, "Review04.remote")}
                            </span>
                            <bdi dir="ltr">
                              {new URL(server.config.url).hostname}
                            </bdi>
                          </span>
                          <span>
                            {uiText(locale, "Review03.network")}
                            {locale.startsWith("zh") ? "：" : ": "}—
                          </span>
                        </>
                      )}
                      <span
                        className="resource-mcp-connection"
                        data-state={
                          server.config.enabled ? server.state : "disabled"
                        }
                      >
                        {!server.config.enabled
                          ? t.disabled
                          : server.state === "connected"
                            ? t.connected
                            : statusText(locale, server.state)}
                      </span>
                    </span>
                  }
                  key={server.config.id}
                  leading={
                    <ResourceAvatar
                      brandColor={visual.brandColor}
                      iconDataUrl={visual.iconDataUrl}
                      iconKey={visual.iconKey}
                      pluginName={visual.pluginName}
                      kind="mcp"
                      disabled={!server.config.enabled}
                      command={
                        server.config.transport === "stdio"
                          ? [server.config.command, ...server.config.args].join(
                              " ",
                            )
                          : undefined
                      }
                      name={displayName}
                    />
                  }
                  title={
                    <>
                      <span className="resource-mcp-name">{displayName}</span>
                      <span className="resource-mcp-tools">
                        {owner
                          ? `${t.fromPlugins}: ${pluginDisplayName(owner)} · `
                          : ""}
                        {server.tools.length} {t.tools}
                        {server.error ? ` · ${server.error}` : ""}
                      </span>
                    </>
                  }
                />
              );
            })}
            {visibleMcp.length === 0 && (
              <EmptyResource>{t.noMcp}</EmptyResource>
            )}
          </div>
        </ManagementSection>
      )}

      {managementTab === "skills" && (
        <ManagementSection
          actions={
            <div className="resource-list-heading-actions">
              <Button
                className="resource-add-button subtle"
                disabled={operationPending}
                icon={<PlusIcon />}
                onClick={() => toggleCatalogDiscovery("skills")}
              >
                {t.browseSkills}
              </Button>
              <Button
                className="resource-add-button subtle"
                disabled={operationPending || busyId === "local-skill"}
                icon={<PlusIcon />}
                onClick={() => runResourceOperation(installLocalSkill)}
              >
                {t.addSkill}
              </Button>
            </div>
          }
          className="resource-management-section resource-skills-section"
          id={activeManagementTabOption.panelId}
          labelledBy={activeManagementTabOption.id}
          role="region"
          title={t.skills}
        >
          {discoveryOpen && (
            <ManagementCard className="resource-discovery-panel">
              <form
                onSubmit={(event) => runResourceSubmit(event, searchCatalog)}
              >
                <SearchField
                  disabled={operationPending}
                  inputRef={catalogSearchRef}
                  label={t.searchSkills}
                  onValueChange={setCatalogQuery}
                  placeholder={t.searchSkills}
                  value={catalogQuery}
                />
                <Button
                  disabled={
                    operationPending || !catalogQuery.trim() || searching
                  }
                  type="submit"
                >
                  {catalogSearchPhase.skills === "searching"
                    ? t.searchingSkills
                    : t.searchSkills}
                </Button>
              </form>
              <div className="resource-discovery-results">
                {catalogSearchPhase.skills === "searching" ? (
                  <CatalogSearchNotice loading>
                    {t.searchingSkills}
                  </CatalogSearchNotice>
                ) : skillResults.length > 0 ? (
                  skillResults.map((item) => (
                    <ManagementRow
                      actions={
                        <Button
                          disabled={
                            operationPending ||
                            item.installed ||
                            busyId === item.id ||
                            installProgress !== undefined
                          }
                          onClick={() =>
                            runResourceOperation(() => installSkill(item))
                          }
                        >
                          {item.installed ? t.installedLabel : t.install}
                        </Button>
                      }
                      className="resource-discovery-row"
                      description={item.source}
                      key={item.id}
                      leading={<ResourceAvatar kind="skill" name={item.name} />}
                      title={item.name}
                    />
                  ))
                ) : (
                  <CatalogSearchNotice>
                    {catalogSearchPhase.skills === "complete"
                      ? t.noSkillCatalogResults
                      : t.noCatalogResults}
                  </CatalogSearchNotice>
                )}
              </div>
            </ManagementCard>
          )}
          <div className="resource-management-list">
            {visibleSkills.map((skill) => {
              const visual = visualForSkill(skill);
              const owner = owningPluginForSkill(skill);
              return (
                <ManagementRow
                  actions={
                    <div className="resource-row-actions">
                      <span
                        className="resource-skill-source"
                        dir={
                          owner || skill.source === "builtin" ? "auto" : "ltr"
                        }
                      >
                        {owner
                          ? pluginDisplayName(owner)
                          : skill.source === "builtin"
                            ? uiText(
                                locale,
                                "SettingsPanel_labels.providerConfigBuiltin",
                              )
                            : skill.path
                                .replaceAll("\\", "/")
                                .replace(
                                  /^(?:[a-z]:\/Users\/[^/]+|\/Users\/[^/]+|\/home\/[^/]+)/i,
                                  "~",
                                )
                                .replace(/\/SKILL\.md$/i, "")
                                .replace(/\/[^/]+$/, "")}
                      </span>
                      <IconButton
                        className="resource-icon-button resource-remove-button"
                        disabled={
                          operationPending ||
                          busyId === skill.id ||
                          pendingToggleIds.has(`skill:${skill.id}`) ||
                          Boolean(owner)
                        }
                        icon={<TrashIcon />}
                        label={`${t.remove} ${skill.name}`}
                        onClick={() =>
                          setResourceRemovalDraft({ kind: "skill", skill })
                        }
                        title={owner ? t.managedByPlugin : t.remove}
                        variant="quiet"
                      />
                      <Switch
                        checked={skill.enabled}
                        className="resource-switch"
                        disabled={
                          operationPending ||
                          busyId === skill.id ||
                          pendingToggleIds.has(`skill:${skill.id}`)
                        }
                        label={skill.enabled ? t.enabled : t.disabled}
                        labelVisibility="hidden"
                        onCheckedChange={(enabled) =>
                          runToggleOperation(`skill:${skill.id}`, () =>
                            setSkillEnabled(skill.id, enabled),
                          )
                        }
                        title={skill.enabled ? t.enabled : t.disabled}
                      />
                    </div>
                  }
                  className="resource-management-row resource-skill-row"
                  data-disabled={!skill.enabled || undefined}
                  description={
                    <>
                      <span>{skill.description || t.skills}</span>
                    </>
                  }
                  key={skill.id}
                  leading={
                    <ResourceAvatar
                      brandColor={visual.brandColor}
                      iconDataUrl={visual.iconDataUrl}
                      iconKey={visual.iconKey}
                      pluginName={visual.pluginName}
                      kind="skill"
                      disabled={!skill.enabled}
                      name={skill.name}
                    />
                  }
                  title={skill.name}
                />
              );
            })}
            {visibleSkills.length === 0 && (
              <EmptyResource>{t.noSkills}</EmptyResource>
            )}
          </div>
        </ManagementSection>
      )}

      {renderPluginUninstall()}
      {renderPluginConnection()}
      {renderResourceRemoval()}

      {mcpInstallDraft && (
        <Dialog
          className="mcp-install-dialog-backdrop"
          closeOnBackdrop={!operationPending && busyId === undefined}
          closeOnEscape={!operationPending && busyId === undefined}
          label={t.installMcpTitle.replace(
            "{name}",
            mcpInstallDraft.item.title,
          )}
          onOpenChange={(open) => {
            if (!open && !operationPending && busyId === undefined) {
              setMcpInstallDraft(undefined);
            }
          }}
          open
        >
          <form
            className="mcp-install-dialog"
            onSubmit={(event) => runResourceSubmit(event, submitMcpInstall)}
          >
            <ManagementHeader
              description={mcpInstallDraft.item.description}
              headingLevel={2}
              title={t.installMcpTitle.replace(
                "{name}",
                mcpInstallDraft.item.title,
              )}
            />
            <div className="mcp-install-method">
              <span>{t.installMcpMethod}</span>
              <code>{mcpInstallDraft.option.detail}</code>
            </div>
            {mcpInstallDraft.option.inputs.map((field) => (
              <TextField
                autoComplete="off"
                autoFocus={field.id === mcpInstallDraft.option.inputs[0]?.id}
                description={field.description}
                disabled={operationPending}
                key={field.id}
                label={`${field.label}${field.required ? "" : ` (${t.optional})`}`}
                maxLength={32 * 1024}
                onValueChange={(value) =>
                  setMcpInstallDraft((current) =>
                    current
                      ? {
                          ...current,
                          values: {
                            ...current.values,
                            [field.id]: value,
                          },
                        }
                      : current,
                  )
                }
                required={field.required}
                type={field.secret ? "password" : "text"}
                value={mcpInstallDraft.values[field.id] ?? ""}
              />
            ))}
            {mcpInstallDraft.option.inputs.some((field) => field.secret) && (
              <InlineNotice className="mcp-install-security" tone="info">
                {t.installMcpCredentialHint}
              </InlineNotice>
            )}
            {mcpInstallDraft.option.kind === "npm-stdio" && (
              <InlineNotice className="mcp-install-warning" tone="danger">
                {t.installMcpLocalWarning}
              </InlineNotice>
            )}
            <div className="mcp-install-dialog-actions">
              <Button
                className="mcp-install-cancel"
                disabled={operationPending}
                icon={<ArtemisIcon height={15} name="close" width={15} />}
                onClick={() => setMcpInstallDraft(undefined)}
              >
                {t.cancel}
              </Button>
              <Button
                className="mcp-install-primary"
                disabled={operationPending}
                icon={<ArtemisIcon height={16} name="package" width={16} />}
                type="submit"
                variant="primary"
              >
                {t.configureInstall}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </ResourceSurface>
  );
}

export { CatalogSearchNotice } from "./resource-presentation.js";

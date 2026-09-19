import { PluginConnectionDialog } from "./PluginConnectionDialog.js";
import { bundledPluginDescription } from "../shared/bundled-plugin-copy.js";
import { statusText } from "../shared/status-text.js";
import { uiText } from "../shared/ui-text.js";
import { UI_COPY } from "../shared/ui-copy.js";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type { AppLocale } from "@artemis/protocol";
import { Button, IconButton } from "@artemis/ui/actions";
import {
  Dialog,
  EmptyState,
  InlineNotice,
  LoadingState,
} from "@artemis/ui/feedback";
import { SearchField, Select, Switch, TextField } from "@artemis/ui/forms";
import {
  ManagementCard,
  ManagementHeader,
  ManagementRow,
  ManagementSection,
  ResourceSurface,
} from "@artemis/ui/management";
import { Tabs } from "@artemis/ui/navigation";
import { MarketplaceTabs } from "./MarketplaceTabs.js";

import type {
  CodexPluginMarketplace,
  CodexPluginMarketplaceSource,
  CodexPluginMarketplaceState,
  CodexPluginMutationResult,
  CodexPluginPreview,
  InstalledCodexPlugin,
  InstalledSkill,
  McpCatalogInstallOption,
  McpCatalogItem,
  McpServerConfig,
  McpServerStatus,
  ResourceInstallProgress,
  SettingsSnapshot,
  SkillCatalogItem,
} from "../shared/api.js";
import { McpServerEditor } from "./McpServerEditor.js";
import { ArtemisIcon } from "@artemis/ui/icons";
import {
  resourceIconName,
  ResourceAvatar,
  SemanticResourceIcon,
  type ResourceIconKind,
  type ResourceIconName,
} from "./resource-icons.js";

interface ResourceCenterProps {
  locale: AppLocale;
  settings?: SettingsSnapshot;
  onConfirm(
    message: string,
    tone?: "default" | "danger",
    options?: { title?: string; acceptLabel?: string },
  ): Promise<boolean>;
  onSettingsChange(settings: SettingsSnapshot): void;
}

interface McpInstallDraft {
  item: McpCatalogItem;
  option: McpCatalogInstallOption;
  values: Record<string, string>;
}

type ManagementTab = "plugins" | "mcp" | "skills";
type CatalogSearchTab = Extract<ManagementTab, "mcp" | "skills">;
type CatalogSearchPhase = "idle" | "searching" | "complete";
type ResourceKind = ResourceIconKind;

let installedSkillsCache: InstalledSkill[] | undefined;
let installedPluginsCache: InstalledCodexPlugin[] | undefined;
let marketplaceStateCache: CodexPluginMarketplaceState | undefined;
let runtimeMarketplaceCache: CodexPluginMarketplace | undefined;
let runtimeMarketplaceLoaded = false;

function pluginPageText(value: string): string {
  return value
    .replace(/\b(?:OpenAI\s+Codex|OpenAI|Codex|ChatGPT)\b/giu, "Artemis")
    .replace(/\s{2,}/gu, " ")
    .trim();
}

async function loadInstalledSkills(): Promise<InstalledSkill[]> {
  if (!installedSkillsCache) {
    installedSkillsCache = await window.artemis.listInstalledSkills();
  }
  return installedSkillsCache;
}

async function loadInstalledPlugins(): Promise<InstalledCodexPlugin[]> {
  if (!installedPluginsCache) {
    installedPluginsCache = await window.artemis.listCodexPlugins();
  }
  return installedPluginsCache;
}

const labels = UI_COPY.ResourceCenter_labels;

function CatalogIcon({ kind }: { kind: ResourceKind }) {
  return <SemanticResourceIcon icon={resourceIconName("", kind)} />;
}

function SearchIcon() {
  return <ArtemisIcon name="search" />;
}

function GearIcon() {
  return <ArtemisIcon name="gear" />;
}

function RefreshIcon() {
  return <ArtemisIcon name="refresh" />;
}

function PlusIcon() {
  return <ArtemisIcon name="plus" />;
}

function TrashIcon() {
  return <ArtemisIcon name="trash" />;
}

function BackIcon() {
  return <ArtemisIcon name="chev-left" />;
}

function EmptyResource({ children }: { children: string }) {
  return <EmptyState className="resource-empty-state" title={children} />;
}

export function CatalogSearchNotice({
  children,
  loading = false,
}: {
  children: string;
  loading?: boolean;
}) {
  return loading ? (
    <LoadingState
      aria-atomic="true"
      aria-live="polite"
      label={children}
      lines={1}
    />
  ) : (
    <EmptyState
      aria-atomic="true"
      aria-live="polite"
      role="status"
      title={children}
    />
  );
}

const FEATURED_PLUGINS = [
  "documents",
  "pdf",
  "spreadsheets",
  "presentations",
  "figma",
  "github",
  "google-drive",
  "gmail",
  "computer-use",
  "data-analytics",
];

export function ResourceCenter({
  locale,
  settings,
  onConfirm,
  onSettingsChange,
}: ResourceCenterProps) {
  const [mode, setMode] = useState<
    "marketplace" | "manage" | "add-plugin" | "mcp-editor"
  >("marketplace");
  const [connectionPlugin, setConnectionPlugin] =
    useState<InstalledCodexPlugin>();
  const [managementTab, setManagementTab] = useState<ManagementTab>("plugins");
  const [marketplaceQuery, setMarketplaceQuery] = useState("");
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
  const [mcpServers, setMcpServers] = useState(settings?.mcpServers ?? []);
  const [skillResults, setSkillResults] = useState<SkillCatalogItem[]>([]);
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([]);
  const [marketplaceState, setMarketplaceState] = useState<
    CodexPluginMarketplaceState | undefined
  >(marketplaceStateCache);
  const [localPluginResults, setLocalPluginResults] = useState<
    CodexPluginPreview[]
  >([]);
  const [installedPlugins, setInstalledPlugins] = useState<
    InstalledCodexPlugin[]
  >([]);
  const [runtimeMarketplace, setRuntimeMarketplace] = useState<
    CodexPluginMarketplace | undefined
  >(runtimeMarketplaceCache);
  const [installProgress, setInstallProgress] =
    useState<ResourceInstallProgress>();
  const [busyId, setBusyId] = useState<string>();
  const [operationPending, setOperationPending] = useState(false);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState<string>();
  const catalogSearchRef = useRef<HTMLInputElement>(null);
  const operationPendingRef = useRef(false);
  const t = labels[locale];

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
      : window.artemis.getCodexPluginMarketplaces();
    const runtimeRequest = runtimeMarketplaceLoaded
      ? Promise.resolve(runtimeMarketplaceCache)
      : window.artemis.loadCodexRuntimeMarketplace();
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

  function applyMarketplaceState(next: CodexPluginMarketplaceState): void {
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
        await window.artemis.refreshCodexPluginMarketplace(
          sourceId,
          operationId,
        ),
      );
    } catch (error) {
      try {
        applyMarketplaceState(
          await window.artemis.getCodexPluginMarketplaces(),
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
        await window.artemis.selectCodexPluginMarketplace(sourceId),
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
      const trust = await window.artemis.inspectCodexPluginMarketplaceTrust(
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
        await window.artemis.addCodexPluginMarketplace(
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
        await window.artemis.inspectOfflineCodexPluginMarketplace();
      if (!inspected) return;
      const { trust } = inspected;
      const trustMessage = uiText(locale, "ResourceCenter.inline4", {
        value1: trust.repository,
        value2: String(trust.signingKeyFingerprint),
      });
      if (!(await onConfirm(trustMessage))) return;
      const operationId = beginInstallation("plugin", trust.displayName);
      applyMarketplaceState(
        await window.artemis.addOfflineCodexPluginMarketplace(
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
    source: CodexPluginMarketplaceSource,
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
        await window.artemis.removeCodexPluginMarketplace(source.id),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(undefined);
    }
  }

  async function moveMarketplace(
    sourceId: string,
    direction: -1 | 1,
  ): Promise<void> {
    const sourceIds = (marketplaceState?.sources ?? [])
      .filter((source) => !source.builtIn)
      .map((source) => source.id);
    const index = sourceIds.indexOf(sourceId);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= sourceIds.length) return;
    [sourceIds[index], sourceIds[destination]] = [
      sourceIds[destination]!,
      sourceIds[index]!,
    ];
    setBusyId(`marketplace:${sourceId}`);
    setMessage(undefined);
    try {
      applyMarketplaceState(
        await window.artemis.reorderCodexPluginMarketplaces(sourceIds),
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
    setBusyId(serverId);
    setMessage(undefined);
    try {
      const next = await window.artemis.setMcpServerEnabled(serverId, enabled);
      setMcpServers(next.mcpServers);
      onSettingsChange(next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(undefined);
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

  async function removeMcp(
    serverId: string,
    confirmation: string = t.confirmRemoveMcp,
  ) {
    if (!(await onConfirm(confirmation, "danger"))) return;
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
    setBusyId(skillId);
    setMessage(undefined);
    try {
      installedSkillsCache = await window.artemis.setSkillEnabled(
        skillId,
        enabled,
      );
      setInstalledSkills(installedSkillsCache);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(undefined);
    }
  }

  async function removeSkill(skill: InstalledSkill) {
    if (!(await onConfirm(t.confirmRemoveSkill, "danger"))) return;
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
    result: CodexPluginMutationResult,
    successMessage: string = t.installedNow,
  ): void {
    installedPluginsCache = result.plugins;
    installedSkillsCache = result.skills;
    setInstalledPlugins(result.plugins);
    setInstalledSkills(result.skills);
    setMcpServers(result.settings.mcpServers);
    onSettingsChange(result.settings);
    const installedIds = new Set(result.plugins.map((plugin) => plugin.id));
    setLocalPluginResults((plugins) =>
      plugins.map((plugin) => ({
        ...plugin,
        installed: installedIds.has(plugin.id),
      })),
    );
    setMessage(
      result.warnings.length ? result.warnings.join("\n") : successMessage,
    );
  }

  async function inspectLocalPlugin() {
    setBusyId("local-plugin");
    setMessage(undefined);
    try {
      const preview = await window.artemis.inspectLocalCodexPlugin();
      if (!preview) return;
      setLocalPluginResults((current) => [
        preview,
        ...current.filter((plugin) => plugin.id !== preview.id),
      ]);
      applyMarketplaceState(
        await window.artemis.selectCodexPluginMarketplace("local"),
      );
      setMode("marketplace");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(undefined);
    }
  }

  async function installPlugin(plugin: CodexPluginPreview) {
    const conflict = pluginSkillConflict(plugin);
    if (conflict) {
      setMessage(conflict);
      return;
    }
    const importableMcp = plugin.mcpServers.filter(
      (server) => server.importable,
    );
    const connectors = importableMcp.filter((server) => server.connector);
    const standaloneMcp = importableMcp.filter((server) => !server.connector);
    const details = [
      t.confirmPlugin,
      ...(plugin.skills.length
        ? [`${t.skillsCount}: ${plugin.skills.length}`]
        : []),
      ...(standaloneMcp.length
        ? [`${t.mcpCount}: ${standaloneMcp.length}`]
        : []),
      ...(connectors.length ? [`${t.appsCount}: ${connectors.length}`] : []),
      ...(plugin.unsupported.length
        ? [`${t.unsupported}: ${plugin.unsupported.join(", ")}`]
        : []),
    ].join("\n\n");
    if (
      !plugin.installable ||
      !(await onConfirm(details, "default", {
        title: pluginPageText(plugin.displayName),
        acceptLabel: t.install,
      }))
    )
      return;
    const operationId = beginInstallation(
      "plugin",
      pluginPageText(plugin.displayName),
    );
    setBusyId(plugin.id);
    setMessage(undefined);
    try {
      const result = await window.artemis.installCodexPlugin(
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
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(undefined);
      setInstallProgress(undefined);
    }
  }

  async function installRuntimePlugins() {
    if (!runtimeMarketplace || !(await onConfirm(t.confirmRequiredDocuments))) {
      return;
    }
    const operationId = beginInstallation("plugin", t.bundledPlugins);
    setBusyId("required-documents");
    setMessage(undefined);
    try {
      applyPluginMutation(
        await window.artemis.installCodexRuntimePlugins(operationId),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(undefined);
      setInstallProgress(undefined);
    }
  }

  async function updatePlugin(plugin: InstalledCodexPlugin) {
    if (!(await onConfirm(t.confirmUpdatePlugin))) return;
    const operationId = beginInstallation(
      "plugin",
      pluginPageText(plugin.displayName),
    );
    setBusyId(plugin.id);
    setMessage(undefined);
    try {
      const result = await window.artemis.updateCodexPlugin(
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
    plugin: InstalledCodexPlugin,
    enabled: boolean,
  ) {
    setBusyId(plugin.id);
    setMessage(undefined);
    try {
      applyPluginMutation(
        await window.artemis.setCodexPluginEnabled(plugin.id, enabled),
        enabled ? t.pluginEnabled : t.pluginDisabled,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(undefined);
    }
  }

  async function removePlugin(plugin: InstalledCodexPlugin) {
    if (!(await onConfirm(t.confirmRemovePlugin, "danger"))) return;
    setBusyId(plugin.id);
    setMessage(undefined);
    try {
      applyPluginMutation(
        await window.artemis.removeCodexPlugin(plugin.id),
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
    setBusyId(extensionId);
    setMessage(undefined);
    try {
      onSettingsChange(
        await window.artemis.setTrustedExtensionEnabled(extensionId, enabled),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(undefined);
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

  function pluginsForMarketplace(sourceId: string): CodexPluginPreview[] {
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
    source: CodexPluginMarketplaceSource,
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
    plugin: CodexPluginPreview,
  ): CodexPluginMarketplaceSource | undefined {
    if (plugin.source.kind === "bundled" || plugin.source.kind === "runtime") {
      return undefined;
    }
    if (plugin.source.kind !== "git") return undefined;
    const marketplaceUrl = plugin.source.marketplaceUrl.toLowerCase();
    return (marketplaceState?.sources ?? []).find(
      (source) => source.url.toLowerCase() === marketplaceUrl,
    );
  }

  function pluginMarketplaceLabel(plugin: CodexPluginPreview): string {
    if (plugin.source.kind === "local") return t.local;
    const source = marketplaceSourceForPlugin(plugin);
    if (source) return marketplaceSourceLabel(source);
    if (plugin.source.kind === "bundled" || plugin.source.kind === "runtime") {
      return t.bundledPlugins;
    }
    return `${plugin.source.marketplaceName} · ${t.marketplaceRemoved}`;
  }

  function visualForPlugin(plugin: CodexPluginPreview) {
    const bundled =
      plugin.source.kind === "bundled" || plugin.source.kind === "runtime"
        ? (runtimeMarketplace?.plugins ?? []).find(
            (candidate) => candidate.id === plugin.id,
          )
        : undefined;
    return {
      brandColor: bundled?.brandColor ?? plugin.brandColor,
      iconDataUrl: bundled?.iconDataUrl ?? plugin.iconDataUrl,
    };
  }

  function visualForSkill(skill: InstalledSkill) {
    const plugin =
      owningPluginForSkill(skill) ??
      allMarketplacePlugins.find((candidate) =>
        candidate.skills.some((preview) => preview.name === skill.name),
      );
    const visual = plugin ? visualForPlugin(plugin) : undefined;
    return {
      brandColor: visual?.brandColor,
      iconDataUrl: visual?.iconDataUrl,
      iconKey: resourceIconName(skill.name, "skill"),
    };
  }

  function visualForMcp(server: McpServerStatus) {
    const plugin =
      owningPluginForMcp(server) ??
      allMarketplacePlugins.find((candidate) =>
        candidate.mcpServers.some(
          (preview) =>
            preview.name === server.config.name ||
            server.config.name.endsWith(`: ${preview.name}`),
        ),
      );
    const visual = plugin ? visualForPlugin(plugin) : undefined;
    return {
      brandColor: visual?.brandColor,
      iconDataUrl: visual?.iconDataUrl,
      iconKey: resourceIconName(
        server.config.name || server.config.id,
        server.config.resourceKind === "connector" ? "connectors" : "mcp",
      ),
    };
  }

  function pluginIsEnabled(plugin: InstalledCodexPlugin): boolean {
    return (
      plugin.skillNames.some((name) => enabledSkillNames.has(name)) ||
      plugin.mcpServerIds.some((id) => enabledMcpIds.has(id))
    );
  }

  const selectedMarketplaceView = marketplaceState?.selectedView ?? "bundled";
  const marketplaceTabOptions = [
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
  const matchingMarketplacePlugins = (plugins: CodexPluginPreview[]) =>
    plugins.filter((plugin) => {
      return (
        !marketplaceFilter ||
        plugin.displayName.toLowerCase().includes(marketplaceFilter) ||
        plugin.name.toLowerCase().includes(marketplaceFilter) ||
        plugin.description.toLowerCase().includes(marketplaceFilter) ||
        pluginDescription(plugin).toLowerCase().includes(marketplaceFilter) ||
        plugin.category?.toLowerCase().includes(marketplaceFilter)
      );
    });
  const selectedMarketplacePlugins = matchingMarketplacePlugins(
    selectedMarketplaceView === "local"
      ? localPluginResults
      : pluginsForMarketplace(selectedMarketplaceView),
  );

  const marketplaceGroups: Array<{
    title: string;
    plugins: CodexPluginPreview[];
    sourceId?: string;
  }> = [];
  if (marketplaceFilter) {
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
    const byCategory = new Map<string, CodexPluginPreview[]>();
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
  const visibleInstalledPlugins = installedPlugins.filter((plugin) =>
    matchesManagement(
      plugin.displayName,
      plugin.name,
      plugin.shortDescription,
      plugin.description,
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
  const standaloneSkills = installedSkills.filter(
    (skill) => !managedSkillNames.has(skill.name),
  );
  const visibleSkills = standaloneSkills.filter((skill) =>
    matchesManagement(skill.name, skill.description, skill.source),
  );

  const installedTiles: Array<{
    id: string;
    name: string;
    kind: "plugin" | "skill" | "mcp" | "connectors";
    iconDataUrl?: string | undefined;
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
    ...installedPlugins.map((plugin) => {
      const visual = visualForPlugin(plugin);
      return {
        id: `plugin:${plugin.id}`,
        name: pluginPageText(plugin.displayName),
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
                  server.state === "authorization-required"
                ? t.needsSetup
                : undefined,
          needsAttention:
            server.state === "failed" ||
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
  const runtimePendingPlugins = (runtimeMarketplace?.plugins ?? []).filter(
    (plugin) => plugin.installable && !installedPluginIds.has(plugin.id),
  );

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

  function pluginSkillConflict(plugin: CodexPluginPreview): string | undefined {
    for (const skill of plugin.skills) {
      const installed = installedSkills.find(
        (candidate) => candidate.name === skill.name,
      );
      if (!installed) continue;
      if (
        (plugin.source.kind === "bundled" ||
          plugin.source.kind === "runtime") &&
        plugin.source.pluginName === skill.name
      ) {
        continue;
      }
      const owner = installedPlugins.find((candidate) =>
        candidate.skillNames.includes(skill.name),
      );
      return `${t.skillConflict}: ${pluginPageText(skill.name)} · ${pluginPageText(
        owner?.displayName ?? t.skills,
      )}`;
    }
    return undefined;
  }

  function pluginDescription(plugin: CodexPluginPreview): string {
    if (plugin.source.kind === "bundled" || plugin.source.kind === "runtime") {
      const translated = bundledPluginDescription(
        locale,
        plugin.source.pluginName,
      );
      if (translated) return translated;
    }
    return pluginPageText(
      plugin.shortDescription || plugin.description || plugin.name,
    );
  }

  function pluginHasConnection(plugin: InstalledCodexPlugin): boolean {
    return mcpServers.some(
      (server) =>
        server.config.connector &&
        plugin.mcpServerIds.includes(server.config.id),
    );
  }

  function renderPluginConnection() {
    return connectionPlugin ? (
      <PluginConnectionDialog
        key={connectionPlugin.id}
        plugin={connectionPlugin}
        locale={locale}
        closeLabel={uiText(locale, "App_copy.renameClose")}
        onClose={() => setConnectionPlugin(undefined)}
        onChanged={async () => {
          const next = await window.artemis.getSettings();
          setMcpServers(next.mcpServers);
          onSettingsChange(next);
        }}
      />
    ) : null;
  }

  function renderPluginCard(plugin: CodexPluginPreview, sourceId?: string) {
    const installed = installedPluginIds.has(plugin.id);
    const installedPlugin = installedPlugins.find(
      (candidate) => candidate.id === plugin.id,
    );
    const conflict = installed ? undefined : pluginSkillConflict(plugin);
    const displayName = pluginPageText(plugin.displayName);
    const description = pluginDescription(plugin);
    const source =
      plugin.source.kind === "bundled" || plugin.source.kind === "runtime"
        ? undefined
        : sourceId
          ? marketplaceSourceById.get(sourceId)
          : marketplaceSourceForPlugin(plugin);
    const sourceLabel = source
      ? marketplaceSourceLabel(source)
      : pluginMarketplaceLabel(plugin);
    const diagnostic = conflict
      ? conflict
      : plugin.installable
        ? plugin.warnings.join(" · ")
        : plugin.unsupported.join(", ");
    return (
      <ManagementCard className="plugin-market-card" key={plugin.id}>
        <div className="plugin-market-card-heading">
          <ResourceAvatar
            brandColor={plugin.brandColor}
            iconDataUrl={plugin.iconDataUrl}
            kind="plugin"
            name={displayName}
          />
          <strong>{displayName}</strong>
        </div>
        <div className="plugin-market-copy">
          <small>{description}</small>
          {diagnostic && (
            <InlineNotice className="plugin-market-diagnostic" tone="warning">
              {pluginPageText(diagnostic)}
            </InlineNotice>
          )}
        </div>
        <div className="plugin-market-card-footer">
          <small className="plugin-market-source">
            {t.marketplaceSource}: {sourceLabel}
          </small>
          {installed && installedPlugin ? (
            <>
              {pluginHasConnection(installedPlugin) && (
                <Button
                  variant="quiet"
                  disabled={operationPending || busyId === plugin.id}
                  onClick={() => setConnectionPlugin(installedPlugin)}
                >
                  {t.configure}
                </Button>
              )}
              <Button
                className="management-destructive-action"
                icon={<TrashIcon />}
                disabled={operationPending || busyId === plugin.id}
                onClick={() =>
                  runResourceOperation(() => removePlugin(installedPlugin))
                }
                variant="quiet"
              >
                {t.remove}
              </Button>
            </>
          ) : (
            <Button
              className="resource-inline-action"
              disabled={
                operationPending ||
                !plugin.installable ||
                Boolean(conflict) ||
                busyId === plugin.id ||
                installProgress !== undefined
              }
              onClick={() => runResourceOperation(() => installPlugin(plugin))}
              title={
                diagnostic || (plugin.installable ? t.install : t.needsSetup)
              }
            >
              {conflict
                ? t.skillConflict
                : plugin.installable
                  ? t.install
                  : t.needsSetup}
            </Button>
          )}
        </div>
      </ManagementCard>
    );
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
              label={t.backToPlugins}
              onClick={() => {
                setMode("manage");
                setManagementTab("plugins");
                setMessage(undefined);
              }}
              title={t.backToPlugins}
            />
          }
          title={t.addPlugin}
        />

        {renderProgressAndMessage()}

        <section className="resource-add-plugin-options">
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
                          <IconButton
                            disabled={
                              operationPending ||
                              index === 0 ||
                              busyId === `marketplace:${source.id}`
                            }
                            icon={<span aria-hidden="true">↑</span>}
                            label={`${t.moveMarketplaceUp}: ${source.displayName}`}
                            onClick={() =>
                              runResourceOperation(() =>
                                moveMarketplace(source.id, -1),
                              )
                            }
                            title={t.moveMarketplaceUp}
                          />
                          <IconButton
                            disabled={
                              operationPending ||
                              index === sources.length - 1 ||
                              busyId === `marketplace:${source.id}`
                            }
                            icon={<span aria-hidden="true">↓</span>}
                            label={`${t.moveMarketplaceDown}: ${source.displayName}`}
                            onClick={() =>
                              runResourceOperation(() =>
                                moveMarketplace(source.id, 1),
                              )
                            }
                            title={t.moveMarketplaceDown}
                          />
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
                            variant="danger"
                          />
                        </>
                      }
                      className="resource-marketplace-source-row"
                      description={`${source.repository}${source.offline ? ` · ${t.offline}` : ""}`}
                      key={source.id}
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
      installedPlugins.length + (settings?.trustedExtensions.length ?? 0),
    mcp: mcpServers.filter(
      (server) => server.config.resourceKind !== "connector",
    ).length,
    skills: standaloneSkills.length,
  };
  const managementTabOptions = (["plugins", "mcp", "skills"] as const).map(
    (tab) => ({
      id: `resource-management-tab-${tab}`,
      label: `${t[tab]} ${managementCounts[tab]}`,
      panelId: `resource-management-panel-${tab}`,
      value: tab,
    }),
  );
  const activeManagementTabOption = managementTabOptions.find(
    (option) => option.value === managementTab,
  )!;

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
        <ManagementHeader
          leading={
            <span className="secondary-page-icon">
              <ArtemisIcon name="resource" width={19} height={19} />
            </span>
          }
          className="resource-page-header"
          description={t.marketDescription}
          title={t.title}
          actions={
            <div className="resource-header-actions">
              <IconButton
                className="resource-icon-button"
                disabled={
                  operationPending ||
                  selectedMarketplaceView === "local" ||
                  marketplaceSourceById.get(selectedMarketplaceView)?.builtIn ||
                  marketplaceSourceById.get(selectedMarketplaceView)
                    ?.refreshable === false ||
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
                onClick={() => setMode("add-plugin")}
              >
                {t.add}
              </Button>
            </div>
          }
        />
        <Tabs
          className="resource-category-tabs"
          disabled={operationPending}
          label={t.manage}
          onValueChange={(tab) => openManagement(tab)}
          options={managementTabOptions.map((option) => ({
            ...option,
            label: t[option.value],
          }))}
          size="compact"
          value="plugins"
        />
        {managementTabOptions
          .filter((option) => option.value !== "plugins")
          .map((option) => (
            <div
              aria-labelledby={option.id}
              hidden
              id={option.panelId}
              key={option.value}
              role="tabpanel"
            />
          ))}
        <div
          className="resource-marketplace-content"
          role="tabpanel"
          id="resource-management-panel-plugins"
          aria-labelledby="resource-management-tab-plugins"
        >
          <SearchField
            className="resource-search-field resource-market-search"
            disabled={operationPending}
            label={t.searchPlugins}
            onValueChange={setMarketplaceQuery}
            placeholder={t.searchPlugins}
            value={marketplaceQuery}
          />

          {renderProgressAndMessage()}

          <MarketplaceTabs
            disabled={operationPending}
            label={t.marketplaces}
            onValueChange={(sourceId) =>
              runResourceOperation(() => selectMarketplace(sourceId))
            }
            options={marketplaceTabOptions}
            size="compact"
            value={activeMarketplaceTabOption.value}
          />

          <InlineNotice tone="warning">{t.thirdParty}</InlineNotice>

          {selectedMarketplaceView === "bundled" &&
            !marketplaceFilter &&
            runtimePendingPlugins.length > 0 && (
              <ManagementCard className="resource-runtime-banner">
                <div>
                  <strong>{t.installRequiredDocuments}</strong>
                  <small>{t.requiredDocumentsDescription}</small>
                </div>
                <Button
                  disabled={
                    operationPending ||
                    busyId === "required-documents" ||
                    installProgress !== undefined
                  }
                  onClick={() => runResourceOperation(installRuntimePlugins)}
                >
                  {t.installRequiredDocuments}
                </Button>
              </ManagementCard>
            )}

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
                role="tabpanel"
              />
            ))}
          <div
            aria-labelledby={activeMarketplaceTabOption.id}
            className="plugin-market-groups"
            id={activeMarketplaceTabOption.panelId}
            role="tabpanel"
          >
            {marketplaceGroups.map((group) => (
              <section
                className="plugin-market-group"
                key={`${group.sourceId ?? "group"}:${group.title}`}
              >
                <h2>
                  {marketplaceFilter
                    ? group.title
                    : pluginPageText(group.title)}
                </h2>
                <div className="plugin-market-grid">
                  {group.plugins.map((plugin) =>
                    renderPluginCard(plugin, group.sourceId),
                  )}
                </div>
              </section>
            ))}
            {!searching && marketplaceGroups.length === 0 && (
              <EmptyResource>{t.noMarketplaceResults}</EmptyResource>
            )}
          </div>

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
            title={t.manage}
          >
            <div className="resource-installed-list">
              {installedTiles.map((item) => (
                <ManagementRow
                  className="resource-installed-row"
                  title={item.name}
                  description={item.description}
                  leading={
                    <ResourceAvatar
                      brandColor={item.brandColor}
                      iconKey={item.iconKey}
                      iconDataUrl={item.iconDataUrl}
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
                        {item.status ?? (item.enabled ? t.enabled : t.disabled)}
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
                          operationPending || Boolean(busyId) || item.disabled
                        }
                        onCheckedChange={(enabled) =>
                          runResourceOperation(() => item.toggle(enabled))
                        }
                      />
                    </>
                  }
                />
              ))}
              {installedTiles.length === 0 && (
                <span className="resource-empty-inline">{t.noPlugins}</span>
              )}
            </div>
          </ManagementSection>
        </div>
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
      <ManagementHeader
        className="resource-page-header resource-management-header"
        description={t.manageDescription}
        leading={
          <IconButton
            className="resource-back-button"
            disabled={operationPending}
            icon={<BackIcon />}
            label={t.backToMarketplace}
            onClick={() => {
              setMode("marketplace");
              setMessage(undefined);
            }}
            title={t.backToMarketplace}
          />
        }
        title={t.title}
      />

      <div className="resource-management-toolbar">
        <Tabs
          className="resource-management-tabs resource-category-tabs"
          disabled={operationPending}
          label={t.manage}
          onValueChange={(tab) => {
            if (tab === "plugins" && managementTab !== "plugins") {
              setMode("marketplace");
              setManagementTab(tab);
              setMessage(undefined);
            } else switchManagementTab(tab);
          }}
          options={managementTabOptions.map((option) => ({
            ...option,
            label: t[option.value],
          }))}
          size="compact"
          value={managementTab}
        />
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
            role="tabpanel"
          />
        ))}

      {managementTab === "plugins" && (
        <ManagementSection
          actions={
            <Button
              className="resource-add-button subtle"
              disabled={operationPending}
              icon={<PlusIcon />}
              onClick={() => setMode("add-plugin")}
            >
              {t.addPlugin}
            </Button>
          }
          className="resource-management-section"
          id={activeManagementTabOption.panelId}
          labelledBy={activeManagementTabOption.id}
          role="tabpanel"
          title={t.plugins}
        >
          <div className="resource-management-list">
            {visibleInstalledPlugins.map((plugin) => {
              const visual = visualForPlugin(plugin);
              return (
                <ManagementRow
                  actions={
                    <div className="resource-row-actions">
                      {pluginHasConnection(plugin) && (
                        <Button
                          variant="quiet"
                          disabled={operationPending || busyId === plugin.id}
                          onClick={() => setConnectionPlugin(plugin)}
                        >
                          {t.configure}
                        </Button>
                      )}
                      <IconButton
                        className="resource-icon-button"
                        disabled={operationPending || busyId === plugin.id}
                        icon={<RefreshIcon />}
                        label={`${t.update} ${pluginPageText(plugin.displayName)}`}
                        onClick={() =>
                          runResourceOperation(() => updatePlugin(plugin))
                        }
                        title={t.update}
                      />
                      <IconButton
                        className="resource-icon-button management-destructive-action"
                        disabled={operationPending || busyId === plugin.id}
                        icon={<TrashIcon />}
                        label={`${t.remove} ${pluginPageText(plugin.displayName)}`}
                        onClick={() =>
                          runResourceOperation(() => removePlugin(plugin))
                        }
                        title={t.remove}
                        variant="quiet"
                      />
                      <Switch
                        checked={pluginIsEnabled(plugin)}
                        className="resource-switch"
                        disabled={
                          operationPending ||
                          busyId === plugin.id ||
                          (!plugin.installable && !pluginIsEnabled(plugin))
                        }
                        label={pluginIsEnabled(plugin) ? t.enabled : t.disabled}
                        labelVisibility="hidden"
                        onCheckedChange={(enabled) =>
                          runResourceOperation(() =>
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
                    </>
                  }
                  key={plugin.id}
                  leading={
                    <ResourceAvatar
                      brandColor={visual.brandColor}
                      iconDataUrl={visual.iconDataUrl}
                      kind="plugin"
                      name={pluginPageText(plugin.displayName)}
                    />
                  }
                  title={pluginPageText(plugin.displayName)}
                />
              );
            })}
            {visibleExtensions.map((extension) => (
              <ManagementRow
                actions={
                  <div className="resource-row-actions">
                    <Button
                      className="resource-inline-action"
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
                        operationPending || busyId === extension.config.id
                      }
                      label={extension.config.enabled ? t.enabled : t.disabled}
                      labelVisibility="hidden"
                      onCheckedChange={(enabled) =>
                        runResourceOperation(() =>
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
            {visibleInstalledPlugins.length === 0 &&
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
          className="resource-management-section"
          id={activeManagementTabOption.panelId}
          labelledBy={activeManagementTabOption.id}
          role="tabpanel"
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
          <div className="resource-management-list grouped">
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
                        className="resource-icon-button"
                        disabled={
                          operationPending ||
                          busyId === server.config.id ||
                          managedMcpIds.has(server.config.id)
                        }
                        icon={<TrashIcon />}
                        label={`${t.remove} ${displayName}`}
                        onClick={() =>
                          runResourceOperation(() =>
                            removeMcp(server.config.id),
                          )
                        }
                        title={
                          managedMcpIds.has(server.config.id)
                            ? t.managedByPlugin
                            : t.remove
                        }
                        variant="danger"
                      />
                      <Switch
                        checked={server.state === "connected"}
                        className="resource-switch"
                        disabled={
                          operationPending || busyId === server.config.id
                        }
                        label={
                          server.state === "connected" ? t.enabled : t.disabled
                        }
                        labelVisibility="hidden"
                        onCheckedChange={(enabled) =>
                          runResourceOperation(() =>
                            setMcpEnabled(server.config.id, enabled),
                          )
                        }
                        title={
                          server.state === "connected" ? t.enabled : t.disabled
                        }
                      />
                    </div>
                  }
                  className="resource-management-row"
                  description={`${owner ? `${t.fromPlugins}: ${pluginPageText(owner.displayName)} · ` : ""}${!server.config.enabled ? t.disabled : server.state === "connected" ? t.connected : statusText(locale, server.state)} · ${server.tools.length} ${t.tools}`}
                  key={server.config.id}
                  leading={
                    <ResourceAvatar
                      brandColor={visual.brandColor}
                      iconDataUrl={visual.iconDataUrl}
                      iconKey={visual.iconKey}
                      kind="mcp"
                      name={displayName}
                    />
                  }
                  title={displayName}
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
          className="resource-management-section"
          id={activeManagementTabOption.panelId}
          labelledBy={activeManagementTabOption.id}
          role="tabpanel"
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
              return (
                <ManagementRow
                  actions={
                    <div className="resource-row-actions">
                      <IconButton
                        className="resource-icon-button"
                        disabled={operationPending || busyId === skill.id}
                        icon={<TrashIcon />}
                        label={`${t.remove} ${skill.name}`}
                        onClick={() =>
                          runResourceOperation(() => removeSkill(skill))
                        }
                        title={t.remove}
                        variant="danger"
                      />
                      <Switch
                        checked={skill.enabled}
                        className="resource-switch"
                        disabled={operationPending || busyId === skill.id}
                        label={skill.enabled ? t.enabled : t.disabled}
                        labelVisibility="hidden"
                        onCheckedChange={(enabled) =>
                          runResourceOperation(() =>
                            setSkillEnabled(skill.id, enabled),
                          )
                        }
                        title={skill.enabled ? t.enabled : t.disabled}
                      />
                    </div>
                  }
                  className="resource-management-row"
                  description={skill.description || t.skills}
                  key={skill.id}
                  leading={
                    <ResourceAvatar
                      brandColor={visual.brandColor}
                      iconDataUrl={visual.iconDataUrl}
                      iconKey={visual.iconKey}
                      kind="skill"
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

      {renderPluginConnection()}

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

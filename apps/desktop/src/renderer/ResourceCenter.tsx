import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";

import type {
  CodexPluginMarketplace,
  CodexPluginMarketplaceSource,
  CodexPluginMarketplaceState,
  CodexPluginMutationResult,
  CodexPluginPreview,
  InstalledCodexPlugin,
  InstalledSkill,
  McpCatalogItem,
  McpServerConfig,
  McpServerStatus,
  ResourceInstallProgress,
  SettingsSnapshot,
  SkillCatalogItem,
} from "../shared/api.js";
import { McpServerEditor } from "./McpServerEditor.js";

interface ResourceCenterProps {
  locale: "en" | "zh-CN";
  settings?: SettingsSnapshot;
  onConfirm(message: string, tone?: "default" | "danger"): Promise<boolean>;
  onSettingsChange(settings: SettingsSnapshot): void;
}

type ManagementTab = "plugins" | "connectors" | "mcp" | "skills";
type ResourceKind = ManagementTab | "plugin" | "skill";
type ResourceIconKey = "node-repl" | "codegraph" | "superpowers";

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

const labels = {
  en: {
    title: "Plugins",
    marketDescription:
      "Add plugins, Connectors, Skills and MCP servers to Artemis.",
    manageDescription: "Manage plugins, Connectors, MCP servers and Skills.",
    plugins: "Plugins",
    connectors: "Connectors",
    mcp: "MCP",
    skills: "Skills",
    public: "Public",
    local: "Local",
    marketplaces: "Marketplaces",
    manageMarketplaces: "Manage GitHub marketplaces",
    marketplaceSource: "Marketplace",
    marketplaceRemoved: "Marketplace removed",
    marketplaceStale: "Stale",
    removeMarketplace: "Remove marketplace",
    confirmRemoveMarketplace:
      "Remove this marketplace? Installed plugins will remain available.",
    moveMarketplaceUp: "Move marketplace up",
    moveMarketplaceDown: "Move marketplace down",
    skillConflict: "Skill conflict",
    featured: "Featured",
    installed: "Installed",
    manage: "Manage installed capabilities",
    backToMarketplace: "Back to marketplace",
    refresh: "Refresh selected plugin marketplace",
    add: "Add",
    addPlugin: "Add plugin",
    addPluginDescription:
      "Install a plugin marketplace, a local plugin bundle, or a trusted executable extension.",
    backToPlugins: "Back to plugins",
    localPlugin: "Local plugin bundle",
    executableExtension: "Executable extension",
    executableExtensionHint:
      "Executable extensions are hash-pinned and remain subject to Artemis's extension trust policy.",
    trustExtension: "Select and trust extension",
    extensionNetwork: "Network access",
    retrust: "Trust current contents",
    extensionChanged: "Contents changed",
    addConnector: "Add Connector",
    addMcp: "Add server",
    addSkill: "Add Skill",
    browseOfficialMcp: "Browse official MCP Registry",
    browseSkills: "Find Agent Skills",
    searchPlugins: "Search plugins",
    searchInstalled: "Search installed resources",
    searchMcp: "Search the official MCP Registry",
    searchSkills: "Search Agent Skills",
    gitMarketplace: "Git marketplace",
    gitMarketplaceHint: "Public GitHub owner/repository or HTTPS URL",
    loadMarketplace: "Load marketplace",
    openOfficialMarketplace: "Public marketplace",
    publicMarketplace: "Public plugin marketplace",
    bundledPlugins: "Bundled plugins",
    inspectLocalPlugin: "Install local plugin",
    installLocalSkill: "Install local Skill",
    installRequiredDocuments: "Install required document plugins",
    requiredDocumentsDescription:
      "Install Documents, PDF, Spreadsheets and Presentations from the bundled artifact runtime.",
    confirmRequiredDocuments:
      "Install the four required document plugins and activate their bundled artifact runtime? Complete Skills and resources are copied into Artemis; credentials are not imported.",
    install: "Install",
    installedLabel: "Installed",
    installing: "Installing",
    update: "Update",
    remove: "Uninstall",
    enabled: "Enabled",
    disabled: "Disabled",
    connected: "connected",
    tools: "tools",
    source: "Source",
    noMarketplaceResults: "No matching plugins.",
    noPlugins: "No compatible plugins installed.",
    noConnectors: "No Connectors installed.",
    noMcp: "No MCP servers installed.",
    noSkills: "No global Pi Skills installed.",
    noCatalogResults: "Search to see installable capabilities.",
    needsSetup: "Unavailable",
    thirdParty:
      "Third-party capabilities can influence Agent behavior or access external services. Review the source before installing.",
    confirmMcp: "Install and connect this MCP server?",
    confirmSkill:
      "Install this third-party Skill into Pi's global Skill folder?",
    confirmPlugin:
      "Install this plugin? Skills will be enabled; MCP servers and Connectors will be installed disabled.",
    confirmUpdatePlugin:
      "Update this plugin from its original source? Modified managed resources will be protected.",
    confirmRemovePlugin:
      "Uninstall this plugin and its managed Skills, Connectors and MCP configurations?",
    confirmRemoveMcp: "Remove this MCP server?",
    confirmRemoveConnector: "Remove this Connector?",
    confirmRemoveSkill: "Uninstall this Skill?",
    confirmRemoveExtension: "Uninstall this executable extension?",
    installedNow: "Installed. New turns will load this capability.",
    removedNow: "Plugin removed.",
    mcpSaved: "MCP server saved and connected.",
    mcpRemoved: "MCP server removed.",
    pluginEnabled: "Plugin capabilities enabled.",
    pluginDisabled: "Plugin capabilities disabled.",
    supported: "Supported",
    unsupported: "Unsupported",
    skillsCount: "Skills",
    mcpCount: "MCP",
    appsCount: "Connectors",
    mcpDisabled: "MCP installs disabled",
    managedByPlugin: "Managed by a plugin; uninstall the plugin instead.",
    connectorName: "Connector name",
    connectorUrl: "HTTPS or loopback MCP endpoint",
    connectorAuth: "Authentication",
    connectorBearer: "Bearer token",
    connectorHelp:
      "Connectors use the standard MCP transport. OAuth and bearer credentials are encrypted by the operating system.",
    configure: "Configure",
    authorize: "Authorize",
    saveConnector: "Save Connector",
    standalone: "Servers",
    fromPlugins: "From plugins",
    allResults: "Results",
  },
  "zh-CN": {
    title: "插件",
    marketDescription: "为 Artemis 安装插件、Connector、Skill 与 MCP 服务器",
    manageDescription: "管理插件、Connector、MCP 和 Skill",
    plugins: "插件",
    connectors: "Connector",
    mcp: "MCP",
    skills: "Skill",
    public: "公开",
    local: "本地",
    marketplaces: "插件市场",
    manageMarketplaces: "管理 GitHub 插件市场",
    marketplaceSource: "来源市场",
    marketplaceRemoved: "来源市场已移除",
    marketplaceStale: "缓存过期",
    removeMarketplace: "移除插件市场",
    confirmRemoveMarketplace: "移除这个插件市场？已安装插件会继续保留。",
    moveMarketplaceUp: "上移插件市场",
    moveMarketplaceDown: "下移插件市场",
    skillConflict: "Skill 名称冲突",
    featured: "精选",
    installed: "已安装",
    manage: "管理已安装能力",
    backToMarketplace: "返回插件市场",
    refresh: "刷新当前插件市场",
    add: "添加",
    addPlugin: "添加插件",
    addPluginDescription: "安装插件市场、本地插件包，或受信任的可执行扩展。",
    backToPlugins: "返回插件",
    localPlugin: "本地插件包",
    executableExtension: "可执行扩展",
    executableExtensionHint:
      "可执行扩展按内容哈希锁定，并继续遵守 Artemis 的扩展信任策略。",
    trustExtension: "选择并信任扩展",
    extensionNetwork: "网络访问",
    retrust: "信任当前文件内容",
    extensionChanged: "内容已变化",
    addConnector: "添加 Connector",
    addMcp: "添加服务器",
    addSkill: "添加 Skill",
    browseOfficialMcp: "浏览官方 MCP Registry",
    browseSkills: "查找 Agent Skills",
    searchPlugins: "搜索插件",
    searchInstalled: "搜索已安装资源",
    searchMcp: "搜索官方 MCP Registry",
    searchSkills: "搜索 Agent Skills",
    gitMarketplace: "Git marketplace",
    gitMarketplaceHint: "公开 GitHub owner/repository 或 HTTPS 地址",
    loadMarketplace: "载入市场",
    openOfficialMarketplace: "公开插件市场",
    publicMarketplace: "公开插件市场",
    bundledPlugins: "随应用提供的插件",
    inspectLocalPlugin: "安装本地插件",
    installLocalSkill: "安装本地 Skill",
    installRequiredDocuments: "安装必备文档插件",
    requiredDocumentsDescription:
      "从应用内置的文档运行时安装 Documents、PDF、Spreadsheets 和 Presentations。",
    confirmRequiredDocuments:
      "安装四个必备文档插件并启用应用内置运行时？完整 Skill 与资源会复制到 Artemis，但不会导入任何凭据。",
    install: "安装",
    installedLabel: "已安装",
    installing: "正在安装",
    update: "更新",
    remove: "卸载",
    enabled: "已启用",
    disabled: "已停用",
    connected: "已连接",
    tools: "个工具",
    source: "来源",
    noMarketplaceResults: "没有匹配的插件。",
    noPlugins: "尚未安装兼容插件。",
    noConnectors: "尚未安装 Connector。",
    noMcp: "尚未安装 MCP 服务器。",
    noSkills: "尚未安装全局 Pi Skill。",
    noCatalogResults: "搜索后将在这里显示可安装能力。",
    needsSetup: "暂不可用",
    thirdParty:
      "第三方能力可能影响 Agent 行为或访问外部服务。安装前请先审查来源。",
    confirmMcp: "安装并连接这个 MCP 服务器？",
    confirmSkill: "将这个第三方 Skill 安装到 Pi 的全局 Skill 目录？",
    confirmPlugin:
      "安装这个插件？Skill 会启用，MCP 与 Connector 安装后默认停用。",
    confirmUpdatePlugin: "从原始来源更新这个插件？已修改的托管资源会受到保护。",
    confirmRemovePlugin:
      "卸载这个插件及其托管的 Skill、Connector 和 MCP 配置？",
    confirmRemoveMcp: "移除这个 MCP 服务器？",
    confirmRemoveConnector: "移除这个 Connector？",
    confirmRemoveSkill: "卸载这个 Skill？",
    confirmRemoveExtension: "卸载这个可执行扩展？",
    installedNow: "安装完成；新一轮任务将加载此能力。",
    removedNow: "插件已卸载。",
    mcpSaved: "MCP 服务器已保存并连接。",
    mcpRemoved: "MCP 服务器已移除。",
    pluginEnabled: "插件能力已启用。",
    pluginDisabled: "插件能力已停用。",
    supported: "支持",
    unsupported: "不支持",
    skillsCount: "Skills",
    mcpCount: "MCP",
    appsCount: "Connector",
    mcpDisabled: "MCP 安装后默认停用",
    managedByPlugin: "由插件托管；请改为卸载对应插件。",
    connectorName: "Connector 名称",
    connectorUrl: "HTTPS 或本机回环 MCP 地址",
    connectorAuth: "认证方式",
    connectorBearer: "Bearer Token",
    connectorHelp:
      "Connector 使用标准 MCP 传输；OAuth 与 Bearer 凭据由操作系统加密保存。",
    configure: "配置",
    authorize: "授权",
    saveConnector: "保存 Connector",
    standalone: "服务器",
    fromPlugins: "来自插件",
    allResults: "搜索结果",
  },
} as const;

function CatalogIcon({ kind }: { kind: ResourceKind }) {
  const normalized =
    kind === "plugin" ? "plugins" : kind === "skill" ? "skills" : kind;
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      {normalized === "mcp" ? (
        <>
          <circle cx="6" cy="12" r="2.5" />
          <circle cx="18" cy="7" r="2.5" />
          <circle cx="18" cy="17" r="2.5" />
          <path d="m8.4 11.2 7.2-3M8.4 12.8l7.2 3" />
        </>
      ) : normalized === "skills" ? (
        <>
          <path d="M12 3.8 14 8l4.6.7-3.3 3.2.8 4.6-4.1-2.2-4.1 2.2.8-4.6-3.3-3.2L10 8z" />
          <path d="M5 19.2h14" />
        </>
      ) : (
        <>
          <path d="M8 3v5M16 3v5M6 8h12v2.5a6 6 0 0 1-12 0V8Z" />
          <path d="M12 16.5V21M9.5 21h5" />
        </>
      )}
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <circle cx="10.7" cy="10.7" r="6.2" />
      <path d="m15.4 15.4 4.3 4.3" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="M9.7 3.4h4.6l.5 2a7.2 7.2 0 0 1 1.3.8l2-.6 2.3 4-.1.1-1.5 1.4a7.1 7.1 0 0 1 0 1.8l1.6 1.5-2.3 4-2-.6a7.2 7.2 0 0 1-1.3.8l-.5 2H9.7l-.5-2a7.2 7.2 0 0 1-1.3-.8l-2 .6-2.3-4 1.6-1.5a7.1 7.1 0 0 1 0-1.8L3.6 9.6l2.3-4 2 .6a7.2 7.2 0 0 1 1.3-.8l.5-2Z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="M19.2 8.2A8 8 0 0 0 5.3 6.1L3.5 8" />
      <path d="M3.5 4.5V8H7" />
      <path d="M4.8 15.8a8 8 0 0 0 13.9 2.1l1.8-1.9" />
      <path d="M20.5 19.5V16H17" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="M4.5 7h15M9 7V4.5h6V7M7 7l.8 13h8.4L17 7M10 10.5v6M14 10.5v6" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="m14.5 5-7 7 7 7" />
    </svg>
  );
}

function initials(name: string): string {
  const parts = name
    .trim()
    .split(/[\s._-]+/u)
    .filter(Boolean);
  return (
    parts.length > 1
      ? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`
      : name.slice(0, 2)
  ).toUpperCase();
}

function ProductIcon({ icon }: { icon: ResourceIconKey }) {
  return (
    <svg
      aria-hidden="true"
      className="resource-product-icon"
      viewBox="0 0 24 24"
    >
      {icon === "node-repl" ? (
        <>
          <path d="M5.2 5.2h13.6v13.6H5.2z" />
          <path d="m8.1 9.1 2.8 2.9-2.8 2.9M12.8 15h3.2" />
        </>
      ) : icon === "codegraph" ? (
        <>
          <circle cx="6" cy="12" r="2.2" />
          <circle cx="17.5" cy="6.5" r="2.2" />
          <circle cx="17.5" cy="17.5" r="2.2" />
          <path d="m8 11 7.4-3.5M8 13l7.4 3.5" />
        </>
      ) : (
        <>
          <path d="m12 3.6 2.1 4.5 4.9.7-3.5 3.5.8 5-4.3-2.4-4.3 2.4.8-5L5 8.8l4.9-.7z" />
          <path d="M5.2 19.2h13.6" />
        </>
      )}
    </svg>
  );
}

function ResourceAvatar({
  brandColor,
  iconKey,
  iconDataUrl,
  kind,
  name,
}: {
  brandColor?: string | undefined;
  iconKey?: ResourceIconKey | undefined;
  iconDataUrl?: string | undefined;
  kind: ResourceKind;
  name: string;
}) {
  const style = brandColor
    ? ({ "--resource-brand": brandColor } as CSSProperties)
    : undefined;
  return (
    <span className="resource-avatar" data-kind={kind} style={style}>
      {iconDataUrl ? (
        <img alt="" draggable={false} src={iconDataUrl} />
      ) : iconKey ? (
        <ProductIcon icon={iconKey} />
      ) : kind === "plugin" || kind === "plugins" ? (
        <strong aria-hidden="true">{initials(name)}</strong>
      ) : (
        <CatalogIcon kind={kind} />
      )}
    </span>
  );
}

function ResourceSwitch({
  checked,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange?(enabled: boolean): void;
}) {
  return (
    <label className="resource-switch" title={label}>
      <input
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.checked)}
        role="switch"
        type="checkbox"
      />
      <span aria-hidden="true" />
    </label>
  );
}

function EmptyResource({ children }: { children: ReactNode }) {
  return <div className="resource-empty-state">{children}</div>;
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
  const [managementTab, setManagementTab] = useState<ManagementTab>("plugins");
  const [marketplaceQuery, setMarketplaceQuery] = useState("");
  const [managementQuery, setManagementQuery] = useState("");
  const [sourceInput, setSourceInput] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [connectorPanelOpen, setConnectorPanelOpen] = useState(false);
  const [editingMcpServer, setEditingMcpServer] = useState<McpServerStatus>();
  const [connectorName, setConnectorName] = useState("");
  const [connectorUrl, setConnectorUrl] = useState("");
  const [connectorAuth, setConnectorAuth] = useState<
    "none" | "bearer" | "oauth"
  >("oauth");
  const [connectorBearer, setConnectorBearer] = useState("");
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [mcpResults, setMcpResults] = useState<McpCatalogItem[]>([]);
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
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState<string>();
  const catalogSearchRef = useRef<HTMLInputElement>(null);
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

  function focusCatalogSearch(): void {
    requestAnimationFrame(() => catalogSearchRef.current?.focus());
  }

  function applyMarketplaceState(next: CodexPluginMarketplaceState): void {
    marketplaceStateCache = next;
    setMarketplaceState(next);
    const error = next.errors.find(
      (candidate) => candidate.sourceId === next.selectedView,
    )?.message;
    const warnings = next.marketplaces.find(
      (entry) => entry.sourceId === next.selectedView,
    )?.marketplace.warnings;
    const messages = [error, ...(warnings ?? [])].filter(Boolean);
    setMessage(messages.length ? messages.join("\n") : undefined);
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

  async function addCustomMarketplace(event: FormEvent) {
    event.preventDefault();
    if (!sourceInput.trim() || searching) return;
    const operationId = beginInstallation("plugin", sourceInput.trim());
    setSearching(true);
    setMessage(undefined);
    try {
      applyMarketplaceState(
        await window.artemis.addCodexPluginMarketplace(
          sourceInput.trim(),
          operationId,
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

  async function searchCatalog(event: FormEvent) {
    event.preventDefault();
    if (!catalogQuery.trim() || searching) return;
    setSearching(true);
    setMessage(undefined);
    try {
      if (managementTab === "mcp") {
        setMcpResults(await window.artemis.searchMcpCatalog(catalogQuery));
      } else if (managementTab === "skills") {
        setSkillResults(await window.artemis.searchSkillCatalog(catalogQuery));
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSearching(false);
    }
  }

  async function installMcp(item: McpCatalogItem) {
    if (!item.installable || !(await onConfirm(t.confirmMcp))) return;
    const operationId = beginInstallation("mcp", item.title);
    setBusyId(item.configId);
    setMessage(undefined);
    try {
      const next = await window.artemis.installMcpCatalog(
        item.registryName,
        item.version,
        operationId,
      );
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

  async function saveConnector(event: FormEvent) {
    event.preventDefault();
    const name = connectorName.trim();
    const url = connectorUrl.trim();
    const bearerToken = connectorBearer.trim();
    if (!name || !url || (connectorAuth === "bearer" && !bearerToken)) {
      return;
    }
    const connectorId =
      name
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/gu, "-")
        .replace(/^[^a-z0-9]+|[^a-z0-9]+$/gu, "")
        .slice(0, 48) || "connector";
    const occupiedIds = new Set(mcpServers.map((server) => server.config.id));
    let serverId = `connector-${connectorId}`.slice(0, 64);
    for (let suffix = 2; occupiedIds.has(serverId); suffix += 1) {
      const suffixText = `-${suffix}`;
      serverId = `${`connector-${connectorId}`.slice(0, 64 - suffixText.length)}${suffixText}`;
    }
    const config: McpServerConfig = {
      id: serverId,
      name,
      transport: "streamable-http",
      enabled: true,
      url,
      auth: connectorAuth,
      resourceKind: "connector",
      connectorId,
    };
    setBusyId("connector:new");
    setMessage(undefined);
    try {
      const next = await window.artemis.saveMcpServer(
        config,
        connectorAuth === "bearer" ? bearerToken : undefined,
      );
      setMcpServers(next.mcpServers);
      onSettingsChange(next);
      setConnectorPanelOpen(false);
      setConnectorName("");
      setConnectorUrl("");
      setConnectorAuth("oauth");
      setConnectorBearer("");
      setMessage(t.installedNow);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(undefined);
    }
  }

  async function authorizeConnector(serverId: string) {
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
    const connectors = plugin.apps.filter((connector) => connector.url);
    const details = [
      t.confirmPlugin,
      "",
      `${t.skillsCount}: ${plugin.skills.length}`,
      ...plugin.skills
        .slice(0, 5)
        .map((skill) => `• ${pluginPageText(skill.name)}`),
      `${t.mcpCount}: ${importableMcp.length}`,
      ...importableMcp
        .slice(0, 5)
        .map(
          (server) => `• ${pluginPageText(server.name)}: ${server.endpoint}`,
        ),
      `${t.appsCount}: ${connectors.length}`,
      ...connectors
        .slice(0, 5)
        .map(
          (connector) =>
            `• ${pluginPageText(connector.name)}: ${connector.url}`,
        ),
      `${t.unsupported}: ${plugin.unsupported.join(", ") || "—"}`,
    ]
      .join("\n")
      .slice(0, 1_000);
    if (!plugin.installable || !(await onConfirm(details))) return;
    const operationId = beginInstallation(
      "plugin",
      pluginPageText(plugin.displayName),
    );
    setBusyId(plugin.id);
    setMessage(undefined);
    try {
      applyPluginMutation(
        await window.artemis.installCodexPlugin(plugin.source, operationId),
      );
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
      applyPluginMutation(
        await window.artemis.updateCodexPlugin(plugin.id, operationId),
      );
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

  function closeMcpEditor(server = editingMcpServer) {
    setMode("manage");
    setManagementTab(
      server?.config.resourceKind === "connector" ? "connectors" : "mcp",
    );
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
    setConnectorPanelOpen(false);
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

  function fallbackIcon(name: string): ResourceIconKey | undefined {
    const normalized = name.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "-");
    if (normalized.includes("codegraph")) return "codegraph";
    if (normalized.includes("node-repl") || normalized.includes("noderepl")) {
      return "node-repl";
    }
    if (normalized.includes("superpowers")) return "superpowers";
    return undefined;
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
    const normalizedDisplayName = source.displayName.toLocaleLowerCase();
    const duplicate = (marketplaceState?.sources ?? []).filter(
      (candidate) =>
        candidate.displayName.toLocaleLowerCase() === normalizedDisplayName,
    ).length;
    const base =
      duplicate > 1
        ? `${source.displayName} · ${source.repository}`
        : source.displayName;
    const stale =
      marketplaceBySourceId.has(source.id) &&
      (marketplaceState?.errors ?? []).some(
        (error) => error.sourceId === source.id,
      );
    return stale ? `${base} · ${t.marketplaceStale}` : base;
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
      iconKey: visual?.iconDataUrl ? undefined : fallbackIcon(skill.name),
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
      iconKey: visual?.iconDataUrl
        ? undefined
        : fallbackIcon(`${server.config.id} ${server.config.name}`),
    };
  }

  function pluginIsEnabled(plugin: InstalledCodexPlugin): boolean {
    return (
      plugin.skillNames.some((name) => enabledSkillNames.has(name)) ||
      plugin.mcpServerIds.some((id) => enabledMcpIds.has(id))
    );
  }

  const selectedMarketplaceView = marketplaceState?.selectedView ?? "bundled";
  const marketplaceFilter = marketplaceQuery.trim().toLowerCase();
  const matchingMarketplacePlugins = (plugins: CodexPluginPreview[]) =>
    plugins
      .filter((plugin) => plugin.installable)
      .filter((plugin) => {
        return (
          !marketplaceFilter ||
          plugin.displayName.toLowerCase().includes(marketplaceFilter) ||
          plugin.name.toLowerCase().includes(marketplaceFilter) ||
          plugin.description.toLowerCase().includes(marketplaceFilter) ||
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
  const visibleConnectors = mcpServers
    .filter((server) => server.config.resourceKind === "connector")
    .filter((server) =>
      matchesManagement(
        server.config.name,
        server.config.connectorId,
        server.config.transport,
        server.state,
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
    iconKey?: ResourceIconKey | undefined;
  }> = [
    ...installedPlugins.map((plugin) => {
      const visual = visualForPlugin(plugin);
      return {
        id: `plugin:${plugin.id}`,
        name: pluginPageText(plugin.displayName),
        kind: "plugin" as const,
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
          ...visual,
        };
      }),
  ];
  const runtimePendingPlugins = (runtimeMarketplace?.plugins ?? []).filter(
    (plugin) => plugin.installable && !installedPluginIds.has(plugin.id),
  );

  function renderProgressAndMessage() {
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
          <div className="catalog-message">{pluginPageText(message)}</div>
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
        owner?.displayName ?? installed.source ?? t.skills,
      )}`;
    }
    return undefined;
  }

  function renderPluginCard(plugin: CodexPluginPreview, sourceId?: string) {
    const installed = installedPluginIds.has(plugin.id);
    const installedPlugin = installedPlugins.find(
      (candidate) => candidate.id === plugin.id,
    );
    const conflict = installed ? undefined : pluginSkillConflict(plugin);
    const displayName = pluginPageText(plugin.displayName);
    const description = pluginPageText(
      plugin.shortDescription || plugin.description || plugin.name,
    );
    const source =
      plugin.source.kind === "bundled" || plugin.source.kind === "runtime"
        ? undefined
        : sourceId
          ? marketplaceSourceById.get(sourceId)
          : marketplaceSourceForPlugin(plugin);
    const sourceLabel = source
      ? marketplaceSourceLabel(source)
      : pluginMarketplaceLabel(plugin);
    return (
      <article className="plugin-market-card" key={plugin.id}>
        <ResourceAvatar
          brandColor={plugin.brandColor}
          iconDataUrl={plugin.iconDataUrl}
          kind="plugin"
          name={displayName}
        />
        <span className="plugin-market-copy">
          <strong>{displayName}</strong>
          <small>{description}</small>
          <small className="plugin-market-source">
            {t.marketplaceSource}: {sourceLabel}
          </small>
        </span>
        {installed && installedPlugin ? (
          <button
            className="resource-inline-action danger"
            disabled={busyId === plugin.id}
            onClick={() => void removePlugin(installedPlugin)}
            type="button"
          >
            {t.remove}
          </button>
        ) : (
          <button
            className="resource-inline-action"
            disabled={
              !plugin.installable ||
              Boolean(conflict) ||
              busyId === plugin.id ||
              installProgress !== undefined
            }
            onClick={() => void installPlugin(plugin)}
            title={
              plugin.installable
                ? conflict || plugin.warnings.join("\n")
                : plugin.unsupported.join(", ")
            }
            type="button"
          >
            {conflict
              ? t.skillConflict
              : plugin.installable
                ? t.install
                : t.needsSetup}
          </button>
        )}
      </article>
    );
  }

  if (mode === "add-plugin") {
    return (
      <div className="library-page resource-page resource-standalone-page">
        <header className="resource-page-header resource-management-header">
          <button
            aria-label={t.backToPlugins}
            className="resource-back-button"
            onClick={() => {
              setMode("manage");
              setManagementTab("plugins");
              setMessage(undefined);
            }}
            title={t.backToPlugins}
            type="button"
          >
            <BackIcon />
          </button>
          <div>
            <h1>{t.addPlugin}</h1>
            <p>{t.addPluginDescription}</p>
          </div>
        </header>

        {renderProgressAndMessage()}

        <section className="resource-add-plugin-options">
          <article className="resource-add-plugin-card">
            <div>
              <strong>{t.gitMarketplace}</strong>
              <small>{t.gitMarketplaceHint}</small>
            </div>
            <form onSubmit={(event) => void addCustomMarketplace(event)}>
              <input
                aria-label={t.gitMarketplaceHint}
                autoFocus
                onChange={(event) => setSourceInput(event.target.value)}
                placeholder={t.gitMarketplaceHint}
                value={sourceInput}
              />
              <button disabled={!sourceInput.trim() || searching} type="submit">
                {t.loadMarketplace}
              </button>
            </form>
          </article>

          {(marketplaceState?.sources ?? []).some(
            (source) => !source.builtIn,
          ) && (
            <article className="resource-add-plugin-card resource-marketplace-manager">
              <div>
                <strong>{t.manageMarketplaces}</strong>
                <small>{t.gitMarketplaceHint}</small>
              </div>
              <div className="resource-marketplace-source-list">
                {(marketplaceState?.sources ?? [])
                  .filter((source) => !source.builtIn)
                  .map((source, index, sources) => (
                    <div
                      className="resource-marketplace-source-row"
                      key={source.id}
                    >
                      <span>
                        <strong>{marketplaceSourceLabel(source)}</strong>
                        <small>{source.repository}</small>
                      </span>
                      <div>
                        <button
                          aria-label={`${t.moveMarketplaceUp}: ${source.displayName}`}
                          disabled={
                            index === 0 || busyId === `marketplace:${source.id}`
                          }
                          onClick={() => void moveMarketplace(source.id, -1)}
                          title={t.moveMarketplaceUp}
                          type="button"
                        >
                          ↑
                        </button>
                        <button
                          aria-label={`${t.moveMarketplaceDown}: ${source.displayName}`}
                          disabled={
                            index === sources.length - 1 ||
                            busyId === `marketplace:${source.id}`
                          }
                          onClick={() => void moveMarketplace(source.id, 1)}
                          title={t.moveMarketplaceDown}
                          type="button"
                        >
                          ↓
                        </button>
                        <button
                          aria-label={`${t.removeMarketplace}: ${source.displayName}`}
                          className="resource-icon-button danger resource-marketplace-remove-button"
                          data-tooltip={t.removeMarketplace}
                          disabled={busyId === `marketplace:${source.id}`}
                          onClick={() => void removeMarketplace(source)}
                          type="button"
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </article>
          )}

          <article className="resource-add-plugin-card">
            <div>
              <strong>{t.localPlugin}</strong>
              <small>{t.inspectLocalPlugin}</small>
            </div>
            <button
              disabled={busyId === "local-plugin"}
              onClick={() => void inspectLocalPlugin()}
              type="button"
            >
              <CatalogIcon kind="plugin" />
              {t.inspectLocalPlugin}
            </button>
          </article>

          <article className="resource-add-plugin-card">
            <div>
              <strong>{t.executableExtension}</strong>
              <small>{t.executableExtensionHint}</small>
            </div>
            <button
              disabled={busyId === "extension:new"}
              onClick={() => void trustExtension()}
              type="button"
            >
              <CatalogIcon kind="plugin" />
              {t.trustExtension}
            </button>
          </article>
        </section>
      </div>
    );
  }

  if (mode === "mcp-editor") {
    return (
      <div className="library-page resource-page resource-standalone-page">
        <McpServerEditor
          existingServers={mcpServers}
          key={editingMcpServer?.config.id ?? "new"}
          locale={locale}
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
      </div>
    );
  }

  if (mode === "marketplace") {
    return (
      <div className="library-page resource-page resource-marketplace-page">
        <header className="resource-page-header">
          <div>
            <h1>{t.title}</h1>
            <p>{t.marketDescription}</p>
          </div>
          <div className="resource-header-actions">
            <button
              aria-label={t.refresh}
              className="resource-icon-button"
              disabled={
                selectedMarketplaceView === "local" ||
                marketplaceSourceById.get(selectedMarketplaceView)?.builtIn ||
                searching ||
                installProgress !== undefined
              }
              onClick={() => void refreshSelectedMarketplace()}
              title={t.refresh}
              type="button"
            >
              <RefreshIcon />
            </button>
            <button
              aria-label={t.add}
              className="resource-add-button"
              onClick={() => setMode("add-plugin")}
              type="button"
            >
              <PlusIcon />
              {t.add}
            </button>
          </div>
        </header>

        <label className="resource-search-field resource-market-search">
          <SearchIcon />
          <input
            aria-label={t.searchPlugins}
            onChange={(event) => setMarketplaceQuery(event.target.value)}
            placeholder={t.searchPlugins}
            value={marketplaceQuery}
          />
        </label>

        <section className="resource-installed-overview">
          <div className="resource-section-heading">
            <strong>{t.installed}</strong>
            <button
              aria-label={t.manage}
              className="resource-icon-button"
              onClick={() => openManagement()}
              title={t.manage}
              type="button"
            >
              <GearIcon />
            </button>
          </div>
          <div className="resource-installed-icons">
            {installedTiles.slice(0, 24).map((item) => (
              <button
                aria-label={item.name}
                className="resource-installed-icon-button"
                data-tooltip={item.name}
                key={item.id}
                onClick={() =>
                  openManagement(
                    item.kind === "plugin"
                      ? "plugins"
                      : item.kind === "skill"
                        ? "skills"
                        : "mcp",
                  )
                }
                title={item.name}
                type="button"
              >
                <ResourceAvatar
                  brandColor={item.brandColor}
                  iconKey={item.iconKey}
                  iconDataUrl={item.iconDataUrl}
                  kind={item.kind}
                  name={item.name}
                />
              </button>
            ))}
            {installedTiles.length === 0 && (
              <span className="resource-empty-inline">{t.noPlugins}</span>
            )}
            {installedTiles.length > 24 && (
              <span className="resource-installed-more">
                +{installedTiles.length - 24}
              </span>
            )}
          </div>
        </section>

        {renderProgressAndMessage()}

        <div className="resource-market-controls">
          <div className="resource-scope-tabs" role="tablist">
            {(marketplaceState?.sources ?? []).map((source) => (
              <button
                aria-selected={selectedMarketplaceView === source.id}
                className={
                  selectedMarketplaceView === source.id ? "active" : ""
                }
                key={source.id}
                onClick={() => void selectMarketplace(source.id)}
                role="tab"
                title={source.repository}
                type="button"
              >
                {marketplaceSourceLabel(source)}
              </button>
            ))}
            <button
              aria-selected={selectedMarketplaceView === "local"}
              className={selectedMarketplaceView === "local" ? "active" : ""}
              onClick={() => void selectMarketplace("local")}
              role="tab"
              type="button"
            >
              {t.local}
            </button>
          </div>
          <small>
            {marketplaceFilter
              ? t.allResults
              : (marketplaceSourceById.get(selectedMarketplaceView)
                  ?.repository ?? t.local)}
          </small>
        </div>

        <p className="catalog-warning">{t.thirdParty}</p>

        {selectedMarketplaceView === "bundled" &&
          !marketplaceFilter &&
          runtimePendingPlugins.length > 0 && (
            <section className="resource-runtime-banner">
              <div>
                <strong>{t.installRequiredDocuments}</strong>
                <small>{t.requiredDocumentsDescription}</small>
              </div>
              <button
                disabled={
                  busyId === "required-documents" ||
                  installProgress !== undefined
                }
                onClick={() => void installRuntimePlugins()}
                type="button"
              >
                {t.installRequiredDocuments}
              </button>
            </section>
          )}

        <div className="plugin-market-groups">
          {marketplaceGroups.map((group) => (
            <section
              className="plugin-market-group"
              key={`${group.sourceId ?? "group"}:${group.title}`}
            >
              <h2>
                {marketplaceFilter ? group.title : pluginPageText(group.title)}
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
      </div>
    );
  }

  const managementCounts: Record<ManagementTab, number> = {
    plugins:
      installedPlugins.length + (settings?.trustedExtensions.length ?? 0),
    connectors: mcpServers.filter(
      (server) => server.config.resourceKind === "connector",
    ).length,
    mcp: mcpServers.filter(
      (server) => server.config.resourceKind !== "connector",
    ).length,
    skills: standaloneSkills.length,
  };
  const managementSearchLabel =
    managementTab === "plugins"
      ? t.searchPlugins
      : managementTab === "connectors"
        ? `${t.searchInstalled} · ${t.connectors}`
        : managementTab === "mcp"
          ? `${t.searchInstalled} · ${t.mcp}`
          : `${t.searchInstalled} · ${t.skills}`;

  return (
    <div className="library-page resource-page resource-management-page">
      <header className="resource-page-header resource-management-header">
        <button
          aria-label={t.backToMarketplace}
          className="resource-back-button"
          onClick={() => {
            setMode("marketplace");
            setMessage(undefined);
          }}
          title={t.backToMarketplace}
          type="button"
        >
          <BackIcon />
        </button>
        <div>
          <h1>{t.title}</h1>
          <p>{t.manageDescription}</p>
        </div>
      </header>

      <div className="resource-management-toolbar">
        <div className="resource-management-tabs" role="tablist">
          {(["plugins", "connectors", "mcp", "skills"] as const).map((tab) => (
            <button
              aria-selected={managementTab === tab}
              className={managementTab === tab ? "active" : ""}
              key={tab}
              onClick={() => switchManagementTab(tab)}
              role="tab"
              type="button"
            >
              {t[tab]} <span>{managementCounts[tab]}</span>
            </button>
          ))}
        </div>
        <label className="resource-search-field resource-management-search">
          <SearchIcon />
          <input
            aria-label={managementSearchLabel}
            onChange={(event) => setManagementQuery(event.target.value)}
            placeholder={managementSearchLabel}
            value={managementQuery}
          />
        </label>
      </div>

      {renderProgressAndMessage()}

      {managementTab === "plugins" && (
        <section className="resource-management-section">
          <div className="resource-list-heading">
            <strong>{t.plugins}</strong>
            <button
              className="resource-add-button subtle"
              onClick={() => setMode("add-plugin")}
              type="button"
            >
              <PlusIcon />
              {t.addPlugin}
            </button>
          </div>
          <div className="resource-management-list">
            {visibleInstalledPlugins.map((plugin) => {
              const visual = visualForPlugin(plugin);
              return (
                <article className="resource-management-row" key={plugin.id}>
                  <ResourceAvatar
                    brandColor={visual.brandColor}
                    iconDataUrl={visual.iconDataUrl}
                    kind="plugin"
                    name={pluginPageText(plugin.displayName)}
                  />
                  <span className="resource-management-copy">
                    <strong>{pluginPageText(plugin.displayName)}</strong>
                    <small>
                      {plugin.installable
                        ? pluginPageText(
                            plugin.shortDescription ||
                              plugin.description ||
                              `${plugin.skillNames.length} ${t.skillsCount} · ${plugin.mcpServerIds.length} ${t.mcpCount}`,
                          )
                        : t.needsSetup}
                    </small>
                    <small className="plugin-market-source">
                      {t.marketplaceSource}: {pluginMarketplaceLabel(plugin)}
                    </small>
                  </span>
                  <div className="resource-row-actions">
                    <button
                      aria-label={`${t.update} ${pluginPageText(plugin.displayName)}`}
                      className="resource-icon-button"
                      disabled={busyId === plugin.id}
                      onClick={() => void updatePlugin(plugin)}
                      title={t.update}
                      type="button"
                    >
                      <RefreshIcon />
                    </button>
                    <button
                      aria-label={`${t.remove} ${pluginPageText(plugin.displayName)}`}
                      className="resource-icon-button danger"
                      disabled={busyId === plugin.id}
                      onClick={() => void removePlugin(plugin)}
                      title={t.remove}
                      type="button"
                    >
                      <TrashIcon />
                    </button>
                    <ResourceSwitch
                      checked={pluginIsEnabled(plugin)}
                      disabled={busyId === plugin.id || !plugin.installable}
                      label={pluginIsEnabled(plugin) ? t.enabled : t.disabled}
                      onChange={(enabled) =>
                        void setPluginEnabled(plugin, enabled)
                      }
                    />
                  </div>
                </article>
              );
            })}
            {visibleExtensions.map((extension) => (
              <article
                className="resource-management-row"
                key={extension.config.id}
              >
                <ResourceAvatar kind="plugin" name={extension.config.name} />
                <span className="resource-management-copy">
                  <strong>{extension.config.name}</strong>
                  <small title={extension.config.path}>
                    {extension.state === "changed"
                      ? t.extensionChanged
                      : `${extension.state} · ${extension.tools.length} ${t.tools}`}
                  </small>
                </span>
                <div className="resource-row-actions">
                  <button
                    aria-label={`${t.extensionNetwork}: ${extension.config.name}`}
                    className={`resource-inline-action${extension.config.allowNetwork ? " active" : ""}`}
                    disabled={
                      busyId === extension.config.id ||
                      !extension.config.enabled
                    }
                    onClick={() =>
                      void setExtensionNetwork(
                        extension.config.id,
                        !extension.config.allowNetwork,
                      )
                    }
                    title={t.extensionNetwork}
                    type="button"
                  >
                    {t.extensionNetwork}
                  </button>
                  {extension.state === "changed" && (
                    <button
                      aria-label={`${t.retrust}: ${extension.config.name}`}
                      className="resource-icon-button"
                      disabled={busyId === extension.config.id}
                      onClick={() => void retrustExtension(extension.config.id)}
                      title={t.retrust}
                      type="button"
                    >
                      <RefreshIcon />
                    </button>
                  )}
                  <button
                    aria-label={`${t.remove} ${extension.config.name}`}
                    className="resource-icon-button danger"
                    disabled={busyId === extension.config.id}
                    onClick={() => void removeExtension(extension.config.id)}
                    title={t.remove}
                    type="button"
                  >
                    <TrashIcon />
                  </button>
                  <ResourceSwitch
                    checked={extension.config.enabled}
                    disabled={busyId === extension.config.id}
                    label={extension.config.enabled ? t.enabled : t.disabled}
                    onChange={(enabled) =>
                      void setExtensionEnabled(extension.config.id, enabled)
                    }
                  />
                </div>
              </article>
            ))}
            {visibleInstalledPlugins.length === 0 &&
              visibleExtensions.length === 0 && (
                <EmptyResource>{t.noPlugins}</EmptyResource>
              )}
          </div>
        </section>
      )}

      {managementTab === "connectors" && (
        <section className="resource-management-section">
          <div className="resource-list-heading">
            <strong>{t.connectors}</strong>
            <button
              className="resource-add-button subtle"
              onClick={() => setConnectorPanelOpen((current) => !current)}
              type="button"
            >
              <PlusIcon />
              {t.addConnector}
            </button>
          </div>
          {connectorPanelOpen && (
            <form
              className="resource-connector-form"
              onSubmit={(event) => void saveConnector(event)}
            >
              <p>{t.connectorHelp}</p>
              <input
                aria-label={t.connectorName}
                autoFocus
                onChange={(event) => setConnectorName(event.target.value)}
                placeholder={t.connectorName}
                value={connectorName}
              />
              <input
                aria-label={t.connectorUrl}
                onChange={(event) => setConnectorUrl(event.target.value)}
                placeholder={t.connectorUrl}
                type="url"
                value={connectorUrl}
              />
              <select
                aria-label={t.connectorAuth}
                onChange={(event) =>
                  setConnectorAuth(
                    event.target.value as "none" | "bearer" | "oauth",
                  )
                }
                value={connectorAuth}
              >
                <option value="oauth">OAuth</option>
                <option value="bearer">Bearer</option>
                <option value="none">None</option>
              </select>
              {connectorAuth === "bearer" && (
                <input
                  aria-label={t.connectorBearer}
                  autoComplete="off"
                  onChange={(event) => setConnectorBearer(event.target.value)}
                  placeholder={t.connectorBearer}
                  type="password"
                  value={connectorBearer}
                />
              )}
              <button
                disabled={
                  busyId === "connector:new" ||
                  !connectorName.trim() ||
                  !connectorUrl.trim() ||
                  (connectorAuth === "bearer" && !connectorBearer.trim())
                }
                type="submit"
              >
                {t.saveConnector}
              </button>
            </form>
          )}
          <div className="resource-management-list">
            {visibleConnectors.map((server) => {
              const owner = owningPluginForMcp(server);
              const displayName = owner
                ? pluginPageText(server.config.name)
                : server.config.name;
              const visual = visualForMcp(server);
              const canAuthorize =
                server.config.transport === "streamable-http" &&
                server.config.auth === "oauth" &&
                server.config.enabled &&
                server.state !== "connected";
              return (
                <article
                  className="resource-management-row"
                  key={server.config.id}
                >
                  <ResourceAvatar
                    brandColor={visual.brandColor}
                    iconDataUrl={visual.iconDataUrl}
                    iconKey={visual.iconKey}
                    kind="connectors"
                    name={displayName}
                  />
                  <span className="resource-management-copy">
                    <strong>{displayName}</strong>
                    <small
                      title={
                        server.config.transport === "streamable-http"
                          ? server.config.url
                          : server.config.command
                      }
                    >
                      {owner
                        ? `${t.fromPlugins}: ${pluginPageText(owner.displayName)} · `
                        : ""}
                      {!server.config.enabled ? t.disabled : server.state} ·{" "}
                      {server.tools.length} {t.tools}
                    </small>
                  </span>
                  <div className="resource-row-actions">
                    <button
                      aria-label={`${t.configure} ${displayName}`}
                      className="resource-icon-button"
                      onClick={() => openMcpEditor(server)}
                      title={t.configure}
                      type="button"
                    >
                      <GearIcon />
                    </button>
                    {canAuthorize && (
                      <button
                        className="resource-inline-action"
                        disabled={busyId === server.config.id}
                        onClick={() =>
                          void authorizeConnector(server.config.id)
                        }
                        type="button"
                      >
                        {t.authorize}
                      </button>
                    )}
                    <button
                      aria-label={`${t.remove} ${displayName}`}
                      className="resource-icon-button danger"
                      disabled={
                        busyId === server.config.id ||
                        managedMcpIds.has(server.config.id)
                      }
                      onClick={() =>
                        void removeMcp(
                          server.config.id,
                          t.confirmRemoveConnector,
                        )
                      }
                      title={
                        managedMcpIds.has(server.config.id)
                          ? t.managedByPlugin
                          : t.remove
                      }
                      type="button"
                    >
                      <TrashIcon />
                    </button>
                    <ResourceSwitch
                      checked={server.config.enabled}
                      disabled={busyId === server.config.id}
                      label={server.config.enabled ? t.enabled : t.disabled}
                      onChange={(enabled) =>
                        void setMcpEnabled(server.config.id, enabled)
                      }
                    />
                  </div>
                </article>
              );
            })}
            {visibleConnectors.length === 0 && (
              <EmptyResource>{t.noConnectors}</EmptyResource>
            )}
          </div>
        </section>
      )}

      {managementTab === "mcp" && (
        <section className="resource-management-section">
          <div className="resource-list-heading">
            <strong>{t.mcp}</strong>
            <div className="resource-list-heading-actions">
              <button
                className="resource-add-button subtle"
                onClick={() => {
                  setDiscoveryOpen((current) => !current);
                  setCatalogQuery("");
                }}
                type="button"
              >
                <PlusIcon />
                {t.browseOfficialMcp}
              </button>
              <button
                className="resource-add-button subtle"
                onClick={() => openMcpEditor()}
                type="button"
              >
                <PlusIcon />
                {t.addMcp}
              </button>
            </div>
          </div>
          <div className="resource-management-list grouped">
            {visibleMcp.map((server) => {
              const owner = owningPluginForMcp(server);
              const displayName = owner
                ? pluginPageText(server.config.name)
                : server.config.name;
              const visual = visualForMcp(server);
              return (
                <article
                  className="resource-management-row"
                  key={server.config.id}
                >
                  <ResourceAvatar
                    brandColor={visual.brandColor}
                    iconDataUrl={visual.iconDataUrl}
                    iconKey={visual.iconKey}
                    kind="mcp"
                    name={displayName}
                  />
                  <span className="resource-management-copy">
                    <strong>{displayName}</strong>
                    <small>
                      {owner
                        ? `${t.fromPlugins}: ${pluginPageText(owner.displayName)} · `
                        : ""}
                      {!server.config.enabled
                        ? t.disabled
                        : server.state === "connected"
                          ? t.connected
                          : server.state}{" "}
                      · {server.tools.length} {t.tools}
                    </small>
                  </span>
                  <div className="resource-row-actions">
                    <button
                      aria-label={`${t.addMcp}: ${displayName}`}
                      className="resource-icon-button"
                      onClick={() => openMcpEditor(server)}
                      title={t.addMcp}
                      type="button"
                    >
                      <GearIcon />
                    </button>
                    <button
                      aria-label={`${t.remove} ${displayName}`}
                      className="resource-icon-button danger"
                      disabled={
                        busyId === server.config.id ||
                        managedMcpIds.has(server.config.id)
                      }
                      onClick={() => void removeMcp(server.config.id)}
                      title={
                        managedMcpIds.has(server.config.id)
                          ? t.managedByPlugin
                          : t.remove
                      }
                      type="button"
                    >
                      <TrashIcon />
                    </button>
                    <ResourceSwitch
                      checked={server.state === "connected"}
                      disabled={busyId === server.config.id}
                      label={
                        server.state === "connected" ? t.enabled : t.disabled
                      }
                      onChange={(enabled) =>
                        void setMcpEnabled(server.config.id, enabled)
                      }
                    />
                  </div>
                </article>
              );
            })}
            {visibleMcp.length === 0 && (
              <EmptyResource>{t.noMcp}</EmptyResource>
            )}
          </div>
          {discoveryOpen && (
            <section className="resource-discovery-panel">
              <form onSubmit={(event) => void searchCatalog(event)}>
                <SearchIcon />
                <input
                  aria-label={t.searchMcp}
                  onChange={(event) => setCatalogQuery(event.target.value)}
                  placeholder={t.searchMcp}
                  ref={catalogSearchRef}
                  value={catalogQuery}
                />
                <button
                  disabled={!catalogQuery.trim() || searching}
                  type="submit"
                >
                  {searching ? "…" : t.searchMcp}
                </button>
              </form>
              <div className="resource-discovery-results">
                {mcpResults.map((item) => (
                  <article
                    className="resource-discovery-row"
                    key={item.registryName}
                  >
                    <ResourceAvatar kind="mcp" name={item.title} />
                    <span>
                      <strong>{item.title}</strong>
                      <small>{item.description}</small>
                    </span>
                    <button
                      disabled={
                        item.installed ||
                        !item.installable ||
                        busyId === item.configId ||
                        installProgress !== undefined
                      }
                      onClick={() => void installMcp(item)}
                      type="button"
                    >
                      {item.installed
                        ? t.installedLabel
                        : item.installable
                          ? t.install
                          : t.needsSetup}
                    </button>
                  </article>
                ))}
                {mcpResults.length === 0 && (
                  <EmptyResource>{t.noCatalogResults}</EmptyResource>
                )}
              </div>
            </section>
          )}
        </section>
      )}

      {managementTab === "skills" && (
        <section className="resource-management-section">
          <div className="resource-list-heading">
            <strong>{t.skills}</strong>
            <div className="resource-list-heading-actions">
              <button
                className="resource-add-button subtle"
                onClick={() => {
                  setDiscoveryOpen((current) => !current);
                  setCatalogQuery("");
                }}
                type="button"
              >
                <PlusIcon />
                {t.browseSkills}
              </button>
              <button
                className="resource-add-button subtle"
                disabled={busyId === "local-skill"}
                onClick={() => void installLocalSkill()}
                type="button"
              >
                <PlusIcon />
                {t.addSkill}
              </button>
            </div>
          </div>
          <div className="resource-management-list">
            {visibleSkills.map((skill) => {
              const visual = visualForSkill(skill);
              return (
                <article className="resource-management-row" key={skill.id}>
                  <ResourceAvatar
                    brandColor={visual.brandColor}
                    iconDataUrl={visual.iconDataUrl}
                    iconKey={visual.iconKey}
                    kind="skill"
                    name={skill.name}
                  />
                  <span className="resource-management-copy">
                    <strong>{skill.name}</strong>
                    <small>
                      {skill.description || skill.source || skill.path}
                    </small>
                  </span>
                  <div className="resource-row-actions">
                    <button
                      aria-label={`${t.remove} ${skill.name}`}
                      className="resource-icon-button danger"
                      disabled={busyId === skill.id}
                      onClick={() => void removeSkill(skill)}
                      title={t.remove}
                      type="button"
                    >
                      <TrashIcon />
                    </button>
                    <ResourceSwitch
                      checked={skill.enabled}
                      disabled={busyId === skill.id}
                      label={skill.enabled ? t.enabled : t.disabled}
                      onChange={(enabled) =>
                        void setSkillEnabled(skill.id, enabled)
                      }
                    />
                  </div>
                </article>
              );
            })}
            {visibleSkills.length === 0 && (
              <EmptyResource>{t.noSkills}</EmptyResource>
            )}
          </div>
          {discoveryOpen && (
            <section className="resource-discovery-panel">
              <form onSubmit={(event) => void searchCatalog(event)}>
                <SearchIcon />
                <input
                  aria-label={t.searchSkills}
                  onChange={(event) => setCatalogQuery(event.target.value)}
                  placeholder={t.searchSkills}
                  ref={catalogSearchRef}
                  value={catalogQuery}
                />
                <button
                  disabled={!catalogQuery.trim() || searching}
                  type="submit"
                >
                  {searching ? "…" : t.searchSkills}
                </button>
              </form>
              <div className="resource-discovery-results">
                {skillResults.map((item) => (
                  <article className="resource-discovery-row" key={item.id}>
                    <ResourceAvatar kind="skill" name={item.name} />
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.source}</small>
                    </span>
                    <button
                      disabled={
                        item.installed ||
                        busyId === item.id ||
                        installProgress !== undefined
                      }
                      onClick={() => void installSkill(item)}
                      type="button"
                    >
                      {item.installed ? t.installedLabel : t.install}
                    </button>
                  </article>
                ))}
                {skillResults.length === 0 && (
                  <EmptyResource>{t.noCatalogResults}</EmptyResource>
                )}
              </div>
            </section>
          )}
        </section>
      )}
    </div>
  );
}

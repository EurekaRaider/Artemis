import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
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

import type {
  CodexPluginMarketplace,
  CodexPluginMarketplaceSource,
  CodexPluginMarketplaceState,
  CodexPluginMutationResult,
  CodexPluginPreview,
  GoogleAccountStatus,
  GoogleGrantId,
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
import { legacyLocale } from "../shared/locales.js";
import { localizedCopy } from "../shared/i18n-resources.js";
import { McpServerEditor } from "./McpServerEditor.js";
import { DownloadSimpleIcon, XIcon } from "@phosphor-icons/react";
import {
  resourceIconName,
  resourceIconPalette,
  SemanticResourceIcon,
  type ResourceIconKind,
  type ResourceIconName,
} from "./resource-icons.js";

interface ResourceCenterProps {
  locale: AppLocale;
  settings?: SettingsSnapshot;
  onConfirm(message: string, tone?: "default" | "danger"): Promise<boolean>;
  onSettingsChange(settings: SettingsSnapshot): void;
}

interface McpInstallDraft {
  item: McpCatalogItem;
  option: McpCatalogInstallOption;
  values: Record<string, string>;
}

type ManagementTab = "plugins" | "connectors" | "mcp" | "skills";
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

function googleAuthorizationErrorText(
  error: unknown,
  locale: AppLocale,
): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("Google did not grant all scopes required by this plugin.")
  ) {
    return locale.startsWith("zh")
      ? "Google 未授予此插件所需的全部权限。请在授权页面允许所有请求的权限后重试。"
      : "Google did not grant all permissions required by this plugin. Allow every requested permission and try again.";
  }
  return message;
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
      "Install a Git or offline marketplace, a local plugin bundle, or a trusted executable extension.",
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
    searchingMcp: "Searching the official MCP Registry…",
    searchingSkills: "Searching Agent Skills…",
    gitMarketplace: "Git marketplace",
    gitMarketplaceHint: "Public GitHub owner/repository or HTTPS URL",
    offlineMarketplace: "Offline marketplace package",
    offlineMarketplaceHint:
      "Import a signed .tar.gz/.tgz package downloaded from GitHub, or its extracted directory. Artemis copies it into its cache and does not access the network.",
    importOfflineMarketplace: "Import offline marketplace",
    offline: "Offline",
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
    configureInstall: "Configure and install",
    installMcpTitle: "Install {name}",
    installMcpMethod: "Installation method",
    installMcpCredentialHint:
      "Sensitive values are encrypted by the operating system and are not saved in the MCP configuration.",
    installMcpLocalWarning:
      "This local stdio MCP runs with your desktop user’s full filesystem and network access.",
    optional: "optional",
    cancel: "Cancel",
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
    noMcpCatalogResults: "No matching MCP servers found.",
    noSkillCatalogResults: "No matching Agent Skills found.",
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
    pluginWarnings:
      "Completed with {count} warning(s). Review the source before enabling.",
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
    addPluginDescription:
      "安装 Git 或脱机插件市场、本地插件包，或受信任的可执行扩展。",
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
    searchingMcp: "正在搜索官方 MCP Registry…",
    searchingSkills: "正在搜索 Agent Skills…",
    gitMarketplace: "Git marketplace",
    gitMarketplaceHint: "公开 GitHub owner/repository 或 HTTPS 地址",
    offlineMarketplace: "脱机插件商店包",
    offlineMarketplaceHint:
      "导入从 GitHub 下载的签名 .tar.gz/.tgz 离线包或已解压目录。Artemis 会复制到自身缓存，全程不访问网络。",
    importOfflineMarketplace: "导入脱机商店",
    offline: "脱机",
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
    configureInstall: "配置并安装",
    installMcpTitle: "安装 {name}",
    installMcpMethod: "安装方式",
    installMcpCredentialHint:
      "敏感值由操作系统加密保存，不会写入 MCP 普通配置。",
    installMcpLocalWarning:
      "这个本地 stdio MCP 将以当前桌面用户权限运行，可访问完整文件系统与网络。",
    optional: "可选",
    cancel: "取消",
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
    noMcpCatalogResults: "没有找到匹配的 MCP 服务器。",
    noSkillCatalogResults: "没有找到匹配的 Agent Skill。",
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
    pluginWarnings: "操作完成，但有 {count} 条警告；启用前请检查来源。",
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
  return <SemanticResourceIcon icon={resourceIconName("", kind)} />;
}

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.55"
      viewBox="0 0 24 24"
    >
      <circle cx="10.7" cy="10.7" r="6.2" />
      <path d="m15.4 15.4 4.3 4.3" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.55"
      viewBox="0 0 24 24"
    >
      <path d="M9.7 3.4h4.6l.5 2a7.2 7.2 0 0 1 1.3.8l2-.6 2.3 4-.1.1-1.5 1.4a7.1 7.1 0 0 1 0 1.8l1.6 1.5-2.3 4-2-.6a7.2 7.2 0 0 1-1.3.8l-.5 2H9.7l-.5-2a7.2 7.2 0 0 1-1.3-.8l-2 .6-2.3-4 1.6-1.5a7.1 7.1 0 0 1 0-1.8L3.6 9.6l2.3-4 2 .6a7.2 7.2 0 0 1 1.3-.8l.5-2Z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.55"
      viewBox="0 0 24 24"
    >
      <path d="M19.2 8.2A8 8 0 0 0 5.3 6.1L3.5 8" />
      <path d="M3.5 4.5V8H7" />
      <path d="M4.8 15.8a8 8 0 0 0 13.9 2.1l1.8-1.9" />
      <path d="M20.5 19.5V16H17" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.55"
      viewBox="0 0 24 24"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.55"
      viewBox="0 0 24 24"
    >
      <path d="M4.5 7h15M9 7V4.5h6V7M7 7l.8 13h8.4L17 7M10 10.5v6M14 10.5v6" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.55"
      viewBox="0 0 24 24"
    >
      <path d="m14.5 5-7 7 7 7" />
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
  iconKey?: ResourceIconName | undefined;
  iconDataUrl?: string | undefined;
  kind: ResourceKind;
  name: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [iconDataUrl]);
  const semanticIcon = iconKey ?? resourceIconName(name, kind);
  const semanticVisible = !iconDataUrl || imageFailed;
  const palette = resourceIconPalette(semanticIcon);
  const style = {
    ...(brandColor ? { "--resource-brand": brandColor } : {}),
    ...(semanticVisible
      ? {
          "--resource-icon-bg": palette.background,
          "--resource-icon-surface": palette.surface,
          "--resource-icon-fg": palette.foreground,
          "--resource-icon-accent": palette.accent,
          "--resource-icon-border": palette.border,
        }
      : {}),
  } as CSSProperties;
  return (
    <span
      className="resource-avatar"
      data-icon={semanticVisible ? semanticIcon : undefined}
      data-kind={kind}
      style={style}
    >
      {iconDataUrl && !imageFailed ? (
        <img
          alt=""
          draggable={false}
          onError={() => setImageFailed(true)}
          src={iconDataUrl}
        />
      ) : (
        <SemanticResourceIcon icon={semanticIcon} />
      )}
    </span>
  );
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
    "marketplace" | "manage" | "add-plugin" | "mcp-editor" | "google-account"
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
  const [googleAccount, setGoogleAccount] = useState<GoogleAccountStatus>();
  const catalogSearchRef = useRef<HTMLInputElement>(null);
  const operationPendingRef = useRef(false);
  const t = localizedCopy(locale, "resources", labels[legacyLocale(locale)]);

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
      const chinese = locale.startsWith("zh");
      const trustMessage = trust.signed
        ? chinese
          ? `确认添加外部商店 ${trust.repository}\n\nEd25519 密钥指纹：\n${trust.signingKeyFingerprint}\n\n后续刷新将固定使用此密钥。`
          : `Add external marketplace ${trust.repository}?\n\nEd25519 key fingerprint:\n${trust.signingKeyFingerprint}\n\nFuture refreshes will require this same key.`
        : chinese
          ? `确认添加未签名商店 ${trust.repository}？未签名插件不能使用 Artemis 宿主凭据。`
          : `Add unsigned marketplace ${trust.repository}? Unsigned plugins cannot use Artemis host credentials.`;
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
      const chinese = locale.startsWith("zh");
      const trustMessage = chinese
        ? `确认导入脱机商店 ${trust.repository}？\n\nEd25519 密钥指纹：\n${trust.signingKeyFingerprint}\n\n商店将复制到 Artemis 缓存；浏览和安装不会访问网络。再次导入同一商店会原子替换其缓存。`
        : `Import offline marketplace ${trust.repository}?\n\nEd25519 key fingerprint:\n${trust.signingKeyFingerprint}\n\nThe marketplace will be copied into the Artemis cache. Browsing and installation will not access the network. Re-importing the same marketplace atomically replaces its cache.`;
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

  async function openGoogleAccount(): Promise<void> {
    setMode("google-account");
    setMessage(undefined);
    try {
      const status = await window.artemis.getGoogleAccountStatus();
      setGoogleAccount(status);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function authorizeGoogleGrant(grant: GoogleGrantId): Promise<void> {
    if (googleAccount?.clientConfigured === false) {
      setMessage(
        locale.startsWith("zh")
          ? "此版本的 Artemis 未包含应用级 Google OAuth 客户端，请联系 Artemis 发布者。"
          : "This Artemis build does not include its application-level Google OAuth client. Contact the Artemis publisher.",
      );
      return;
    }
    setBusyId(`google:${grant}`);
    setMessage(undefined);
    try {
      setGoogleAccount(await window.artemis.authorizeGoogleGrant(grant));
      const next = await window.artemis.getSettings();
      setMcpServers(next.mcpServers);
      onSettingsChange(next);
    } catch (error) {
      setMessage(googleAuthorizationErrorText(error, locale));
    } finally {
      setBusyId(undefined);
    }
  }

  async function disconnectGoogleGrant(grant: GoogleGrantId): Promise<void> {
    if (!(await onConfirm(`Disconnect the ${grant} Google grant?`, "danger")))
      return;
    setBusyId(`google:${grant}`);
    try {
      setGoogleAccount(await window.artemis.disconnectGoogleGrant(grant));
      const next = await window.artemis.getSettings();
      setMcpServers(next.mcpServers);
      onSettingsChange(next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(undefined);
    }
  }

  async function disconnectGoogleAccount(): Promise<void> {
    if (
      !(await onConfirm(
        "Disconnect the Google account and revoke all grants?",
        "danger",
      ))
    )
      return;
    setBusyId("google-disconnect");
    try {
      setGoogleAccount(await window.artemis.disconnectGoogleAccount());
      const next = await window.artemis.getSettings();
      setMcpServers(next.mcpServers);
      onSettingsChange(next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(undefined);
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

  async function saveConnector() {
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
        `${server.config.id} ${server.config.name}`,
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
  const selectedMarketplaceSource = marketplaceSourceById.get(
    selectedMarketplaceView,
  );
  const isArtemisPluginShop =
    selectedMarketplaceSource?.marketplaceName === "artemis-plugin-shop";
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
    iconKey?: ResourceIconName | undefined;
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
          <InlineNotice tone="info">{pluginPageText(message)}</InlineNotice>
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
    const diagnostic = conflict
      ? conflict
      : plugin.installable
        ? plugin.warnings.join(" · ")
        : plugin.unsupported.join(", ");
    return (
      <ManagementCard className="plugin-market-card" key={plugin.id}>
        <ResourceAvatar
          brandColor={plugin.brandColor}
          iconDataUrl={plugin.iconDataUrl}
          kind="plugin"
          name={displayName}
        />
        <div className="plugin-market-copy">
          <strong>{displayName}</strong>
          <small>{description}</small>
          <small className="plugin-market-source">
            {t.marketplaceSource}: {sourceLabel}
          </small>
          {diagnostic && (
            <InlineNotice className="plugin-market-diagnostic" tone="warning">
              {pluginPageText(diagnostic)}
            </InlineNotice>
          )}
        </div>
        {installed && installedPlugin ? (
          <Button
            disabled={operationPending || busyId === plugin.id}
            onClick={() =>
              runResourceOperation(() => removePlugin(installedPlugin))
            }
            variant="danger"
          >
            {t.remove}
          </Button>
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

  if (mode === "google-account") {
    const chinese = locale.startsWith("zh");
    return (
      <ResourceSurface
        busy={operationPending || Boolean(busyId)}
        className="resource-page resource-standalone-page"
        label={chinese ? "Google 账号连接" : "Google account"}
      >
        <ManagementHeader
          className="resource-page-header resource-management-header"
          description={
            chinese
              ? "由 Artemis 保管 OAuth 凭据；插件只在单次调用中收到短期 access token。"
              : "Artemis holds OAuth credentials; plugins receive only a short-lived access token for one call."
          }
          leading={
            <IconButton
              className="resource-back-button"
              disabled={operationPending}
              icon={<BackIcon />}
              label={t.backToMarketplace}
              onClick={() => setMode("marketplace")}
            />
          }
          title={chinese ? "Google 账号连接" : "Google account"}
        />

        {renderProgressAndMessage()}
        <section className="resource-add-plugin-options">
          {(["google-workspace", "gmail"] as const).map((grant) => (
            <ManagementCard className="resource-add-plugin-card" key={grant}>
              <div>
                <strong>
                  {grant === "gmail" ? "Gmail" : "Google Workspace"}
                </strong>
                <small>
                  {googleAccount?.encryptionAvailable === false
                    ? chinese
                      ? "当前系统无法使用安全凭据加密，Google 插件保持禁用。"
                      : "Secure credential encryption is unavailable; Google plugins remain disabled."
                    : googleAccount?.grants[grant].authorized
                      ? chinese
                        ? "已授权"
                        : "Authorized"
                      : chinese
                        ? "未授权；安装的插件会保持禁用。"
                        : "Not authorized; the installed plugin remains disabled."}
                </small>
              </div>
              {googleAccount?.grants[grant].authorized ? (
                <Button
                  disabled={operationPending || busyId === `google:${grant}`}
                  onClick={() =>
                    runResourceOperation(() => disconnectGoogleGrant(grant))
                  }
                  variant="danger"
                >
                  {chinese ? "断开" : "Disconnect"}
                </Button>
              ) : (
                <Button
                  disabled={
                    operationPending ||
                    !googleAccount ||
                    googleAccount.encryptionAvailable === false ||
                    busyId === `google:${grant}`
                  }
                  onClick={() =>
                    runResourceOperation(() => authorizeGoogleGrant(grant))
                  }
                >
                  {chinese ? "浏览器授权" : "Authorize in browser"}
                </Button>
              )}
            </ManagementCard>
          ))}

          {googleAccount?.connected && (
            <Button
              disabled={operationPending || busyId === "google-disconnect"}
              onClick={() => runResourceOperation(disconnectGoogleAccount)}
              variant="danger"
            >
              {chinese
                ? "断开 Google 账号并撤销全部授权"
                : "Disconnect Google account and revoke all grants"}
            </Button>
          )}
        </section>
      </ResourceSurface>
    );
  }

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
        <SearchField
          className="resource-search-field resource-market-search"
          disabled={operationPending}
          label={t.searchPlugins}
          onValueChange={setMarketplaceQuery}
          placeholder={t.searchPlugins}
          value={marketplaceQuery}
        />

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
          title={t.installed}
        >
          <div className="resource-installed-icons">
            {installedTiles.slice(0, 24).map((item) => (
              <IconButton
                className="resource-installed-icon-button"
                disabled={operationPending}
                icon={
                  <ResourceAvatar
                    brandColor={item.brandColor}
                    iconKey={item.iconKey}
                    iconDataUrl={item.iconDataUrl}
                    kind={item.kind}
                    name={item.name}
                  />
                }
                key={item.id}
                label={item.name}
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
              />
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
        </ManagementSection>

        {renderProgressAndMessage()}

        <div className="resource-market-controls">
          <Tabs
            className="resource-scope-tabs"
            disabled={operationPending}
            label={t.marketplaces}
            onValueChange={(sourceId) =>
              runResourceOperation(() => selectMarketplace(sourceId))
            }
            options={marketplaceTabOptions}
            size="compact"
            value={activeMarketplaceTabOption.value}
          />
          <small>
            {marketplaceFilter
              ? t.allResults
              : selectedMarketplaceSource
                ? marketplaceSourceLabel(selectedMarketplaceSource)
                : t.local}
          </small>
        </div>

        {isArtemisPluginShop && !marketplaceFilter && (
          <ManagementCard className="resource-runtime-banner resource-marketplace-account-banner">
            <div>
              <strong>
                {locale.startsWith("zh")
                  ? "Artemis Plugin Shop 专用 Google 鉴权"
                  : "Google authentication for Artemis Plugin Shop"}
              </strong>
              <small>
                {locale.startsWith("zh")
                  ? "仅用于此商店提供的 Gmail 与 Google Workspace 插件。"
                  : "Used only by the Gmail and Google Workspace plugins from this marketplace."}
              </small>
            </div>
            <Button
              disabled={operationPending}
              onClick={() => runResourceOperation(openGoogleAccount)}
            >
              {locale.startsWith("zh") ? "Google 账号" : "Google account"}
            </Button>
          </ManagementCard>
        )}

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
          .filter((option) => option.value !== activeMarketplaceTabOption.value)
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
      </ResourceSurface>
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
  const managementTabOptions = (
    ["plugins", "connectors", "mcp", "skills"] as const
  ).map((tab) => ({
    id: `resource-management-tab-${tab}`,
    label: `${t[tab]} ${managementCounts[tab]}`,
    panelId: `resource-management-panel-${tab}`,
    value: tab,
  }));
  const activeManagementTabOption = managementTabOptions.find(
    (option) => option.value === managementTab,
  )!;
  const managementSearchLabel =
    managementTab === "plugins"
      ? t.searchPlugins
      : managementTab === "connectors"
        ? `${t.searchInstalled} · ${t.connectors}`
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
          className="resource-management-tabs"
          disabled={operationPending}
          label={t.manage}
          onValueChange={switchManagementTab}
          options={managementTabOptions}
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
                        className="resource-icon-button"
                        disabled={operationPending || busyId === plugin.id}
                        icon={<TrashIcon />}
                        label={`${t.remove} ${pluginPageText(plugin.displayName)}`}
                        onClick={() =>
                          runResourceOperation(() => removePlugin(plugin))
                        }
                        title={t.remove}
                        variant="danger"
                      />
                      <Switch
                        checked={pluginIsEnabled(plugin)}
                        className="resource-switch"
                        disabled={
                          operationPending ||
                          busyId === plugin.id ||
                          !plugin.installable
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
                          ? pluginPageText(
                              plugin.shortDescription ||
                                plugin.description ||
                                `${plugin.skillNames.length} ${t.skillsCount} · ${plugin.mcpServerIds.length} ${t.mcpCount}`,
                            )
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
                    : `${extension.state} · ${extension.tools.length} ${t.tools}`
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

      {managementTab === "connectors" && (
        <ManagementSection
          actions={
            <Button
              className="resource-add-button subtle"
              disabled={operationPending}
              icon={<PlusIcon />}
              onClick={() => setConnectorPanelOpen((current) => !current)}
            >
              {t.addConnector}
            </Button>
          }
          className="resource-management-section"
          id={activeManagementTabOption.panelId}
          labelledBy={activeManagementTabOption.id}
          role="tabpanel"
          title={t.connectors}
        >
          {connectorPanelOpen && (
            <ManagementCard className="resource-connector-card">
              <form
                className="resource-connector-form"
                onSubmit={(event) => runResourceSubmit(event, saveConnector)}
              >
                <InlineNotice tone="info">{t.connectorHelp}</InlineNotice>
                <TextField
                  autoFocus
                  disabled={operationPending}
                  label={t.connectorName}
                  labelVisibility="hidden"
                  onValueChange={setConnectorName}
                  placeholder={t.connectorName}
                  value={connectorName}
                />
                <TextField
                  disabled={operationPending}
                  label={t.connectorUrl}
                  labelVisibility="hidden"
                  onValueChange={setConnectorUrl}
                  placeholder={t.connectorUrl}
                  type="url"
                  value={connectorUrl}
                />
                <Select
                  disabled={operationPending}
                  label={t.connectorAuth}
                  onValueChange={setConnectorAuth}
                  options={[
                    { label: "OAuth", value: "oauth" },
                    { label: "Bearer", value: "bearer" },
                    { label: "None", value: "none" },
                  ]}
                  value={connectorAuth}
                />
                {connectorAuth === "bearer" && (
                  <TextField
                    autoComplete="off"
                    disabled={operationPending}
                    label={t.connectorBearer}
                    labelVisibility="hidden"
                    onValueChange={setConnectorBearer}
                    placeholder={t.connectorBearer}
                    type="password"
                    value={connectorBearer}
                  />
                )}
                <Button
                  disabled={
                    operationPending ||
                    busyId === "connector:new" ||
                    !connectorName.trim() ||
                    !connectorUrl.trim() ||
                    (connectorAuth === "bearer" && !connectorBearer.trim())
                  }
                  type="submit"
                  variant="primary"
                >
                  {t.saveConnector}
                </Button>
              </form>
            </ManagementCard>
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
                <ManagementRow
                  actions={
                    <div className="resource-row-actions">
                      <IconButton
                        className="resource-icon-button"
                        disabled={operationPending}
                        icon={<GearIcon />}
                        label={`${t.configure} ${displayName}`}
                        onClick={() => openMcpEditor(server)}
                        title={t.configure}
                      />
                      {canAuthorize && (
                        <Button
                          className="resource-inline-action"
                          disabled={
                            operationPending || busyId === server.config.id
                          }
                          onClick={() =>
                            runResourceOperation(() =>
                              authorizeConnector(server.config.id),
                            )
                          }
                        >
                          {t.authorize}
                        </Button>
                      )}
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
                            removeMcp(
                              server.config.id,
                              t.confirmRemoveConnector,
                            ),
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
                        checked={server.config.enabled}
                        className="resource-switch"
                        disabled={
                          operationPending || busyId === server.config.id
                        }
                        label={server.config.enabled ? t.enabled : t.disabled}
                        labelVisibility="hidden"
                        onCheckedChange={(enabled) =>
                          runResourceOperation(() =>
                            setMcpEnabled(server.config.id, enabled),
                          )
                        }
                        title={server.config.enabled ? t.enabled : t.disabled}
                      />
                    </div>
                  }
                  className="resource-management-row"
                  description={`${owner ? `${t.fromPlugins}: ${pluginPageText(owner.displayName)} · ` : ""}${!server.config.enabled ? t.disabled : server.state} · ${server.tools.length} ${t.tools}`}
                  key={server.config.id}
                  leading={
                    <ResourceAvatar
                      brandColor={visual.brandColor}
                      iconDataUrl={visual.iconDataUrl}
                      iconKey={visual.iconKey}
                      kind="connectors"
                      name={displayName}
                    />
                  }
                  title={displayName}
                />
              );
            })}
            {visibleConnectors.length === 0 && (
              <EmptyResource>{t.noConnectors}</EmptyResource>
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
                  description={`${owner ? `${t.fromPlugins}: ${pluginPageText(owner.displayName)} · ` : ""}${!server.config.enabled ? t.disabled : server.state === "connected" ? t.connected : server.state} · ${server.tools.length} ${t.tools}`}
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
                icon={<XIcon aria-hidden="true" size={15} weight="bold" />}
                onClick={() => setMcpInstallDraft(undefined)}
              >
                {t.cancel}
              </Button>
              <Button
                className="mcp-install-primary"
                disabled={operationPending}
                icon={
                  <DownloadSimpleIcon
                    aria-hidden="true"
                    size={16}
                    weight="bold"
                  />
                }
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

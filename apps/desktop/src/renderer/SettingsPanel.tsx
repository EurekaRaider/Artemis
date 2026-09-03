import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import type {
  AppLocale,
  AppLanguage,
  AppTheme,
  ProviderConnection,
  ShellProfileMode,
  WindowsShellPreference,
} from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";
import {
  ConfirmationDialog,
  Dialog,
  EmptyState,
  ErrorState,
  InlineNotice,
  LoadingState,
} from "@artemis/ui/feedback";
import {
  Checkbox,
  Select,
  Switch,
  TextAreaField,
  TextField,
} from "@artemis/ui/forms";
import { PanelHeader } from "@artemis/ui/layout";
import {
  ManagementRow,
  ManagementSection,
  SettingsSurface,
} from "@artemis/ui/management";
import { Tabs } from "@artemis/ui/navigation";

import type {
  AddedModelConfiguration,
  ConfigurationImportCategory,
  ConfigurationImportPreview,
  ConfigurationImportSource,
  SettingsSnapshot,
} from "../shared/api.js";
import {
  LOCALE_METADATA,
  SUPPORTED_LOCALES,
  legacyLocale,
} from "../shared/locales.js";
import { I18N_RESOURCES } from "../shared/i18n-resources.js";
import { prepareProfileAvatar } from "./profile-avatar.js";

interface SettingsPanelProps {
  initialSettings?: SettingsSnapshot | undefined;
  initialTab?: SettingsTab;
  locale: AppLocale;
  onClose(): void;
  returnFocusRef?: RefObject<HTMLElement | null> | undefined;
  onSettingsChange(
    settings: SettingsSnapshot,
    options?: { refreshThreads?: boolean },
  ): void;
}

const labels = {
  en: {
    title: "Settings",
    close: "Close",
    tabGeneral: "General",
    tabProviders: "Providers & models",
    providerConfigBuiltin: "Built-in",
    providerConfigCustom: "Custom",
    tabAgents: "Agent configuration",
    tabCapabilities: "Execution access",
    tabMaintenance: "Updates & diagnostics",
    model: "Model",
    modelSearch: "Search by model, Provider, or ID",
    modelSearchEmpty: "No matching models",
    modelUnavailable:
      "The model catalog is unavailable. Restart Artemis or check Updates & diagnostics.",
    contextWindow: "Context length",
    contextWindowHint:
      "Automatically compacts after usage exceeds 90%. Current model limit: {limit} tokens.",
    saveModel: "Add model",
    modelSaved: "Model added",
    modelSaveFailed: "Model could not be added",
    modelSavedDetail:
      "The model and any entered API key were saved. It is now available from the conversation model picker.",
    addedModels: "Added models",
    noAddedModels: "No models have been added",
    removeModel: "Remove model",
    removeModelConfirm: "Remove {model} from the conversation model picker?",
    removeModelCredentialConfirm:
      "This is the last added model for {provider}. Its saved API key will also be deleted.",
    deleteProviderConfirm:
      "Delete {provider}? Its models and saved API key will also be removed.",
    confirm: "OK",
    language: "Language",
    languageSystem: "Use system language",
    languageEnglish: "English",
    languageChinese: "Simplified Chinese",
    languageHint: "Language changes apply immediately.",
    theme: "Theme",
    themeSystem: "Use system theme",
    themeLight: "Light",
    themeDark: "Dark",
    themeHint: "Theme changes apply immediately.",
    profileAvatar: "Profile picture",
    profileAvatarUpload: "Choose image",
    profileAvatarChange: "Change image",
    profileAvatarRemove: "Remove",
    profileAvatarHint:
      "PNG, JPEG, or WebP up to 8 MiB. Artemis crops and stores a 256 px local copy.",
    customProviders: "Custom providers",
    provider: "Provider ID",
    providerName: "Provider display name",
    baseUrl: "Base URL, e.g. http://127.0.0.1:11434/v1",
    providerApi: "API protocol",
    chatCompletionsApi: "Chat Completions (/chat/completions)",
    responsesApi: "Responses (/responses)",
    modelId: "Model ID, e.g. deepseek-r1:8b",
    modelName: "Model display name",
    maxTokens: "Max output tokens",
    reasoningModel: "Supports reasoning",
    highestReasoningLevel: "Highest supported reasoning level",
    thinkingMinimal: "Minimal",
    thinkingLow: "Low",
    thinkingMedium: "Medium",
    thinkingHigh: "High",
    thinkingXHigh: "Extra high",
    thinkingMax: "Max",
    imageInput: "Supports image input",
    saveProvider: "Save provider connection",
    cancelEdit: "Cancel edit",
    providerHint:
      "Provider ID uses lowercase letters, numbers, dots, underscores, or hyphens. Use Responses for OpenCode @ai-sdk/openai, or Chat Completions for @ai-sdk/openai-compatible. API key is optional for local services.",
    configuredProviders: "Configured provider connections",
    noProviders: "No custom provider connections",
    apiKey: "API key",
    optionalApiKey: "API key (optional, encrypted)",
    storedApiKey: "API key already stored — leave blank to keep it",
    importPi: "Import Pi auth.json",
    delete: "Delete",
    encrypted: "Protected by OS encryption",
    unavailable: "OS encryption unavailable — credentials are read-only",
    imported: "credentials imported",
    loading: "Loading settings…",
    mcp: "MCP servers",
    addServer: "Add server",
    backToServers: "Back to MCP servers",
    addMcp: "Add MCP server",
    updateMcp: "Update {name} MCP",
    newServerHint: "Enter the command Artemis should launch.",
    transportChangeHint:
      "To change the MCP server type, uninstall the current configuration first.",
    serverId: "Server ID",
    serverName: "Display name",
    transport: "Transport",
    endpoint: "HTTPS URL or executable",
    launchCommand: "Launch command",
    serverUrl: "Server URL",
    arguments: "Arguments",
    addArgument: "Add argument",
    environmentVariables: "Environment variables",
    environmentKey: "Key",
    environmentValue: "Value",
    addEnvironment: "Add environment variable",
    environmentVariablePassthrough: "Environment variable passthrough",
    environmentVariableName: "Variable name",
    addEnvironmentVariable: "Add variable",
    workspace: "Working directory",
    bearer: "Bearer token (optional, encrypted)",
    authentication: "Authentication",
    authNone: "None",
    authBearer: "Bearer token",
    authOAuth: "OAuth 2.1",
    authorize: "Authorize",
    oauthHint:
      "Authorization opens your browser and stores tokens with OS encryption.",
    capabilityAccess: "Execution access",
    shellRuntime: "Shell runtime",
    shellRuntimeHint:
      "Agent commands stay non-interactive. Environment-only imports PATH and other non-secret variables once per task; full compatibility loads the user profile for every command. Dedicated profiles: ~/.config/artemis/agent-profile.zsh or .bash, and %LOCALAPPDATA%\\Artemis\\agent-profile.ps1.",
    windowsShell: "Windows shell",
    windowsShellAuto: "Automatic: PowerShell 7, then 5.1",
    windowsShellPowerShell7: "Require PowerShell 7",
    windowsShellLegacy: "Windows PowerShell 5.1",
    shellProfileMode: "Profile compatibility",
    shellProfileEnvironment: "Environment only (recommended)",
    shellProfileFull: "Full profile for every command",
    shellProfileDisabled: "Disabled",
    localFullAccess: "Full local access",
    localFullAccessDetail:
      "Allow executable extensions to run with your desktop permissions.",
    mcpFullAccessHint:
      "Local stdio MCP always has full local access and network access.",
    saveServer: "Save and connect",
    edit: "Edit",
    uninstall: "Uninstall",
    reconnect: "Reconnect",
    tools: "tools",
    noServers: "No MCP servers configured",
    extensions: "Trusted Pi extensions",
    trustExtension: "Select and trust extension",
    noExtensions: "No trusted extensions",
    enabled: "Enabled",
    extensionNetwork: "Allow network while tools run",
    retrust: "Trust current contents",
    extensionWarning:
      "Executable extensions are hash-pinned and run per tool call in the OS sandbox. Hooks, commands, flags, and shortcuts are not loaded.",
    updates: "Updates",
    checkUpdates: "Check for updates",
    installUpdate: "Restart and install",
    rollbackReady: "Previous healthy installer retained",
    diagnostics: "Diagnostics",
    diagnosticsHint:
      "Export a local, redacted crash bundle. Nothing is uploaded automatically.",
    exportDiagnostics: "Export diagnostic bundle",
    diagnosticsExported: "Diagnostic bundle exported:",
    globalAgents: "Global AGENTS.md",
    globalAgentsHint:
      "Loaded before each project's AGENTS.md for every new task and sub-agent.",
    saveGlobalAgents: "Save global rules",
    agentConcurrency: "Agent concurrency",
    agentConcurrencyHint:
      "Automatic mode sizes the global active-agent limit at startup and temporarily reduces it under system pressure. Running agents are never cancelled.",
    concurrencyMode: "Capacity mode",
    concurrencyAutomatic: "Automatic (recommended)",
    concurrencyManual: "Manual ceiling",
    concurrencyManualLimit: "Maximum active agents",
    concurrencyApply: "Apply ceiling",
    concurrencyLogical: "Logical members per task",
    concurrencyConfigured: "Configured ceiling",
    concurrencyAutomaticSafe: "Automatic safe ceiling",
    concurrencyEffective: "Effective now",
    concurrencyActive: "Active",
    concurrencyQueued: "Queued",
    concurrencyWaiting: "Collaboration waiting",
    concurrencyHighWarning:
      "High concurrency consumes quota faster and may trigger Provider rate limits. Artemis will still reduce admissions under system pressure.",
    concurrencyHardware: "Detected hardware",
    concurrencyHardwareValue: "{cores} parallel cores · {memory} GiB memory",
    concurrencyThrottled:
      "Temporarily reduced due to system pressure: {reasons}.",
    concurrencyCpu: "CPU",
    concurrencyEventLoop: "app responsiveness",
    concurrencyMemory: "memory",
    configurationImport: "Import existing agent configuration",
    configurationImportHint:
      "Preview and selectively import global rules, Skills, and MCP servers. Existing named resources are kept.",
    scanImports: "Scan Codex, OpenCode, and Claude Code",
    applyImports: "Import selected",
    importInstructions: "Global rules",
    importSkills: "Skills",
    importMcp: "MCP",
    detected: "detected",
    notDetected: "not detected",
    importCompleted: "Import completed",
  },
  "zh-CN": {
    title: "设置",
    close: "关闭",
    tabGeneral: "通用",
    tabProviders: "供应商及模型配置",
    providerConfigBuiltin: "内置",
    providerConfigCustom: "自定义",
    tabAgents: "Agent 配置",
    tabCapabilities: "执行权限",
    tabMaintenance: "更新与诊断",
    model: "模型",
    modelSearch: "搜索模型、Provider 或模型 ID",
    modelSearchEmpty: "没有匹配的模型",
    modelUnavailable: "模型目录暂不可用，请重启 Artemis 或查看“更新与诊断”。",
    contextWindow: "上下文长度",
    contextWindowHint:
      "使用量超过 90% 后自动压缩。当前模型上限：{limit} token。",
    saveModel: "添加模型",
    modelSaved: "模型已添加",
    modelSaveFailed: "模型添加失败",
    modelSavedDetail:
      "模型及本次填写的 API Key 已保存，现在可以从对话框的模型菜单中切换。",
    addedModels: "已添加模型",
    noAddedModels: "尚未添加模型",
    removeModel: "删除模型",
    removeModelConfirm: "从对话模型菜单中删除 {model}？",
    removeModelCredentialConfirm:
      "这是 {provider} 最后一个已添加模型，删除时也会清理已保存的 API Key。",
    deleteProviderConfirm:
      "删除 {provider}？其模型和已保存的 API Key 也会一并删除。",
    confirm: "确定",
    language: "语言",
    languageSystem: "跟随系统",
    languageEnglish: "English",
    languageChinese: "简体中文",
    languageHint: "语言修改后立即生效。",
    theme: "界面主题",
    themeSystem: "跟随系统",
    themeLight: "浅色",
    themeDark: "深色",
    themeHint: "主题修改后立即生效。",
    profileAvatar: "头像",
    profileAvatarUpload: "选择图片",
    profileAvatarChange: "更换图片",
    profileAvatarRemove: "移除",
    profileAvatarHint:
      "支持不超过 8 MiB 的 PNG、JPEG 或 WebP；Artemis 会裁剪并在本地保存 256 px 副本。",
    customProviders: "自定义 Provider",
    provider: "Provider ID",
    providerName: "Provider 显示名称",
    baseUrl: "Base URL，例如 http://127.0.0.1:11434/v1",
    providerApi: "API 协议",
    chatCompletionsApi: "Chat Completions (/chat/completions)",
    responsesApi: "Responses (/responses)",
    modelId: "模型 ID，例如 deepseek-r1:8b",
    modelName: "模型显示名称",
    maxTokens: "最大输出 Token",
    reasoningModel: "支持推理",
    highestReasoningLevel: "支持的最高推理档位",
    thinkingMinimal: "最低",
    thinkingLow: "低",
    thinkingMedium: "中",
    thinkingHigh: "高",
    thinkingXHigh: "极高",
    thinkingMax: "最高",
    imageInput: "支持图片输入",
    saveProvider: "保存 Provider 连接",
    cancelEdit: "取消编辑",
    providerHint:
      "Provider ID 仅支持小写字母、数字、点、下划线或连字符。OpenCode @ai-sdk/openai 请选择 Responses；@ai-sdk/openai-compatible 请选择 Chat Completions。本地服务可以不填写 API Key。",
    configuredProviders: "已配置的 Provider 连接",
    noProviders: "尚未配置自定义 Provider",
    apiKey: "API Key",
    optionalApiKey: "API Key（可选，加密保存）",
    storedApiKey: "已保存 API Key，留空则保持不变",
    importPi: "导入 Pi auth.json",
    delete: "删除",
    encrypted: "由操作系统加密保护",
    unavailable: "操作系统加密不可用——凭据只读",
    imported: "项凭据已导入",
    loading: "正在加载设置…",
    mcp: "MCP 服务器",
    addServer: "添加服务器",
    backToServers: "返回 MCP 服务器",
    addMcp: "添加 MCP 服务器",
    updateMcp: "更新 {name} MCP",
    newServerHint: "填写 Artemis 要启动的命令。",
    transportChangeHint: "如需切换 MCP 服务器类型，请先卸载当前配置。",
    serverId: "服务器 ID",
    serverName: "显示名称",
    transport: "传输",
    endpoint: "HTTPS URL 或可执行文件",
    launchCommand: "启动命令",
    serverUrl: "服务器 URL",
    arguments: "参数",
    addArgument: "添加参数",
    environmentVariables: "环境变量",
    environmentKey: "键",
    environmentValue: "值",
    addEnvironment: "添加环境变量",
    environmentVariablePassthrough: "环境变量传递",
    environmentVariableName: "变量名",
    addEnvironmentVariable: "添加变量",
    workspace: "工作目录",
    bearer: "Bearer Token（可选，加密保存）",
    authentication: "身份验证",
    authNone: "无",
    authBearer: "Bearer Token",
    authOAuth: "OAuth 2.1",
    authorize: "授权",
    oauthHint: "授权将在浏览器中完成，Token 由操作系统加密保存。",
    capabilityAccess: "执行权限",
    shellRuntime: "Shell 运行环境",
    shellRuntimeHint:
      "Agent 命令保持非交互。仅导入环境会在每个任务中捕获一次 PATH 等非敏感变量；完整兼容会在每条命令前加载用户 profile。专用配置文件：~/.config/artemis/agent-profile.zsh 或 .bash，以及 %LOCALAPPDATA%\\Artemis\\agent-profile.ps1。",
    windowsShell: "Windows Shell",
    windowsShellAuto: "自动：PowerShell 7，回退 5.1",
    windowsShellPowerShell7: "强制 PowerShell 7",
    windowsShellLegacy: "Windows PowerShell 5.1",
    shellProfileMode: "Profile 兼容模式",
    shellProfileEnvironment: "仅导入环境（推荐）",
    shellProfileFull: "每条命令加载完整 Profile",
    shellProfileDisabled: "关闭",
    localFullAccess: "完整本机访问",
    localFullAccessDetail: "允许可执行扩展使用当前桌面用户权限运行。",
    mcpFullAccessHint: "本地 stdio MCP 始终拥有完整本机访问权限并可联网。",
    saveServer: "保存并连接",
    edit: "编辑",
    uninstall: "卸载",
    reconnect: "重新连接",
    tools: "个工具",
    noServers: "尚未配置 MCP 服务器",
    extensions: "可信 Pi 扩展",
    trustExtension: "选择并信任扩展",
    noExtensions: "尚未信任扩展",
    enabled: "启用",
    extensionNetwork: "扩展工具运行时允许联网",
    retrust: "信任当前文件内容",
    extensionWarning:
      "可执行扩展按内容哈希锁定，并在每次工具调用时进入操作系统沙箱。事件 Hook、命令、Flag 和快捷键不会加载。",
    updates: "更新",
    checkUpdates: "检查更新",
    installUpdate: "重启并安装",
    rollbackReady: "已保留上一健康版本安装包",
    diagnostics: "诊断",
    diagnosticsHint: "导出本地脱敏崩溃诊断包，不会自动上传任何内容。",
    exportDiagnostics: "导出诊断包",
    diagnosticsExported: "诊断包已导出：",
    globalAgents: "全局 AGENTS.md",
    globalAgentsHint:
      "每个新任务和子代理都会先加载这里的约束，再加载项目内的 AGENTS.md。",
    saveGlobalAgents: "保存全局约束",
    agentConcurrency: "Agent 并发容量",
    agentConcurrencyHint:
      "自动模式会在启动时计算全局活动 Agent 上限，并在系统压力升高时临时收紧；已经运行的 Agent 不会被取消。",
    concurrencyMode: "容量模式",
    concurrencyAutomatic: "自动（推荐）",
    concurrencyManual: "手动上限",
    concurrencyManualLimit: "最大活动 Agent 数",
    concurrencyApply: "应用上限",
    concurrencyLogical: "每任务逻辑成员上限",
    concurrencyConfigured: "配置并发",
    concurrencyAutomaticSafe: "自动安全上限",
    concurrencyEffective: "当前有效",
    concurrencyActive: "运行中",
    concurrencyQueued: "排队中",
    concurrencyWaiting: "协作等待",
    concurrencyHighWarning:
      "高并发会更快消耗额度并可能触发 Provider 限流；系统压力下 Artemis 仍会自动降载。",
    concurrencyHardware: "检测到的硬件",
    concurrencyHardwareValue: "{cores} 个并行核心 · {memory} GiB 内存",
    concurrencyThrottled: "当前因系统压力临时收紧：{reasons}。",
    concurrencyCpu: "CPU",
    concurrencyEventLoop: "应用响应",
    concurrencyMemory: "内存",
    configurationImport: "导入现有 Agent 配置",
    configurationImportHint:
      "先预览，再选择性导入全局约束、Skills 与 MCP；同名现有资源不会被覆盖。",
    scanImports: "扫描 Codex、OpenCode 与 Claude Code",
    applyImports: "导入所选内容",
    importInstructions: "全局约束",
    importSkills: "Skills",
    importMcp: "MCP",
    detected: "已检测到",
    notDetected: "未检测到",
    importCompleted: "导入完成",
  },
} as const;

const DEFAULT_PROVIDER_CONTEXT_WINDOW = 1_000_000;
const DEFAULT_PROVIDER_MAX_TOKENS = 128_000;
const providerIdPattern = /^[a-z0-9][a-z0-9._-]*$/u;
type ProviderThinkingLevel = NonNullable<
  ProviderConnection["models"][number]["highestThinkingLevel"]
>;

type SettingsTab =
  "general" | "providers" | "agents" | "capabilities" | "maintenance";

function modelKey(providerId: string, modelId: string): string {
  return `${encodeURIComponent(providerId)}:${encodeURIComponent(modelId)}`;
}

function parseModelKey(value: string): [string, string] {
  const separator = value.indexOf(":");
  return [
    decodeURIComponent(value.slice(0, separator)),
    decodeURIComponent(value.slice(separator + 1)),
  ];
}

function modelFormState(settings: SettingsSnapshot | undefined): {
  contextWindow: string;
  selectedModel: string;
} {
  if (!settings) return { contextWindow: "", selectedModel: "" };
  const selected =
    (settings.selection
      ? settings.models.find(
          (model) =>
            model.providerId === settings.selection?.providerId &&
            model.modelId === settings.selection.modelId,
        )
      : undefined) ?? settings.models[0];
  return {
    contextWindow: String(
      Math.min(
        settings.contextWindow,
        selected?.contextWindow ?? settings.contextWindow,
      ),
    ),
    selectedModel: selected
      ? modelKey(selected.providerId, selected.modelId)
      : "",
  };
}

export function SettingsPanel({
  initialSettings,
  initialTab = "general",
  locale,
  onClose,
  onSettingsChange,
  returnFocusRef,
}: SettingsPanelProps) {
  const { i18n } = useTranslation("settings");
  const translate = i18n.getFixedT(locale, "settings");
  const t = {
    ...labels[legacyLocale(locale)],
    ...Object.fromEntries(
      Object.keys(I18N_RESOURCES.en.settings).map((key) => [
        key,
        translate(key),
      ]),
    ),
  } as (typeof labels)["en"];
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const [providerConfigTab, setProviderConfigTab] = useState<
    "builtin" | "custom"
  >("builtin");
  const [settings, setSettings] = useState(initialSettings);
  const [selectedModel, setSelectedModel] = useState(
    () => modelFormState(initialSettings).selectedModel,
  );
  const [contextWindow, setContextWindow] = useState(
    () => modelFormState(initialSettings).contextWindow,
  );
  const [editingProviderId, setEditingProviderId] = useState<string>();
  const [providerId, setProviderId] = useState("");
  const [providerName, setProviderName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [providerApi, setProviderApi] =
    useState<NonNullable<ProviderConnection["api"]>>("openai-completions");
  const [providerModelId, setProviderModelId] = useState("");
  const [providerModelName, setProviderModelName] = useState("");
  const [providerContextWindow, setProviderContextWindow] = useState(
    String(DEFAULT_PROVIDER_CONTEXT_WINDOW),
  );
  const [providerMaxTokens, setProviderMaxTokens] = useState(
    String(DEFAULT_PROVIDER_MAX_TOKENS),
  );
  const [providerReasoning, setProviderReasoning] = useState(false);
  const [providerHighestThinkingLevel, setProviderHighestThinkingLevel] =
    useState<ProviderThinkingLevel>("high");
  const [providerImages, setProviderImages] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [keyApiKey, setKeyApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [modelApplyResult, setModelApplyResult] = useState<{
    kind: "success" | "failure";
    detail: string;
  }>();
  const [modelDeleteTarget, setModelDeleteTarget] =
    useState<AddedModelConfiguration>();
  const [providerDeleteTarget, setProviderDeleteTarget] =
    useState<ProviderConnection>();
  const [globalAgentsContent, setGlobalAgentsContent] = useState(
    initialSettings?.globalAgents.content ?? "",
  );
  const [agentConcurrencyLimit, setAgentConcurrencyLimit] = useState(
    initialSettings
      ? String(
          initialSettings.agentConcurrency.preference.mode === "manual"
            ? initialSettings.agentConcurrency.preference.limit
            : initialSettings.agentConcurrency.configuredLimit,
        )
      : "",
  );
  const [importPreview, setImportPreview] =
    useState<ConfigurationImportPreview>();
  const [importSources, setImportSources] = useState<
    ConfigurationImportSource[]
  >([]);
  const [importCategories, setImportCategories] = useState<
    ConfigurationImportCategory[]
  >(["instructions", "skills", "mcp"]);
  const operationPendingRef = useRef(false);
  const profileAvatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let mounted = true;
    void window.artemis
      .getSettings()
      .then((snapshot) => {
        if (!mounted) return;
        setSettings(snapshot);
        setGlobalAgentsContent(snapshot.globalAgents.content);
        setAgentConcurrencyLimit(
          String(
            snapshot.agentConcurrency.preference.mode === "manual"
              ? snapshot.agentConcurrency.preference.limit
              : snapshot.agentConcurrency.configuredLimit,
          ),
        );
        const modelState = modelFormState(snapshot);
        setSelectedModel(modelState.selectedModel);
        setContextWindow(modelState.contextWindow);
      })
      .catch(
        (error) =>
          mounted &&
          setMessage(error instanceof Error ? error.message : String(error)),
      );
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(
    () =>
      window.artemis.onUpdateStatus((update) => {
        setSettings((current) => (current ? { ...current, update } : current));
      }),
    [],
  );

  const models = useMemo(
    () =>
      [...(settings?.models ?? [])].sort(
        (left, right) =>
          left.providerId.localeCompare(right.providerId) ||
          left.name.localeCompare(right.name),
      ),
    [settings?.models],
  );
  const selectedModelInfo = useMemo(() => {
    if (!selectedModel) return undefined;
    const [providerId, modelId] = parseModelKey(selectedModel);
    return models.find(
      (model) => model.providerId === providerId && model.modelId === modelId,
    );
  }, [models, selectedModel]);
  const selectedModelUsesCustomProvider = Boolean(
    selectedModelInfo &&
    settings?.providers.some(
      (provider) => provider.id === selectedModelInfo.providerId,
    ),
  );
  const selectedModelCredential = settings?.credentials.find(
    (credential) =>
      credential.providerId === selectedModelInfo?.providerId &&
      credential.type === "api_key",
  );
  const selectedModelCanBeAdded = Boolean(
    selectedModelInfo &&
    (selectedModelUsesCustomProvider ||
      selectedModelInfo.configured ||
      selectedModelCredential ||
      keyApiKey.trim()),
  );
  const parsedContextWindow = Number(contextWindow);
  const contextWindowValid =
    Number.isInteger(parsedContextWindow) &&
    parsedContextWindow >= 1_024 &&
    parsedContextWindow <=
      (selectedModelInfo?.contextWindow ?? Number.POSITIVE_INFINITY);
  const parsedProviderContextWindow = Number(providerContextWindow);
  const trimmedProviderId = providerId.trim();
  const providerIdValid =
    trimmedProviderId.length <= 80 && providerIdPattern.test(trimmedProviderId);
  const providerContextWindowValid =
    Number.isInteger(parsedProviderContextWindow) &&
    parsedProviderContextWindow >= 1_024 &&
    parsedProviderContextWindow <= 10_000_000;
  const parsedProviderMaxTokens = Number(providerMaxTokens);
  const providerMaxTokensValid =
    Number.isInteger(parsedProviderMaxTokens) &&
    parsedProviderMaxTokens >= 1 &&
    parsedProviderMaxTokens <= 1_000_000;
  const parsedAgentConcurrencyLimit = Number(agentConcurrencyLimit);
  const agentConcurrencyLimitValid =
    Number.isInteger(parsedAgentConcurrencyLimit) &&
    parsedAgentConcurrencyLimit >= 2 &&
    parsedAgentConcurrencyLimit <= (settings?.agentConcurrency.hardLimit ?? 64);

  function selectModel(value: string) {
    const [providerId, modelId] = parseModelKey(value);
    if (selectedModel && parseModelKey(selectedModel)[0] !== providerId) {
      setKeyApiKey("");
    }
    setSelectedModel(value);
    const model = models.find(
      (candidate) =>
        candidate.providerId === providerId && candidate.modelId === modelId,
    );
    if (!model) return;
    setContextWindow((current) => {
      const parsed = Number(current);
      return Number.isInteger(parsed) &&
        parsed >= 1_024 &&
        parsed <= model.contextWindow
        ? current
        : String(model.contextWindow);
    });
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
        selectedModelUsesCustomProvider
          ? undefined
          : keyApiKey.trim() || undefined,
      );
      setSettings(updated);
      onSettingsChange(updated);
      setKeyApiKey("");
      setModelApplyResult({
        kind: "success",
        detail: t.modelSavedDetail,
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
    await run(async () => {
      const updated = await window.artemis.removeModel({
        providerId: modelDeleteTarget.providerId,
        modelId: modelDeleteTarget.modelId,
      });
      setSettings(updated);
      onSettingsChange(updated, { refreshThreads: true });
      setModelDeleteTarget(undefined);
      const selected = updated.selection
        ? updated.models.find(
            (model) =>
              model.providerId === updated.selection?.providerId &&
              model.modelId === updated.selection.modelId,
          )
        : updated.models[0];
      if (selected) {
        setSelectedModel(modelKey(selected.providerId, selected.modelId));
        setContextWindow(
          String(Math.min(updated.contextWindow, selected.contextWindow)),
        );
      } else {
        setSelectedModel("");
        setContextWindow(String(updated.contextWindow));
      }
    });
  }

  async function setLanguage(language: AppLanguage) {
    await run(async () => {
      const updated = await window.artemis.setLanguage(language);
      setSettings(updated);
      onSettingsChange(updated);
    });
  }

  async function setTheme(theme: AppTheme) {
    await run(async () => {
      const updated = await window.artemis.setTheme(theme);
      setSettings(updated);
      onSettingsChange(updated);
    });
  }

  async function setProfileAvatar(file: File | undefined) {
    await run(async () => {
      const avatar = file ? await prepareProfileAvatar(file) : undefined;
      const updated = await window.artemis.setProfileAvatar(avatar);
      setSettings(updated);
      onSettingsChange(updated);
    });
  }

  async function setShellRuntimeConfiguration(
    change:
      | { windowsPreference: WindowsShellPreference }
      | { profileMode: ShellProfileMode },
  ) {
    if (!settings) return;
    await run(async () => {
      const updated = await window.artemis.setShellRuntimeConfiguration({
        ...settings.shell,
        ...change,
      });
      setSettings(updated);
      onSettingsChange(updated);
    });
  }

  async function setAgentConcurrencyMode(mode: "auto" | "manual") {
    if (!settings) return;
    await run(async () => {
      const manualLimit = agentConcurrencyLimitValid
        ? parsedAgentConcurrencyLimit
        : settings.agentConcurrency.configuredLimit;
      const updated = await window.artemis.setAgentConcurrency(
        mode === "auto"
          ? { mode: "auto" }
          : { mode: "manual", limit: manualLimit },
      );
      setSettings(updated);
      setAgentConcurrencyLimit(
        String(
          updated.agentConcurrency.preference.mode === "manual"
            ? updated.agentConcurrency.preference.limit
            : updated.agentConcurrency.configuredLimit,
        ),
      );
      onSettingsChange(updated);
    });
  }

  async function applyAgentConcurrencyLimit() {
    if (!agentConcurrencyLimitValid) return;
    await run(async () => {
      const updated = await window.artemis.setAgentConcurrency({
        mode: "manual",
        limit: parsedAgentConcurrencyLimit,
      });
      setSettings(updated);
      onSettingsChange(updated);
    });
  }

  async function saveProviderConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const provider: ProviderConnection = {
      id: trimmedProviderId,
      name: providerName.trim() || trimmedProviderId,
      baseUrl: baseUrl.trim(),
      api: providerApi,
      models: [
        {
          id: providerModelId.trim(),
          name: providerModelName.trim() || providerModelId.trim(),
          reasoning: providerReasoning,
          ...(providerReasoning
            ? { highestThinkingLevel: providerHighestThinkingLevel }
            : {}),
          input: providerImages ? ["text", "image"] : ["text"],
          contextWindow: parsedProviderContextWindow,
          maxTokens: parsedProviderMaxTokens,
        },
      ],
    };
    await run(async () => {
      const updated = await window.artemis.saveProviderConnection(
        provider,
        apiKey.trim() || undefined,
      );
      setSettings(updated);
      onSettingsChange(updated);
      const savedModel = updated.models.find(
        (model) =>
          model.providerId === provider.id &&
          model.modelId === provider.models[0]!.id,
      );
      if (savedModel) {
        setSelectedModel(modelKey(savedModel.providerId, savedModel.modelId));
        setContextWindow(String(savedModel.contextWindow));
      } else if (updated.models[0]) {
        setSelectedModel(
          modelKey(updated.models[0].providerId, updated.models[0].modelId),
        );
        setContextWindow(String(updated.models[0].contextWindow));
      }
      resetProviderForm();
    });
  }

  function resetProviderForm() {
    setEditingProviderId(undefined);
    setProviderId("");
    setProviderName("");
    setBaseUrl("");
    setProviderApi("openai-completions");
    setProviderModelId("");
    setProviderModelName("");
    setProviderContextWindow(String(DEFAULT_PROVIDER_CONTEXT_WINDOW));
    setProviderMaxTokens(String(DEFAULT_PROVIDER_MAX_TOKENS));
    setProviderReasoning(false);
    setProviderHighestThinkingLevel("high");
    setProviderImages(false);
    setApiKey("");
  }

  function editProviderConnection(provider: ProviderConnection) {
    const model = provider.models[0];
    setEditingProviderId(provider.id);
    setProviderId(provider.id);
    setProviderName(provider.name);
    setBaseUrl(provider.baseUrl);
    setProviderApi(provider.api ?? "openai-completions");
    setProviderModelId(model?.id ?? "");
    setProviderModelName(model?.name ?? "");
    setProviderContextWindow(
      String(model?.contextWindow ?? DEFAULT_PROVIDER_CONTEXT_WINDOW),
    );
    setProviderMaxTokens(
      String(model?.maxTokens ?? DEFAULT_PROVIDER_MAX_TOKENS),
    );
    setProviderReasoning(model?.reasoning ?? false);
    setProviderHighestThinkingLevel(model?.highestThinkingLevel ?? "high");
    setProviderImages(model?.input.includes("image") ?? false);
    setApiKey("");
  }

  async function deleteProviderConnection(provider: ProviderConnection) {
    await run(async () => {
      const updated = await window.artemis.deleteProviderConnection(
        provider.id,
      );
      setSettings(updated);
      onSettingsChange(updated);
      setProviderDeleteTarget(undefined);
      if (editingProviderId === provider.id) {
        resetProviderForm();
      }
      const selected = updated.selection
        ? updated.models.find(
            (model) =>
              model.providerId === updated.selection?.providerId &&
              model.modelId === updated.selection.modelId,
          )
        : updated.models[0];
      if (selected) {
        setSelectedModel(modelKey(selected.providerId, selected.modelId));
        setContextWindow(
          String(Math.min(updated.contextWindow, selected.contextWindow)),
        );
      } else {
        setSelectedModel("");
        setContextWindow(String(updated.contextWindow));
      }
    });
  }

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

  const activeTabLabel: Record<SettingsTab, string> = {
    general: t.tabGeneral,
    providers: t.tabProviders,
    agents: t.tabAgents,
    capabilities: t.tabCapabilities,
    maintenance: t.tabMaintenance,
  };

  return (
    <>
      <Dialog
        className="settings-panel"
        label={t.title}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        open
        returnFocusRef={returnFocusRef}
      >
        <SettingsSurface
          busy={busy}
          header={
            <PanelHeader
              actions={
                <Button onClick={onClose} variant="quiet">
                  {t.close}
                </Button>
              }
              className="settings-header"
              headingLevel={2}
              title={t.title}
            />
          }
          label={`${t.title} · ${activeTabLabel[activeTab]}`}
          navigation={
            settings ? (
              <Tabs<SettingsTab>
                className="settings-tabs"
                label={t.title}
                onValueChange={setActiveTab}
                options={[
                  {
                    id: "settings-tab-general-button",
                    label: t.tabGeneral,
                    panelId: "settings-tab-general",
                    value: "general",
                  },
                  {
                    id: "settings-tab-providers-button",
                    label: t.tabProviders,
                    panelId: "settings-tab-providers",
                    value: "providers",
                  },
                  {
                    id: "settings-tab-agents-button",
                    label: t.tabAgents,
                    panelId: "settings-tab-agents",
                    value: "agents",
                  },
                  {
                    id: "settings-tab-capabilities-button",
                    label: t.tabCapabilities,
                    panelId: "settings-tab-capabilities",
                    value: "capabilities",
                  },
                  {
                    id: "settings-tab-maintenance-button",
                    label: t.tabMaintenance,
                    panelId: "settings-tab-maintenance",
                    value: "maintenance",
                  },
                ]}
                value={activeTab}
              />
            ) : (
              <span aria-hidden="true" />
            )
          }
          state={!settings ? (message ? "error" : "loading") : undefined}
        >
          {!settings ? (
            message ? (
              <ErrorState className="settings-loading" title={t.title}>
                {message}
              </ErrorState>
            ) : (
              <LoadingState
                className="settings-loading"
                label={t.loading}
                lines={4}
              />
            )
          ) : (
            <div
              aria-labelledby={`settings-tab-${activeTab}-button`}
              className="settings-content"
              id={`settings-tab-${activeTab}`}
              role="tabpanel"
            >
              {activeTab === "providers" && (
                <>
                  <Tabs<"builtin" | "custom">
                    className="provider-config-tabs"
                    label={t.tabProviders}
                    onValueChange={setProviderConfigTab}
                    options={[
                      {
                        id: "provider-config-builtin-tab",
                        label: t.providerConfigBuiltin,
                        panelId: "provider-config-builtin",
                        value: "builtin",
                      },
                      {
                        id: "provider-config-custom-tab",
                        label: t.providerConfigCustom,
                        panelId: "provider-config-custom",
                        value: "custom",
                      },
                    ]}
                    size="compact"
                    value={providerConfigTab}
                  />
                  {providerConfigTab === "builtin" && (
                    <ManagementSection
                      className="settings-section"
                      id="provider-config-builtin"
                      labelledBy="provider-config-builtin-tab"
                      role="tabpanel"
                      title={t.model}
                    >
                      <Select
                        label={t.model}
                        disabled={busy || models.length === 0}
                        onValueChange={selectModel}
                        noResultsLabel={t.modelSearchEmpty}
                        options={models.map((model) => ({
                          value: modelKey(model.providerId, model.modelId),
                          label: `${model.providerId} · ${model.name} · ${model.modelId}`,
                          searchText: `${model.providerId} ${model.name} ${model.modelId}`,
                        }))}
                        searchPlaceholder={t.modelSearch}
                        value={selectedModel}
                      />
                      {models.length === 0 && (
                        <EmptyState
                          className="settings-empty"
                          title={t.modelUnavailable}
                        />
                      )}
                      <TextField
                        className="settings-field"
                        disabled={busy || !selectedModelInfo}
                        label={t.contextWindow}
                        max={selectedModelInfo?.contextWindow}
                        min={1_024}
                        onValueChange={setContextWindow}
                        step={1_024}
                        type="number"
                        value={contextWindow}
                      />
                      {selectedModelInfo && (
                        <InlineNotice className="settings-security" tone="info">
                          {t.contextWindowHint.replace(
                            "{limit}",
                            selectedModelInfo.contextWindow.toLocaleString(
                              locale,
                            ),
                          )}
                        </InlineNotice>
                      )}
                      {!selectedModelUsesCustomProvider && (
                        <>
                          <TextField
                            autoComplete="off"
                            className="settings-field"
                            disabled={
                              busy ||
                              !selectedModelInfo ||
                              !settings.encryptionAvailable
                            }
                            label={`${t.apiKey}${
                              selectedModelInfo?.providerId
                                ? ` · ${selectedModelInfo.providerId}`
                                : ""
                            }`}
                            onValueChange={setKeyApiKey}
                            placeholder={
                              selectedModelCredential
                                ? t.storedApiKey
                                : t.apiKey
                            }
                            type="password"
                            value={keyApiKey}
                          />
                          <InlineNotice
                            className="settings-security"
                            tone={
                              settings.encryptionAvailable ? "info" : "warning"
                            }
                          >
                            {settings.encryptionAvailable
                              ? t.encrypted
                              : t.unavailable}
                          </InlineNotice>
                        </>
                      )}
                      <Button
                        disabled={
                          busy ||
                          !selectedModel ||
                          !contextWindowValid ||
                          !selectedModelCanBeAdded
                        }
                        onClick={addModel}
                        variant="primary"
                      >
                        {t.saveModel}
                      </Button>
                      <div
                        aria-label={t.addedModels}
                        className="added-model-list"
                      >
                        <strong>{t.addedModels}</strong>
                        {settings.addedModels.map((model) => {
                          const catalogModel = models.find(
                            (candidate) =>
                              candidate.providerId === model.providerId &&
                              candidate.modelId === model.modelId,
                          );
                          return (
                            <ManagementRow
                              actions={
                                <Button
                                  disabled={busy}
                                  label={`${t.delete}: ${catalogModel?.name ?? model.modelId}`}
                                  onClick={() => {
                                    setMessage("");
                                    setModelDeleteTarget(model);
                                  }}
                                  variant="danger"
                                >
                                  {t.delete}
                                </Button>
                              }
                              className="added-model-row"
                              description={`${model.providerId} · ${model.modelId} · ${model.contextWindow.toLocaleString(locale)} token`}
                              key={modelKey(model.providerId, model.modelId)}
                              title={catalogModel?.name ?? model.modelId}
                            />
                          );
                        })}
                        {settings.addedModels.length === 0 && (
                          <EmptyState
                            className="settings-empty"
                            title={t.noAddedModels}
                          />
                        )}
                      </div>
                      <Button
                        disabled={busy || !settings.encryptionAvailable}
                        onClick={() =>
                          void run(async () => {
                            const result =
                              await window.artemis.importPiCredentials();
                            if (result) {
                              setSettings(result.settings);
                              setMessage(`${result.imported} ${t.imported}`);
                            }
                          })
                        }
                      >
                        {t.importPi}
                      </Button>
                    </ManagementSection>
                  )}
                </>
              )}

              {activeTab === "general" && (
                <>
                  <ManagementSection
                    className="settings-section"
                    description={t.profileAvatarHint}
                    title={t.profileAvatar}
                  >
                    <div className="settings-profile-avatar">
                      <div className="settings-profile-avatar-preview">
                        {settings.profileAvatar ? (
                          <img alt="" src={settings.profileAvatar} />
                        ) : (
                          <span aria-hidden="true">◎</span>
                        )}
                      </div>
                      <div className="settings-profile-avatar-actions">
                        <input
                          accept="image/jpeg,image/png,image/webp"
                          aria-label={
                            settings.profileAvatar
                              ? t.profileAvatarChange
                              : t.profileAvatarUpload
                          }
                          className="profile-avatar-input"
                          disabled={busy}
                          onChange={(event) => {
                            const file = event.currentTarget.files?.[0];
                            event.currentTarget.value = "";
                            if (file) void setProfileAvatar(file);
                          }}
                          ref={profileAvatarInputRef}
                          type="file"
                        />
                        <Button
                          disabled={busy}
                          onClick={() => profileAvatarInputRef.current?.click()}
                        >
                          {settings.profileAvatar
                            ? t.profileAvatarChange
                            : t.profileAvatarUpload}
                        </Button>
                        {settings.profileAvatar && (
                          <Button
                            disabled={busy}
                            onClick={() => void setProfileAvatar(undefined)}
                          >
                            {t.profileAvatarRemove}
                          </Button>
                        )}
                      </div>
                    </div>
                  </ManagementSection>

                  <ManagementSection
                    className="settings-section"
                    description={t.languageHint}
                    title={t.language}
                  >
                    <Select<AppLanguage>
                      label={t.language}
                      disabled={busy}
                      onValueChange={(language) => void setLanguage(language)}
                      options={[
                        { value: "system", label: t.languageSystem },
                        ...SUPPORTED_LOCALES.map((language) => ({
                          value: language,
                          label: LOCALE_METADATA[language].nativeName,
                        })),
                      ]}
                      value={settings.language}
                    />
                  </ManagementSection>

                  <ManagementSection
                    className="settings-section"
                    description={t.themeHint}
                    title={t.theme}
                  >
                    <Select<AppTheme>
                      label={t.theme}
                      disabled={busy}
                      onValueChange={(theme) => void setTheme(theme)}
                      options={[
                        { value: "system", label: t.themeSystem },
                        { value: "light", label: t.themeLight },
                        { value: "dark", label: t.themeDark },
                      ]}
                      value={settings.theme}
                    />
                  </ManagementSection>
                </>
              )}

              {activeTab === "providers" && providerConfigTab === "custom" && (
                <ManagementSection
                  className="settings-section"
                  description={t.providerHint}
                  id="provider-config-custom"
                  labelledBy="provider-config-custom-tab"
                  role="tabpanel"
                  title={t.customProviders}
                >
                  <form
                    className="credential-form provider-form"
                    onSubmit={(event) => void saveProviderConnection(event)}
                  >
                    <TextField
                      autoCapitalize="none"
                      autoCorrect="off"
                      disabled={busy || Boolean(editingProviderId)}
                      label={t.provider}
                      labelVisibility="hidden"
                      maxLength={80}
                      onValueChange={(value) =>
                        setProviderId(value.toLocaleLowerCase("en-US"))
                      }
                      pattern="[a-z0-9][a-z0-9._-]*"
                      placeholder={t.provider}
                      spellCheck={false}
                      value={providerId}
                    />
                    <TextField
                      disabled={busy}
                      label={t.providerName}
                      labelVisibility="hidden"
                      onValueChange={setProviderName}
                      placeholder={t.providerName}
                      value={providerName}
                    />
                    <TextField
                      disabled={busy}
                      label={t.baseUrl}
                      labelVisibility="hidden"
                      onValueChange={setBaseUrl}
                      placeholder={t.baseUrl}
                      type="url"
                      value={baseUrl}
                    />
                    <Select<NonNullable<ProviderConnection["api"]>>
                      label={t.providerApi}
                      disabled={busy}
                      onValueChange={setProviderApi}
                      options={[
                        {
                          value: "openai-completions",
                          label: t.chatCompletionsApi,
                        },
                        {
                          value: "openai-responses",
                          label: t.responsesApi,
                        },
                      ]}
                      value={providerApi}
                    />
                    <TextField
                      disabled={busy}
                      label={t.modelId}
                      labelVisibility="hidden"
                      onValueChange={setProviderModelId}
                      placeholder={t.modelId}
                      value={providerModelId}
                    />
                    <TextField
                      disabled={busy}
                      label={t.modelName}
                      labelVisibility="hidden"
                      onValueChange={setProviderModelName}
                      placeholder={t.modelName}
                      value={providerModelName}
                    />
                    <TextField
                      className="settings-field"
                      disabled={busy}
                      label={t.contextWindow}
                      max={10_000_000}
                      min={1_024}
                      onValueChange={setProviderContextWindow}
                      step={1}
                      type="number"
                      value={providerContextWindow}
                    />
                    <TextField
                      className="settings-field"
                      disabled={busy}
                      label={t.maxTokens}
                      max={1_000_000}
                      min={1}
                      onValueChange={setProviderMaxTokens}
                      step={1}
                      type="number"
                      value={providerMaxTokens}
                    />
                    <TextField
                      autoComplete="off"
                      disabled={busy || !settings.encryptionAvailable}
                      label={t.optionalApiKey}
                      labelVisibility="hidden"
                      onValueChange={setApiKey}
                      placeholder={t.optionalApiKey}
                      type="password"
                      value={apiKey}
                    />
                    <span className="provider-capabilities">
                      <Checkbox
                        checked={providerReasoning}
                        disabled={busy}
                        label={t.reasoningModel}
                        onCheckedChange={setProviderReasoning}
                      />
                      <Checkbox
                        checked={providerImages}
                        disabled={busy}
                        label={t.imageInput}
                        onCheckedChange={setProviderImages}
                      />
                    </span>
                    {providerReasoning && (
                      <Select<ProviderThinkingLevel>
                        label={t.highestReasoningLevel}
                        disabled={busy}
                        onValueChange={setProviderHighestThinkingLevel}
                        options={[
                          { value: "minimal", label: t.thinkingMinimal },
                          { value: "low", label: t.thinkingLow },
                          { value: "medium", label: t.thinkingMedium },
                          { value: "high", label: t.thinkingHigh },
                          { value: "xhigh", label: t.thinkingXHigh },
                          { value: "max", label: t.thinkingMax },
                        ]}
                        value={providerHighestThinkingLevel}
                      />
                    )}
                    <Button
                      disabled={
                        busy ||
                        !providerIdValid ||
                        !baseUrl.trim() ||
                        !providerModelId.trim() ||
                        !providerContextWindowValid ||
                        !providerMaxTokensValid ||
                        (Boolean(apiKey) && !settings.encryptionAvailable)
                      }
                      type="submit"
                      variant="primary"
                    >
                      {t.saveProvider}
                    </Button>
                    {editingProviderId && (
                      <Button disabled={busy} onClick={resetProviderForm}>
                        {t.cancelEdit}
                      </Button>
                    )}
                  </form>
                  <strong className="settings-subheading">
                    {t.configuredProviders}
                  </strong>
                  <div className="credential-list">
                    {settings.providers.map((provider) => (
                      <ManagementRow
                        actions={
                          <span className="mcp-server-actions">
                            <Button
                              disabled={busy}
                              onClick={() => editProviderConnection(provider)}
                              variant="quiet"
                            >
                              {t.edit}
                            </Button>
                            <Button
                              disabled={busy}
                              onClick={() => setProviderDeleteTarget(provider)}
                              variant="danger"
                            >
                              {t.delete}
                            </Button>
                          </span>
                        }
                        description={
                          <span>
                            <span>
                              {provider.id} ·{" "}
                              {provider.api ?? "openai-completions"} ·{" "}
                              {provider.baseUrl}
                            </span>
                            <span>
                              {provider.models
                                .map((model) => model.name)
                                .join(", ")}
                            </span>
                          </span>
                        }
                        key={provider.id}
                        title={provider.name}
                      />
                    ))}
                    {!settings.providers.length && (
                      <EmptyState
                        className="settings-empty"
                        title={t.noProviders}
                      />
                    )}
                  </div>
                </ManagementSection>
              )}

              {activeTab === "agents" && (
                <>
                  <ManagementSection
                    className="settings-section"
                    description={t.agentConcurrencyHint}
                    title={t.agentConcurrency}
                  >
                    <Select<"auto" | "manual">
                      label={t.concurrencyMode}
                      disabled={busy}
                      onValueChange={(mode) =>
                        void setAgentConcurrencyMode(mode)
                      }
                      options={[
                        {
                          value: "auto",
                          label: t.concurrencyAutomatic,
                        },
                        {
                          value: "manual",
                          label: t.concurrencyManual,
                        },
                      ]}
                      value={settings.agentConcurrency.preference.mode}
                    />
                    {settings.agentConcurrency.preference.mode === "manual" && (
                      <TextField
                        className="settings-field"
                        disabled={busy}
                        label={t.concurrencyManualLimit}
                        max={settings.agentConcurrency.hardLimit}
                        min={2}
                        onValueChange={setAgentConcurrencyLimit}
                        step={1}
                        type="number"
                        value={agentConcurrencyLimit}
                      />
                    )}
                    {settings.agentConcurrency.preference.mode === "manual" && (
                      <Button
                        disabled={
                          busy ||
                          !agentConcurrencyLimitValid ||
                          parsedAgentConcurrencyLimit ===
                            settings.agentConcurrency.configuredLimit
                        }
                        onClick={() => void applyAgentConcurrencyLimit()}
                        variant="primary"
                      >
                        {t.concurrencyApply}
                      </Button>
                    )}
                    <dl className="agent-concurrency-status">
                      <div>
                        <dt>{t.concurrencyLogical}</dt>
                        <dd>{settings.agentConcurrency.logicalLimit}</dd>
                      </div>
                      <div>
                        <dt>{t.concurrencyConfigured}</dt>
                        <dd>{settings.agentConcurrency.configuredLimit}</dd>
                      </div>
                      <div>
                        <dt>{t.concurrencyAutomaticSafe}</dt>
                        <dd>{settings.agentConcurrency.automaticSafeLimit}</dd>
                      </div>
                      <div>
                        <dt>{t.concurrencyEffective}</dt>
                        <dd>{settings.agentConcurrency.effectiveLimit}</dd>
                      </div>
                      <div>
                        <dt>{t.concurrencyActive}</dt>
                        <dd>{settings.agentConcurrency.active}</dd>
                      </div>
                      <div>
                        <dt>{t.concurrencyQueued}</dt>
                        <dd>{settings.agentConcurrency.queued}</dd>
                      </div>
                      <div>
                        <dt>{t.concurrencyWaiting}</dt>
                        <dd>{settings.agentConcurrency.waiting}</dd>
                      </div>
                    </dl>
                    <InlineNotice className="settings-security" tone="info">
                      {t.concurrencyHardware}:{" "}
                      {t.concurrencyHardwareValue
                        .replace(
                          "{cores}",
                          String(settings.agentConcurrency.parallelism),
                        )
                        .replace(
                          "{memory}",
                          String(settings.agentConcurrency.totalMemoryGiB),
                        )}
                    </InlineNotice>
                    {settings.agentConcurrency.throttled && (
                      <InlineNotice
                        className="settings-security"
                        tone="warning"
                      >
                        {t.concurrencyThrottled.replace(
                          "{reasons}",
                          settings.agentConcurrency.pressureReasons
                            .map((reason) =>
                              reason === "cpu"
                                ? t.concurrencyCpu
                                : reason === "memory"
                                  ? t.concurrencyMemory
                                  : t.concurrencyEventLoop,
                            )
                            .join(", "),
                        )}
                      </InlineNotice>
                    )}
                    {settings.agentConcurrency.preference.mode === "manual" &&
                      settings.agentConcurrency.configuredLimit >
                        settings.agentConcurrency.automaticSafeLimit && (
                        <InlineNotice
                          className="settings-security"
                          tone="warning"
                        >
                          {t.concurrencyHighWarning}
                        </InlineNotice>
                      )}
                  </ManagementSection>
                  <ManagementSection
                    className="settings-section"
                    description={t.globalAgentsHint}
                    title={t.globalAgents}
                  >
                    <TextAreaField
                      disabled={busy}
                      label={t.globalAgents}
                      labelVisibility="hidden"
                      onValueChange={setGlobalAgentsContent}
                      rows={10}
                      value={globalAgentsContent}
                    />
                    <Button
                      disabled={
                        busy ||
                        globalAgentsContent === settings.globalAgents.content
                      }
                      onClick={() => void saveGlobalAgents()}
                      variant="primary"
                    >
                      {t.saveGlobalAgents}
                    </Button>
                  </ManagementSection>
                  <ManagementSection
                    className="settings-section"
                    description={t.configurationImportHint}
                    title={t.configurationImport}
                  >
                    <Button
                      disabled={busy}
                      onClick={() => void scanConfigurationImports()}
                    >
                      {t.scanImports}
                    </Button>
                    {importPreview && (
                      <div className="configuration-import">
                        <div className="configuration-import-categories">
                          {(
                            [
                              ["instructions", t.importInstructions],
                              ["skills", t.importSkills],
                              ["mcp", t.importMcp],
                            ] as const
                          ).map(([category, label]) => (
                            <Checkbox
                              checked={importCategories.includes(category)}
                              disabled={busy}
                              key={category}
                              label={label}
                              onCheckedChange={(checked) =>
                                toggleImportCategory(category, checked)
                              }
                            />
                          ))}
                        </div>
                        {importPreview.sources.map((source) => {
                          const sourceLabel =
                            source.source === "claude"
                              ? "Claude Code"
                              : source.source === "opencode"
                                ? "OpenCode"
                                : "Codex";
                          return (
                            <ManagementRow
                              actions={
                                <Checkbox
                                  checked={importSources.includes(
                                    source.source,
                                  )}
                                  disabled={busy || !source.detected}
                                  label={`${sourceLabel}: ${source.detected ? t.detected : t.notDetected}`}
                                  labelVisibility="hidden"
                                  onCheckedChange={(checked) =>
                                    toggleImportSource(source.source, checked)
                                  }
                                />
                              }
                              className="configuration-import-source"
                              description={`${source.detected ? t.detected : t.notDetected} · ${t.importInstructions} ${source.counts.instructions} · ${t.importSkills} ${source.counts.skills} · ${t.importMcp} ${source.counts.mcp}`}
                              key={source.source}
                              state={source.detected ? "ready" : "disabled"}
                              title={sourceLabel}
                            />
                          );
                        })}
                        <Button
                          disabled={
                            busy ||
                            importSources.length === 0 ||
                            importCategories.length === 0
                          }
                          onClick={() => void importConfiguration()}
                          variant="primary"
                        >
                          {t.applyImports}
                        </Button>
                      </div>
                    )}
                  </ManagementSection>
                </>
              )}

              {activeTab === "capabilities" && (
                <>
                  <ManagementSection
                    className="settings-section"
                    description={t.shellRuntimeHint}
                    title={t.shellRuntime}
                  >
                    {settings.platform === "win32" && (
                      <Select<WindowsShellPreference>
                        label={t.windowsShell}
                        disabled={busy}
                        onValueChange={(windowsPreference) =>
                          void setShellRuntimeConfiguration({
                            windowsPreference,
                          })
                        }
                        options={[
                          {
                            value: "auto",
                            label: t.windowsShellAuto,
                          },
                          {
                            value: "powershell7",
                            label: t.windowsShellPowerShell7,
                          },
                          {
                            value: "windows-powershell",
                            label: t.windowsShellLegacy,
                          },
                        ]}
                        value={settings.shell.windowsPreference}
                      />
                    )}
                    <Select<ShellProfileMode>
                      label={t.shellProfileMode}
                      disabled={busy}
                      onValueChange={(profileMode) =>
                        void setShellRuntimeConfiguration({ profileMode })
                      }
                      options={[
                        {
                          value: "environment",
                          label: t.shellProfileEnvironment,
                        },
                        {
                          value: "full",
                          label: t.shellProfileFull,
                        },
                        {
                          value: "disabled",
                          label: t.shellProfileDisabled,
                        },
                      ]}
                      value={settings.shell.profileMode}
                    />
                  </ManagementSection>

                  <ManagementSection
                    className="settings-section"
                    description={t.localFullAccessDetail}
                    title={t.capabilityAccess}
                    tone="warning"
                  >
                    <Switch
                      checked={settings.localFullAccess}
                      disabled={busy}
                      label={t.localFullAccess}
                      onCheckedChange={(checked) =>
                        void run(async () => {
                          const updated =
                            await window.artemis.setLocalFullAccess(checked);
                          setSettings(updated);
                          onSettingsChange(updated);
                        })
                      }
                    />
                  </ManagementSection>
                </>
              )}

              {activeTab === "maintenance" && (
                <>
                  <ManagementSection
                    className="settings-section"
                    description={t.diagnosticsHint}
                    title={t.diagnostics}
                  >
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const path = await window.artemis.exportDiagnostics();
                          if (path) setMessage(t.diagnosticsExported);
                        })
                      }
                    >
                      {t.exportDiagnostics}
                    </Button>
                  </ManagementSection>
                  <ManagementSection
                    className="settings-section"
                    title={t.updates}
                  >
                    <InlineNotice className="settings-security" tone="info">
                      {settings.update.currentVersion} · {settings.update.state}
                      {settings.update.availableVersion
                        ? ` → ${settings.update.availableVersion}`
                        : ""}
                      {settings.update.progress === undefined
                        ? ""
                        : ` · ${Math.round(settings.update.progress)}%`}
                    </InlineNotice>
                    {settings.update.rollbackAvailable && (
                      <InlineNotice
                        className="settings-security"
                        tone="success"
                      >
                        {t.rollbackReady}
                      </InlineNotice>
                    )}
                    {settings.update.message && (
                      <InlineNotice tone="danger">
                        {settings.update.message}
                      </InlineNotice>
                    )}
                    <span>
                      <Button
                        disabled={
                          busy ||
                          settings.update.state === "disabled" ||
                          settings.update.state === "checking" ||
                          settings.update.state === "downloading"
                        }
                        onClick={() =>
                          void run(async () => {
                            const update =
                              await window.artemis.checkForUpdates();
                            setSettings((current) =>
                              current ? { ...current, update } : current,
                            );
                          })
                        }
                      >
                        {t.checkUpdates}
                      </Button>
                      {settings.update.state === "downloaded" && (
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void run(() => window.artemis.installUpdate())
                          }
                        >
                          {t.installUpdate}
                        </Button>
                      )}
                    </span>
                  </ManagementSection>
                </>
              )}
              {message && (
                <InlineNotice className="settings-message" tone="info">
                  {message}
                </InlineNotice>
              )}
            </div>
          )}
        </SettingsSurface>
      </Dialog>

      {modelApplyResult && (
        <ConfirmationDialog
          actions={
            <Button onClick={() => setModelApplyResult(undefined)}>
              {t.confirm}
            </Button>
          }
          className="model-apply-dialog"
          description={modelApplyResult.detail}
          label={
            modelApplyResult.kind === "success"
              ? t.modelSaved
              : t.modelSaveFailed
          }
          onOpenChange={(open) => {
            if (!open) setModelApplyResult(undefined);
          }}
          open
          title={
            modelApplyResult.kind === "success"
              ? t.modelSaved
              : t.modelSaveFailed
          }
          tone={modelApplyResult.kind === "success" ? "success" : "danger"}
        />
      )}
      {modelDeleteTarget && settings && (
        <ConfirmationDialog
          actions={
            <>
              <Button
                disabled={busy}
                onClick={() => setModelDeleteTarget(undefined)}
              >
                {t.cancelEdit}
              </Button>
              <Button
                loading={busy}
                onClick={() => void removeModel()}
                variant="danger"
              >
                {t.delete}
              </Button>
            </>
          }
          className="model-delete-dialog"
          description={
            <>
              <p>
                {t.removeModelConfirm.replace(
                  "{model}",
                  models.find(
                    (model) =>
                      model.providerId === modelDeleteTarget.providerId &&
                      model.modelId === modelDeleteTarget.modelId,
                  )?.name ?? modelDeleteTarget.modelId,
                )}
              </p>
              {!settings.providers.some(
                (provider) => provider.id === modelDeleteTarget.providerId,
              ) &&
                settings.addedModels.filter(
                  (model) => model.providerId === modelDeleteTarget.providerId,
                ).length === 1 &&
                settings.credentials.some(
                  (credential) =>
                    credential.providerId === modelDeleteTarget.providerId,
                ) && (
                  <InlineNotice tone="warning">
                    {t.removeModelCredentialConfirm.replace(
                      "{provider}",
                      modelDeleteTarget.providerId,
                    )}
                  </InlineNotice>
                )}
              {message && <InlineNotice tone="danger">{message}</InlineNotice>}
            </>
          }
          disabled={busy}
          label={t.removeModel}
          onOpenChange={(open) => {
            if (!open && !busy) setModelDeleteTarget(undefined);
          }}
          open
          title={t.removeModel}
          tone="danger"
        />
      )}
      {providerDeleteTarget && (
        <ConfirmationDialog
          actions={
            <>
              <Button
                disabled={busy}
                onClick={() => setProviderDeleteTarget(undefined)}
              >
                {t.cancelEdit}
              </Button>
              <Button
                loading={busy}
                onClick={() =>
                  void deleteProviderConnection(providerDeleteTarget)
                }
                variant="danger"
              >
                {t.delete}
              </Button>
            </>
          }
          description={t.deleteProviderConfirm.replace(
            "{provider}",
            providerDeleteTarget.name,
          )}
          disabled={busy}
          label={t.delete}
          onOpenChange={(open) => {
            if (!open && !busy) setProviderDeleteTarget(undefined);
          }}
          open
          title={providerDeleteTarget.name}
          tone="danger"
        />
      )}
    </>
  );
}

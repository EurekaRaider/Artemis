import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type {
  AppLocale,
  AppLanguage,
  AppTheme,
  ProviderConnection,
} from "@artemis/protocol";

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
import { CodexSelect } from "./CodexSelect.js";

interface SettingsPanelProps {
  initialTab?: SettingsTab;
  locale: AppLocale;
  onClose(): void;
  onSettingsChange(settings: SettingsSnapshot): void;
}

const labels = {
  en: {
    title: "Settings",
    close: "Close",
    tabGeneral: "General",
    tabProviders: "Custom providers",
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
    tabProviders: "自定义 Provider",
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

export function SettingsPanel({
  initialTab = "general",
  locale,
  onClose,
  onSettingsChange,
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
  const [settings, setSettings] = useState<SettingsSnapshot>();
  const [selectedModel, setSelectedModel] = useState("");
  const [contextWindow, setContextWindow] = useState("");
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
  const [globalAgentsContent, setGlobalAgentsContent] = useState("");
  const [agentConcurrencyLimit, setAgentConcurrencyLimit] = useState("");
  const [importPreview, setImportPreview] =
    useState<ConfigurationImportPreview>();
  const [importSources, setImportSources] = useState<
    ConfigurationImportSource[]
  >([]);
  const [importCategories, setImportCategories] = useState<
    ConfigurationImportCategory[]
  >(["instructions", "skills", "mcp"]);

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
        const selectedModelAvailable =
          snapshot.selection &&
          snapshot.models.some(
            (model) =>
              model.providerId === snapshot.selection?.providerId &&
              model.modelId === snapshot.selection.modelId,
          );
        if (snapshot.selection && selectedModelAvailable) {
          const model = snapshot.models.find(
            (candidate) =>
              candidate.providerId === snapshot.selection?.providerId &&
              candidate.modelId === snapshot.selection.modelId,
          );
          setSelectedModel(
            modelKey(snapshot.selection.providerId, snapshot.selection.modelId),
          );
          setContextWindow(
            String(
              Math.min(
                snapshot.contextWindow,
                model?.contextWindow ?? snapshot.contextWindow,
              ),
            ),
          );
        } else if (snapshot.models[0]) {
          setSelectedModel(
            modelKey(snapshot.models[0].providerId, snapshot.models[0].modelId),
          );
          setContextWindow(
            String(
              Math.min(
                snapshot.contextWindow,
                snapshot.models[0].contextWindow,
              ),
            ),
          );
        } else {
          setContextWindow(String(snapshot.contextWindow));
        }
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

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

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
    if (!selectedModel || !contextWindowValid || !selectedModelCanBeAdded)
      return;
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
      onSettingsChange(updated);
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
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-backdrop" onMouseDown={onClose}>
      <section
        aria-label={t.title}
        aria-modal="true"
        className="settings-panel"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="settings-header">
          <strong>{t.title}</strong>
          <button className="text-button" onClick={onClose}>
            {t.close}
          </button>
        </header>
        {!settings ? (
          <div className="settings-loading">{message || t.loading}</div>
        ) : (
          <div className="settings-body">
            <nav aria-label={t.title} className="settings-tabs" role="tablist">
              {(
                [
                  ["general", t.tabGeneral],
                  ["providers", t.tabProviders],
                  ["agents", t.tabAgents],
                  ["capabilities", t.tabCapabilities],
                  ["maintenance", t.tabMaintenance],
                ] as const
              ).map(([tab, label]) => (
                <button
                  aria-controls={`settings-tab-${tab}`}
                  aria-selected={activeTab === tab}
                  className={activeTab === tab ? "active" : ""}
                  id={`settings-tab-${tab}-button`}
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  role="tab"
                  type="button"
                >
                  {label}
                </button>
              ))}
            </nav>
            <div
              aria-labelledby={`settings-tab-${activeTab}-button`}
              className="settings-content"
              id={`settings-tab-${activeTab}`}
              role="tabpanel"
            >
              {activeTab === "general" && (
                <>
                  <section className="settings-section">
                    <h3>{t.model}</h3>
                    <div className="settings-field">
                      <span>{t.model}</span>
                      <div className="settings-codex-select">
                        <CodexSelect
                          ariaLabel={t.model}
                          disabled={busy || models.length === 0}
                          onChange={selectModel}
                          noResultsLabel={t.modelSearchEmpty}
                          options={models.map((model) => ({
                            value: modelKey(model.providerId, model.modelId),
                            label: `${model.providerId} · ${model.name}`,
                            searchText: `${model.providerId} ${model.name} ${model.modelId}`,
                          }))}
                          searchPlaceholder={t.modelSearch}
                          value={selectedModel}
                        />
                      </div>
                    </div>
                    {models.length === 0 && (
                      <p className="settings-empty">{t.modelUnavailable}</p>
                    )}
                    <div className="settings-field">
                      <span>{t.contextWindow}</span>
                      <input
                        aria-label={t.contextWindow}
                        disabled={busy || !selectedModelInfo}
                        max={selectedModelInfo?.contextWindow}
                        min={1_024}
                        onChange={(event) =>
                          setContextWindow(event.target.value)
                        }
                        step={1_024}
                        type="number"
                        value={contextWindow}
                      />
                    </div>
                    {selectedModelInfo && (
                      <p className="settings-security">
                        {t.contextWindowHint.replace(
                          "{limit}",
                          selectedModelInfo.contextWindow.toLocaleString(
                            locale,
                          ),
                        )}
                      </p>
                    )}
                    {!selectedModelUsesCustomProvider && (
                      <>
                        <div className="settings-field">
                          <span>
                            {t.apiKey}
                            {selectedModelInfo?.providerId
                              ? ` · ${selectedModelInfo.providerId}`
                              : ""}
                          </span>
                          <input
                            aria-label={t.apiKey}
                            autoComplete="off"
                            disabled={
                              busy ||
                              !selectedModelInfo ||
                              !settings.encryptionAvailable
                            }
                            onChange={(event) =>
                              setKeyApiKey(event.target.value)
                            }
                            placeholder={
                              selectedModelCredential
                                ? t.storedApiKey
                                : t.apiKey
                            }
                            type="password"
                            value={keyApiKey}
                          />
                        </div>
                        <p className="settings-security">
                          {settings.encryptionAvailable
                            ? t.encrypted
                            : t.unavailable}
                        </p>
                      </>
                    )}
                    <button
                      className="settings-primary-action"
                      disabled={
                        busy ||
                        !selectedModel ||
                        !contextWindowValid ||
                        !selectedModelCanBeAdded
                      }
                      onClick={addModel}
                    >
                      {t.saveModel}
                    </button>
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
                          <div
                            className="added-model-row"
                            key={modelKey(model.providerId, model.modelId)}
                          >
                            <span>
                              <strong>
                                {catalogModel?.name ?? model.modelId}
                              </strong>
                              <small>
                                {model.providerId} · {model.modelId} ·{" "}
                                {model.contextWindow.toLocaleString(locale)}{" "}
                                token
                              </small>
                            </span>
                            <button
                              aria-label={`${t.removeModel}: ${catalogModel?.name ?? model.modelId}`}
                              className="text-button danger"
                              disabled={busy}
                              onClick={() => {
                                setMessage("");
                                setModelDeleteTarget(model);
                              }}
                              type="button"
                            >
                              {t.delete}
                            </button>
                          </div>
                        );
                      })}
                      {settings.addedModels.length === 0 && (
                        <span className="settings-empty">
                          {t.noAddedModels}
                        </span>
                      )}
                    </div>
                    <button
                      className="settings-secondary-action"
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
                    </button>
                  </section>

                  <section className="settings-section">
                    <h3>{t.language}</h3>
                    <div className="settings-field">
                      <span>{t.language}</span>
                      <div className="settings-codex-select">
                        <CodexSelect<AppLanguage>
                          ariaLabel={t.language}
                          disabled={busy}
                          onChange={(language) => void setLanguage(language)}
                          options={[
                            { value: "system", label: t.languageSystem },
                            ...SUPPORTED_LOCALES.map((language) => ({
                              value: language,
                              label: LOCALE_METADATA[language].nativeName,
                            })),
                          ]}
                          value={settings.language}
                        />
                      </div>
                    </div>
                    <p className="settings-security">{t.languageHint}</p>
                  </section>

                  <section className="settings-section">
                    <h3>{t.theme}</h3>
                    <div className="settings-field">
                      <span>{t.theme}</span>
                      <div className="settings-codex-select">
                        <CodexSelect<AppTheme>
                          ariaLabel={t.theme}
                          disabled={busy}
                          onChange={(theme) => void setTheme(theme)}
                          options={[
                            { value: "system", label: t.themeSystem },
                            { value: "light", label: t.themeLight },
                            { value: "dark", label: t.themeDark },
                          ]}
                          value={settings.theme}
                        />
                      </div>
                    </div>
                    <p className="settings-security">{t.themeHint}</p>
                  </section>
                </>
              )}

              {activeTab === "providers" && (
                <section className="settings-section">
                  <h3>{t.customProviders}</h3>
                  <p className="settings-security">{t.providerHint}</p>
                  <form
                    className="credential-form provider-form"
                    onSubmit={(event) => void saveProviderConnection(event)}
                  >
                    <input
                      aria-label={t.provider}
                      autoCapitalize="none"
                      autoCorrect="off"
                      disabled={busy || Boolean(editingProviderId)}
                      maxLength={80}
                      onChange={(event) =>
                        setProviderId(
                          event.target.value.toLocaleLowerCase("en-US"),
                        )
                      }
                      pattern="[a-z0-9][a-z0-9._-]*"
                      placeholder={t.provider}
                      spellCheck={false}
                      value={providerId}
                    />
                    <input
                      aria-label={t.providerName}
                      disabled={busy}
                      onChange={(event) => setProviderName(event.target.value)}
                      placeholder={t.providerName}
                      value={providerName}
                    />
                    <input
                      aria-label={t.baseUrl}
                      disabled={busy}
                      onChange={(event) => setBaseUrl(event.target.value)}
                      placeholder={t.baseUrl}
                      type="url"
                      value={baseUrl}
                    />
                    <div className="settings-codex-select">
                      <CodexSelect<NonNullable<ProviderConnection["api"]>>
                        ariaLabel={t.providerApi}
                        disabled={busy}
                        onChange={setProviderApi}
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
                    </div>
                    <input
                      aria-label={t.modelId}
                      disabled={busy}
                      onChange={(event) =>
                        setProviderModelId(event.target.value)
                      }
                      placeholder={t.modelId}
                      value={providerModelId}
                    />
                    <input
                      aria-label={t.modelName}
                      disabled={busy}
                      onChange={(event) =>
                        setProviderModelName(event.target.value)
                      }
                      placeholder={t.modelName}
                      value={providerModelName}
                    />
                    <label className="settings-field">
                      <span>{t.contextWindow}</span>
                      <input
                        aria-label={t.contextWindow}
                        disabled={busy}
                        max={10_000_000}
                        min={1_024}
                        onChange={(event) =>
                          setProviderContextWindow(event.target.value)
                        }
                        step={1}
                        type="number"
                        value={providerContextWindow}
                      />
                    </label>
                    <label className="settings-field">
                      <span>{t.maxTokens}</span>
                      <input
                        aria-label={t.maxTokens}
                        disabled={busy}
                        max={1_000_000}
                        min={1}
                        onChange={(event) =>
                          setProviderMaxTokens(event.target.value)
                        }
                        step={1}
                        type="number"
                        value={providerMaxTokens}
                      />
                    </label>
                    <input
                      aria-label={t.optionalApiKey}
                      autoComplete="off"
                      disabled={busy || !settings.encryptionAvailable}
                      onChange={(event) => setApiKey(event.target.value)}
                      placeholder={t.optionalApiKey}
                      type="password"
                      value={apiKey}
                    />
                    <span className="provider-capabilities">
                      <label className="settings-checkbox">
                        <input
                          checked={providerReasoning}
                          disabled={busy}
                          onChange={(event) =>
                            setProviderReasoning(event.target.checked)
                          }
                          type="checkbox"
                        />
                        <span>{t.reasoningModel}</span>
                      </label>
                      <label className="settings-checkbox">
                        <input
                          checked={providerImages}
                          disabled={busy}
                          onChange={(event) =>
                            setProviderImages(event.target.checked)
                          }
                          type="checkbox"
                        />
                        <span>{t.imageInput}</span>
                      </label>
                    </span>
                    <button
                      className="settings-primary-action"
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
                    >
                      {t.saveProvider}
                    </button>
                    {editingProviderId && (
                      <button
                        className="settings-secondary-action"
                        disabled={busy}
                        onClick={resetProviderForm}
                        type="button"
                      >
                        {t.cancelEdit}
                      </button>
                    )}
                  </form>
                  <strong className="settings-subheading">
                    {t.configuredProviders}
                  </strong>
                  <div className="credential-list">
                    {settings.providers.map((provider) => (
                      <div className="mcp-server-row" key={provider.id}>
                        <div>
                          <strong>{provider.name}</strong>
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
                        </div>
                        <span className="mcp-server-actions">
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() => editProviderConnection(provider)}
                            type="button"
                          >
                            {t.edit}
                          </button>
                          <button
                            className="text-button danger"
                            disabled={busy}
                            onClick={() =>
                              void deleteProviderConnection(provider)
                            }
                            type="button"
                          >
                            {t.delete}
                          </button>
                        </span>
                      </div>
                    ))}
                    {!settings.providers.length && (
                      <span className="settings-empty">{t.noProviders}</span>
                    )}
                  </div>
                </section>
              )}

              {activeTab === "agents" && (
                <>
                  <section className="settings-section">
                    <h3>{t.agentConcurrency}</h3>
                    <p className="settings-security">
                      {t.agentConcurrencyHint}
                    </p>
                    <div className="settings-field">
                      <span>{t.concurrencyMode}</span>
                      <div className="settings-codex-select">
                        <CodexSelect<"auto" | "manual">
                          ariaLabel={t.concurrencyMode}
                          disabled={busy}
                          onChange={(mode) =>
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
                      </div>
                    </div>
                    {settings.agentConcurrency.preference.mode === "manual" && (
                      <label className="settings-field">
                        <span>{t.concurrencyManualLimit}</span>
                        <input
                          aria-label={t.concurrencyManualLimit}
                          disabled={busy}
                          max={settings.agentConcurrency.hardLimit}
                          min={2}
                          onChange={(event) =>
                            setAgentConcurrencyLimit(event.target.value)
                          }
                          step={1}
                          type="number"
                          value={agentConcurrencyLimit}
                        />
                      </label>
                    )}
                    {settings.agentConcurrency.preference.mode === "manual" && (
                      <button
                        className="settings-primary-action"
                        disabled={
                          busy ||
                          !agentConcurrencyLimitValid ||
                          parsedAgentConcurrencyLimit ===
                            settings.agentConcurrency.configuredLimit
                        }
                        onClick={() => void applyAgentConcurrencyLimit()}
                      >
                        {t.concurrencyApply}
                      </button>
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
                    <p className="settings-security">
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
                    </p>
                    {settings.agentConcurrency.throttled && (
                      <p className="settings-security warning">
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
                      </p>
                    )}
                    {settings.agentConcurrency.preference.mode === "manual" &&
                      settings.agentConcurrency.configuredLimit >
                        settings.agentConcurrency.automaticSafeLimit && (
                        <p className="settings-security warning">
                          {t.concurrencyHighWarning}
                        </p>
                      )}
                  </section>
                  <section className="settings-section">
                    <h3>{t.globalAgents}</h3>
                    <p className="settings-security">{t.globalAgentsHint}</p>
                    <code className="settings-path">
                      {settings.globalAgents.path}
                    </code>
                    <textarea
                      aria-label={t.globalAgents}
                      className="settings-textarea"
                      disabled={busy}
                      onChange={(event) =>
                        setGlobalAgentsContent(event.target.value)
                      }
                      rows={10}
                      value={globalAgentsContent}
                    />
                    <button
                      className="settings-primary-action"
                      disabled={
                        busy ||
                        globalAgentsContent === settings.globalAgents.content
                      }
                      onClick={() => void saveGlobalAgents()}
                    >
                      {t.saveGlobalAgents}
                    </button>
                  </section>
                  <section className="settings-section">
                    <h3>{t.configurationImport}</h3>
                    <p className="settings-security">
                      {t.configurationImportHint}
                    </p>
                    <button
                      className="settings-secondary-action"
                      disabled={busy}
                      onClick={() => void scanConfigurationImports()}
                    >
                      {t.scanImports}
                    </button>
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
                            <label className="settings-checkbox" key={category}>
                              <input
                                checked={importCategories.includes(category)}
                                disabled={busy}
                                onChange={(event) =>
                                  toggleImportCategory(
                                    category,
                                    event.target.checked,
                                  )
                                }
                                type="checkbox"
                              />
                              <span>{label}</span>
                            </label>
                          ))}
                        </div>
                        {importPreview.sources.map((source) => (
                          <label
                            className={`configuration-import-source ${
                              source.detected ? "" : "unavailable"
                            }`}
                            key={source.source}
                          >
                            <input
                              checked={importSources.includes(source.source)}
                              disabled={busy || !source.detected}
                              onChange={(event) =>
                                toggleImportSource(
                                  source.source,
                                  event.target.checked,
                                )
                              }
                              type="checkbox"
                            />
                            <span>
                              <strong>
                                {source.source === "claude"
                                  ? "Claude Code"
                                  : source.source === "opencode"
                                    ? "OpenCode"
                                    : "Codex"}
                              </strong>
                              <small>
                                {source.detected ? t.detected : t.notDetected} ·{" "}
                                {t.importInstructions}{" "}
                                {source.counts.instructions} · {t.importSkills}{" "}
                                {source.counts.skills} · {t.importMcp}{" "}
                                {source.counts.mcp}
                              </small>
                              {source.paths.map((path) => (
                                <code key={path}>{path}</code>
                              ))}
                              {source.warnings.map((warning) => (
                                <small className="error" key={warning}>
                                  {warning}
                                </small>
                              ))}
                            </span>
                          </label>
                        ))}
                        <button
                          className="settings-primary-action"
                          disabled={
                            busy ||
                            importSources.length === 0 ||
                            importCategories.length === 0
                          }
                          onClick={() => void importConfiguration()}
                        >
                          {t.applyImports}
                        </button>
                      </div>
                    )}
                  </section>
                </>
              )}

              {activeTab === "capabilities" && (
                <section className="settings-section">
                  <h3>{t.capabilityAccess}</h3>
                  <label className="settings-checkbox">
                    <input
                      checked={settings.localFullAccess}
                      disabled={busy}
                      onChange={(event) =>
                        void run(async () => {
                          const updated =
                            await window.artemis.setLocalFullAccess(
                              event.target.checked,
                            );
                          setSettings(updated);
                          onSettingsChange(updated);
                        })
                      }
                      role="switch"
                      type="checkbox"
                    />
                    <span>{t.localFullAccess}</span>
                  </label>
                  <p className="settings-security">{t.localFullAccessDetail}</p>
                </section>
              )}

              {activeTab === "maintenance" && (
                <>
                  <section className="settings-section">
                    <h3>{t.diagnostics}</h3>
                    <p className="settings-security">{t.diagnosticsHint}</p>
                    <button
                      className="settings-secondary-action"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const path = await window.artemis.exportDiagnostics();
                          if (path)
                            setMessage(`${t.diagnosticsExported} ${path}`);
                        })
                      }
                    >
                      {t.exportDiagnostics}
                    </button>
                  </section>
                  <section className="settings-section">
                    <h3>{t.updates}</h3>
                    <p className="settings-security">
                      {settings.update.currentVersion} · {settings.update.state}
                      {settings.update.availableVersion
                        ? ` → ${settings.update.availableVersion}`
                        : ""}
                      {settings.update.progress === undefined
                        ? ""
                        : ` · ${Math.round(settings.update.progress)}%`}
                    </p>
                    {settings.update.rollbackAvailable && (
                      <p className="settings-security">{t.rollbackReady}</p>
                    )}
                    {settings.update.message && (
                      <span className="error">{settings.update.message}</span>
                    )}
                    <span>
                      <button
                        className="settings-secondary-action"
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
                      </button>
                      {settings.update.state === "downloaded" && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run(() => window.artemis.installUpdate())
                          }
                        >
                          {t.installUpdate}
                        </button>
                      )}
                    </span>
                  </section>
                </>
              )}
              {message && <div className="settings-message">{message}</div>}
            </div>
          </div>
        )}
      </section>
      {modelApplyResult && (
        <div
          className="model-apply-dialog-backdrop"
          onMouseDown={(event) => {
            event.stopPropagation();
            if (event.target === event.currentTarget) {
              setModelApplyResult(undefined);
            }
          }}
        >
          <section
            aria-label={
              modelApplyResult.kind === "success"
                ? t.modelSaved
                : t.modelSaveFailed
            }
            aria-modal="true"
            className="model-apply-dialog"
            data-kind={modelApplyResult.kind}
            role="dialog"
          >
            <span aria-hidden="true" className="model-apply-result-icon">
              {modelApplyResult.kind === "success" ? "✓" : "!"}
            </span>
            <strong>
              {modelApplyResult.kind === "success"
                ? t.modelSaved
                : t.modelSaveFailed}
            </strong>
            <p>{modelApplyResult.detail}</p>
            <button onClick={() => setModelApplyResult(undefined)}>
              {t.confirm}
            </button>
          </section>
        </div>
      )}
      {modelDeleteTarget && settings && (
        <div
          className="model-delete-dialog-backdrop"
          onMouseDown={(event) => {
            event.stopPropagation();
            if (!busy && event.target === event.currentTarget) {
              setModelDeleteTarget(undefined);
            }
          }}
        >
          <section
            aria-labelledby="model-delete-title"
            aria-modal="true"
            className="model-delete-dialog"
            role="alertdialog"
          >
            <strong id="model-delete-title">{t.removeModel}</strong>
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
                <p className="warning">
                  {t.removeModelCredentialConfirm.replace(
                    "{provider}",
                    modelDeleteTarget.providerId,
                  )}
                </p>
              )}
            {message && <span className="error">{message}</span>}
            <div className="model-delete-dialog-actions">
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => setModelDeleteTarget(undefined)}
                type="button"
              >
                {t.cancelEdit}
              </button>
              <button
                className="primary-button danger"
                disabled={busy}
                onClick={() => void removeModel()}
                type="button"
              >
                {t.delete}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

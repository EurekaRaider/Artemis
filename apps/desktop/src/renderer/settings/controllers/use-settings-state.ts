import {
  labels,
  type SettingsTab,
  modelFormState,
  DEFAULT_PROVIDER_CONTEXT_WINDOW,
  DEFAULT_PROVIDER_MAX_TOKENS,
  type ProviderThinkingLevel,
  modelKey,
} from "../settings-values.js";

import { UI_COPY } from "../../../shared/i18n/ui-copy.js";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import type { ProviderConnection } from "@artemis/protocol";

import type {
  AddedModelConfiguration,
  ConfigurationImportCategory,
  ConfigurationImportPreview,
  ConfigurationImportSource,
  SettingsSnapshot,
} from "../../../shared/api.js";

interface UseSettingsStateContext {
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
  readonly returnFocusRef: RefObject<HTMLElement | null> | undefined;
  readonly initialTab: SettingsTab;
  readonly initialSettings: SettingsSnapshot | undefined;
}
export function useSettingsState(context: UseSettingsStateContext) {
  const { locale, returnFocusRef, initialTab, initialSettings } = context;
  const t = labels[locale];
  const initialFocus = useRef<HTMLDivElement>(null);
  const pointerOpening = useRef(
    !returnFocusRef?.current?.matches(":focus-visible"),
  );
  const [importOpen, setImportOpen] = useState(false);
  const [narrowNavigation, setNarrowNavigation] = useState(
    () => window.matchMedia?.("(max-width: 720px)").matches ?? false,
  );
  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 720px)");
    if (!media) return;
    const update = () => setNarrowNavigation(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const [settingsSearch, setSettingsSearch] = useState("");
  const [addModelProviderId, setAddModelProviderId] = useState<string>();
  const [addModelMenuOpen, setAddModelMenuOpen] = useState(false);
  const addModelMenuId = useId();
  const addModelMenuAnchor = useRef<HTMLButtonElement>(null);
  const [selectedProviderId, setSelectedProviderId] = useState(
    () =>
      initialSettings?.selection?.providerId ??
      initialSettings?.models[0]?.providerId ??
      "",
  );
  const [showProviderForm, setShowProviderForm] = useState(false);
  const [settings, setSettings] = useState(initialSettings);
  const [selectedModel, setSelectedModel] = useState(
    () => modelFormState(initialSettings).selectedModel,
  );
  const [contextWindow, setContextWindow] = useState(
    () => modelFormState(initialSettings).contextWindow,
  );
  const [editingProviderId, setEditingProviderId] = useState<string>();
  const [editingProviderModelId, setEditingProviderModelId] =
    useState<string>();
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
  const [providerAdvanced, setProviderAdvanced] = useState("{}");
  const providerAdvancedDisclosure = useRef<HTMLDetailsElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [modelApplyResult, setModelApplyResult] = useState<{
    kind: "success" | "failure";
    title?: string;
    detail: string;
  }>();
  const [modelDeleteTarget, setModelDeleteTarget] =
    useState<AddedModelConfiguration>();
  const [editingModelKey, setEditingModelKey] = useState<string>();
  const [savedModelKey, setSavedModelKey] = useState<string>();
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
  const modelEditTriggerRef = useRef<HTMLButtonElement | null>(null);
  return {
    t,
    initialFocus,
    pointerOpening,
    importOpen,
    setImportOpen,
    narrowNavigation,
    activeTab,
    setActiveTab,
    settingsSearch,
    setSettingsSearch,
    addModelProviderId,
    setAddModelProviderId,
    addModelMenuOpen,
    setAddModelMenuOpen,
    addModelMenuId,
    addModelMenuAnchor,
    selectedProviderId,
    setSelectedProviderId,
    showProviderForm,
    setShowProviderForm,
    settings,
    setSettings,
    selectedModel,
    setSelectedModel,
    contextWindow,
    setContextWindow,
    editingProviderId,
    setEditingProviderId,
    editingProviderModelId,
    setEditingProviderModelId,
    providerId,
    setProviderId,
    providerName,
    setProviderName,
    baseUrl,
    setBaseUrl,
    providerApi,
    setProviderApi,
    providerModelId,
    setProviderModelId,
    providerModelName,
    setProviderModelName,
    providerContextWindow,
    setProviderContextWindow,
    providerMaxTokens,
    setProviderMaxTokens,
    providerReasoning,
    setProviderReasoning,
    providerHighestThinkingLevel,
    setProviderHighestThinkingLevel,
    providerImages,
    setProviderImages,
    providerAdvanced,
    setProviderAdvanced,
    providerAdvancedDisclosure,
    busy,
    setBusy,
    message,
    setMessage,
    modelApplyResult,
    setModelApplyResult,
    modelDeleteTarget,
    setModelDeleteTarget,
    editingModelKey,
    setEditingModelKey,
    savedModelKey,
    setSavedModelKey,
    providerDeleteTarget,
    setProviderDeleteTarget,
    globalAgentsContent,
    setGlobalAgentsContent,
    agentConcurrencyLimit,
    setAgentConcurrencyLimit,
    importPreview,
    setImportPreview,
    importSources,
    setImportSources,
    importCategories,
    setImportCategories,
    operationPendingRef,
    profileAvatarInputRef,
    modelEditTriggerRef,
  };
}

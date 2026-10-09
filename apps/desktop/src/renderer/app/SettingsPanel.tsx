import {
  Cube,
  User,
  ChatDots,
  CaretDown,
  CaretUp,
  Plus,
} from "@phosphor-icons/react";
import { ProviderWorkspace } from "../settings/ProviderWorkspace.js";
import "../settings/provider-settings.css";
import { modelAdvancedOptionsSchema } from "@artemis/protocol";
import { AppearanceSettingsSection } from "../appearance/AppearanceSettingsSection.js";
import { ComputerUseControls } from "../computer-use/ComputerUseControls.js";
import { HooksSettingsSection } from "../hooks/HooksSettingsSection.js";
import type { HookQuery } from "@artemis/protocol";
import { statusText } from "../../shared/i18n/status-text.js";
import { uiText } from "../../shared/i18n/ui-text.js";
import { UI_COPY } from "../../shared/i18n/ui-copy.js";
import { CustomAgentsSettingsSection } from "../settings/CustomAgentsSettingsSection.js";
import { AddedModelEditor } from "../settings/AddedModelEditor.js";
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
  type ReactNode,
} from "react";
import type {
  AppLocale,
  AppLanguage,
  AppTheme,
  ProviderConnection,
  ShellProfileMode,
  WindowsShellPreference,
} from "@artemis/protocol";
import { Button, IconButton } from "@artemis/ui/actions";
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
import { ArtemisIcon } from "@artemis/ui/icons";
import { userInitials } from "./user-profile.js";
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
} from "../../shared/api.js";
import {
  LOCALE_METADATA,
  SUPPORTED_LOCALES,
} from "../../shared/i18n/locales.js";
import { prepareProfileAvatar } from "./profile-avatar.js";

interface SettingsPanelProps {
  username?: string;
  initialSettings?: SettingsSnapshot | undefined;
  initialTab?: SettingsTab;
  hooksQuery?: HookQuery;
  locale: AppLocale;
  /** Project list for scoped custom sub-agent definitions (D#152). */
  projects?: ReadonlyArray<{ id: string; name: string }> | undefined;
  onClose(): void;
  returnFocusRef?: RefObject<HTMLElement | null> | undefined;
  onSettingsChange(
    settings: SettingsSnapshot,
    options?: { refreshThreads?: boolean },
  ): void;
}

const labels = UI_COPY.SettingsPanel_labels;
const ImSettingsPanel = lazy(() =>
  import("../im/ImSettingsPanel.js").then((module) => ({
    default: module.ImSettingsPanel,
  })),
);

const DEFAULT_PROVIDER_CONTEXT_WINDOW = 1_000_000;
const DEFAULT_PROVIDER_MAX_TOKENS = 128_000;
const providerIdPattern = /^[a-z0-9][a-z0-9._-]*$/u;
type ProviderThinkingLevel = NonNullable<
  ProviderConnection["models"][number]["highestThinkingLevel"]
>;

type SettingsTab =
  | "general"
  | "providers"
  | "agents"
  | "im"
  | "capabilities"
  | "maintenance"
  | "hooks";

function modelKey(providerId: string, modelId: string): string {
  return `${encodeURIComponent(providerId)}:${encodeURIComponent(modelId)}`;
}

function normalizedModelLabel(label: string): string {
  return label
    .normalize("NFKC")
    .replace(/[\p{Default_Ignorable_Code_Point}\p{Cc}]+/gu, "")
    .replace(/\p{White_Space}+/gu, " ")
    .trim()
    .toLowerCase();
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
  const saved = settings.addedModels.find(
    (model) =>
      model.providerId === selected?.providerId &&
      model.modelId === selected.modelId,
  );
  return {
    contextWindow: String(
      Math.min(
        saved?.contextWindow ??
          selected?.contextWindow ??
          settings.contextWindow,
        selected?.contextWindow ?? settings.contextWindow,
      ),
    ),
    selectedModel: selected
      ? modelKey(selected.providerId, selected.modelId)
      : "",
  };
}

function SettingsRow({
  label,
  description,
  children,
  className = "",
}: {
  label: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`settings-form-row ${className}`}>
      <div className="settings-row-copy">
        <div className="settings-row-label">{label}</div>
        {description && (
          <p className="settings-row-description">{description}</p>
        )}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

export function SettingsPanel({
  username = "Artemis",
  initialSettings,
  initialTab = "general",
  hooksQuery,
  locale,
  projects = [],
  onClose,
  onSettingsChange,
  returnFocusRef,
}: SettingsPanelProps) {
  const t = labels[locale];
  const [narrowNavigation, setNarrowNavigation] = useState(
    () => window.matchMedia?.("(max-width: 980px)").matches ?? false,
  );
  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 980px)");
    if (!media) return;
    const update = () => setNarrowNavigation(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const [addModelProviderId, setAddModelProviderId] = useState<string>();
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

  useEffect(() => {
    if (!editingModelKey) modelEditTriggerRef.current?.focus();
  }, [editingModelKey]);

  useEffect(() => {
    let mounted = true;
    void window.artemis
      .getSettings()
      .then((snapshot) => {
        if (!mounted) return;
        setSettings(snapshot);
        setSelectedProviderId(
          (current) =>
            current ||
            snapshot.selection?.providerId ||
            snapshot.models[0]?.providerId ||
            snapshot.providers[0]?.id ||
            "",
        );
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
  const modelOptions = useMemo(() => {
    let labels = models.map((model) => model.name);
    for (const includeId of [false, true]) {
      const counts = new Map<string, number>();
      for (const label of labels) {
        const key = normalizedModelLabel(label);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      labels = labels.map((label, index) => {
        const key = normalizedModelLabel(label);
        if (key && counts.get(key) === 1) return label;
        const model = models[index]!;
        return includeId
          ? `${model.name} · ${model.providerId} · ${model.modelId}`
          : `${model.name} · ${model.providerId}`;
      });
    }
    const usedLabels = new Set<string>();
    return models.map((model, index) => {
      const base = labels[index]!;
      let label = base;
      let suffix = 2;
      while (usedLabels.has(normalizedModelLabel(label))) {
        label = `${base} (${suffix++})`;
      }
      usedLabels.add(normalizedModelLabel(label));
      return {
        value: modelKey(model.providerId, model.modelId),
        label,
        searchText: `${model.providerId} ${model.name} ${model.modelId}`,
        title: `${model.name}
${model.providerId} · ${model.modelId}`,
      };
    });
  }, [models]);
  const selectedModelUsesCustomProvider = Boolean(
    selectedModelInfo &&
    settings?.providers.some(
      (provider) => provider.id === selectedModelInfo.providerId,
    ),
  );
  const selectedAddedModel = settings?.addedModels.find(
    (model) =>
      model.providerId === selectedModelInfo?.providerId &&
      model.modelId === selectedModelInfo.modelId,
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
      selectedModelCredential),
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
    setSelectedModel(value);
    const model = models.find(
      (candidate) =>
        candidate.providerId === providerId && candidate.modelId === modelId,
    );
    if (!model) return;
    const saved = settings?.addedModels.find(
      (candidate) =>
        candidate.providerId === providerId && candidate.modelId === modelId,
    );
    setContextWindow(
      String(
        Math.min(
          saved?.contextWindow ?? model.contextWindow,
          model.contextWindow,
        ),
      ),
    );
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
        undefined,
      );
      setSettings(updated);
      onSettingsChange(updated);
      setModelApplyResult({
        kind: "success",
        title: selectedAddedModel ? t.modelUpdated : t.modelSaved,
        detail: selectedAddedModel ? t.modelUpdatedDetail : t.modelSavedDetail,
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
      const modelState = modelFormState(updated);
      setSelectedModel(modelState.selectedModel);
      setContextWindow(modelState.contextWindow);
    });
  }

  async function saveModelEdit(
    model: AddedModelConfiguration,
    apiKey?: string,
  ) {
    if (operationPendingRef.current) return;
    operationPendingRef.current = true;
    setBusy(true);
    try {
      const updated = await window.artemis.addModel(model, apiKey);
      setSettings(updated);
      onSettingsChange(updated);
      const key = modelKey(model.providerId, model.modelId);
      if (selectedModel === key) setContextWindow(String(model.contextWindow));
      setSavedModelKey(key);
      setEditingModelKey(undefined);
    } finally {
      operationPendingRef.current = false;
      setBusy(false);
    }
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
      const avatar = file
        ? await prepareProfileAvatar(file, locale)
        : undefined;
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
    const existingProvider = settings?.providers.find(
      (provider) => provider.id === editingProviderId,
    );
    let advanced;
    try {
      advanced = modelAdvancedOptionsSchema.parse(JSON.parse(providerAdvanced));
    } catch (error) {
      await run(async () => {
        throw error;
      });
      return;
    }
    const editedModel: ProviderConnection["models"][number] = {
      ...advanced,
      id: providerModelId.trim(),
      name: providerModelName.trim() || providerModelId.trim(),
      reasoning: providerReasoning,
      ...(providerReasoning
        ? { highestThinkingLevel: providerHighestThinkingLevel }
        : {}),
      input: providerImages ? ["text", "image"] : ["text"],
      contextWindow: parsedProviderContextWindow,
      maxTokens: parsedProviderMaxTokens,
    };
    const provider: ProviderConnection = {
      ...existingProvider,
      id: trimmedProviderId,
      name: providerName.trim() || trimmedProviderId,
      baseUrl: baseUrl.trim(),
      api: providerApi,
      models: existingProvider
        ? editingProviderModelId
          ? existingProvider.models.map((model) =>
              model.id === editingProviderModelId ? editedModel : model,
            )
          : [...existingProvider.models, editedModel]
        : [editedModel],
    };
    await run(async () => {
      const updated = await window.artemis.saveProviderConnection(
        provider,
        undefined,
      );
      setSettings(updated);
      onSettingsChange(updated);
      const savedModel = updated.models.find(
        (model) =>
          model.providerId === provider.id && model.modelId === editedModel.id,
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
      setSelectedProviderId(provider.id);
    });
  }

  function resetProviderForm() {
    setShowProviderForm(false);
    setEditingProviderId(undefined);
    setEditingProviderModelId(undefined);
    setProviderAdvanced("{}");
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
  }

  function editProviderConnection(
    provider: ProviderConnection,
    modelId?: string,
  ) {
    const model =
      provider.models.find((candidate) => candidate.id === modelId) ??
      provider.models[0];
    setShowProviderForm(true);
    setEditingProviderId(provider.id);
    setEditingProviderModelId(model?.id);
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
    setProviderAdvanced(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(model ?? {}).filter(
            ([key]) => key in modelAdvancedOptionsSchema.shape,
          ),
        ),
        null,
        2,
      ),
    );
    setProviderImages(model?.input.includes("image") ?? false);
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
      const modelState = modelFormState(updated);
      setSelectedModel(modelState.selectedModel);
      setContextWindow(modelState.contextWindow);
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
    hooks: uiText(locale, "Hooks.title"),
    general: t.tabGeneral,
    providers: t.tabProviders,
    agents: t.tabAgents,
    im: uiText(locale, "ImSettingsPanel.message191"),
    capabilities: t.tabCapabilities,
    maintenance: t.tabMaintenance,
  };

  return (
    <>
      <Dialog
        className="settings-panel"
        data-tab={activeTab}
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
                <IconButton
                  icon={<ArtemisIcon name="close" />}
                  label={t.close}
                  onClick={onClose}
                  size="compact"
                  title={t.close}
                  variant="quiet"
                />
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
                orientation={narrowNavigation ? "horizontal" : "vertical"}
                options={[
                  {
                    id: "settings-tab-general-button",
                    icon: <ArtemisIcon name="gear" />,
                    label: t.tabGeneral,
                    panelId: "settings-tab-general",
                    value: "general",
                  },
                  {
                    id: "settings-tab-providers-button",
                    icon: <ArtemisIcon name="database" />,
                    label: t.tabProviders,
                    panelId: "settings-tab-providers",
                    value: "providers",
                  },
                  {
                    id: "settings-tab-agents-button",
                    icon: <User aria-hidden="true" />,
                    label: t.tabAgents,
                    panelId: "settings-tab-agents",
                    value: "agents",
                  },
                  {
                    id: "settings-tab-im-button",
                    icon: <ChatDots aria-hidden="true" />,
                    label: activeTabLabel.im,
                    panelId: "settings-tab-im",
                    value: "im",
                  },
                  {
                    id: "settings-tab-capabilities-button",
                    icon: <ArtemisIcon name="approval" />,
                    label: t.tabCapabilities,
                    panelId: "settings-tab-capabilities",
                    value: "capabilities",
                  },
                  {
                    id: "settings-tab-hooks-button",
                    icon: <ArtemisIcon name="connector" />,
                    label: uiText(locale, "Hooks.title"),
                    panelId: "settings-tab-hooks",
                    value: "hooks",
                  },
                  {
                    id: "settings-tab-maintenance-button",
                    icon: <ArtemisIcon name="refresh" />,
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
          {settings &&
            (
              [
                "general",
                "providers",
                "agents",
                "im",
                "capabilities",
                "maintenance",
                "hooks",
              ] as const
            )
              .filter((tab) => tab !== activeTab)
              .map((tab) => (
                <div
                  aria-labelledby={`settings-tab-${tab}-button`}
                  hidden
                  id={`settings-tab-${tab}`}
                  key={tab}
                  role="tabpanel"
                />
              ))}
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
              {activeTab === "hooks" && (
                <HooksSettingsSection
                  locale={locale}
                  projects={projects}
                  {...(hooksQuery ? { initialQuery: hooksQuery } : {})}
                />
              )}
              {activeTab === "providers" && (
                <>
                  <ProviderWorkspace
                    settings={settings}
                    locale={locale}
                    selectedProviderId={selectedProviderId}
                    disabled={busy}
                    creating={showProviderForm && !editingProviderId}
                    onBusy={setBusy}
                    onSelect={(id) => {
                      setAddModelProviderId(undefined);
                      resetProviderForm();
                      setEditingModelKey(undefined);
                      setMessage("");
                      setSelectedProviderId(id);
                      const model = models.find(
                        (item) => item.providerId === id,
                      );
                      if (model)
                        selectModel(modelKey(model.providerId, model.modelId));
                      else setSelectedModel("");
                    }}
                    onAdd={() => {
                      resetProviderForm();
                      setShowProviderForm(true);
                    }}
                    onChange={(updated) => {
                      setSettings(updated);
                      onSettingsChange(updated);
                    }}
                    onEditConnection={() => {
                      const provider = settings.providers.find(
                        (item) => item.id === selectedProviderId,
                      );
                      if (provider) editProviderConnection(provider);
                    }}
                    onDeleteConnection={() =>
                      setProviderDeleteTarget(
                        settings.providers.find(
                          (item) => item.id === selectedProviderId,
                        ),
                      )
                    }
                  >
                    {(!showProviderForm || editingProviderId) && (
                      <ManagementSection
                        className="settings-section provider-models"
                        title={t.addedModels}
                        actions={
                          <Button
                            variant="quiet"
                            disabled={busy}
                            aria-expanded={
                              addModelProviderId === selectedProviderId
                            }
                            onClick={() =>
                              setAddModelProviderId(
                                addModelProviderId === selectedProviderId
                                  ? undefined
                                  : selectedProviderId,
                              )
                            }
                            icon={<Plus aria-hidden="true" size={18} />}
                          >
                            {t.saveModel}
                          </Button>
                        }
                      >
                        {settings.providers.some(
                          (item) => item.id === selectedProviderId,
                        ) && (
                          <Button
                            variant="quiet"
                            disabled={busy}
                            onClick={() => {
                              const provider = settings.providers.find(
                                (item) => item.id === selectedProviderId,
                              )!;
                              resetProviderForm();
                              setShowProviderForm(true);
                              setEditingProviderId(provider.id);
                              setProviderId(provider.id);
                              setProviderName(provider.name);
                              setBaseUrl(provider.baseUrl);
                              setProviderApi(
                                provider.api ?? "openai-completions",
                              );
                            }}
                          >
                            {uiText(locale, "Providers.defineModel")}
                          </Button>
                        )}
                        {addModelProviderId === selectedProviderId && (
                          <div
                            className="provider-add-model"
                            key={selectedProviderId}
                          >
                            <SettingsRow
                              label={t.model}
                              description={uiText(
                                locale,
                                "SettingsPanel.inline2",
                              )}
                            >
                              <Select
                                size="compact"
                                label={t.model}
                                disabled={
                                  busy ||
                                  Boolean(editingModelKey) ||
                                  models.length === 0
                                }
                                onValueChange={selectModel}
                                noResultsLabel={t.modelSearchEmpty}
                                className="model-catalog-select"
                                options={modelOptions.filter(
                                  (option) =>
                                    parseModelKey(option.value)[0] ===
                                    selectedProviderId,
                                )}
                                searchPlaceholder={t.modelSearch}
                                value={selectedModel}
                              />
                            </SettingsRow>
                            {models.length === 0 && (
                              <EmptyState
                                className="settings-empty"
                                title={t.modelUnavailable}
                              />
                            )}
                            <SettingsRow
                              label={t.contextWindow}
                              description={
                                selectedModelInfo
                                  ? t.contextWindowHint.replace(
                                      "{limit}",
                                      selectedModelInfo.contextWindow.toLocaleString(
                                        locale,
                                      ),
                                    )
                                  : undefined
                              }
                            >
                              <TextField
                                className="settings-number-field"
                                labelVisibility="hidden"
                                size="compact"
                                disabled={
                                  busy ||
                                  Boolean(editingModelKey) ||
                                  !selectedModelInfo
                                }
                                label={t.contextWindow}
                                max={selectedModelInfo?.contextWindow}
                                min={1_024}
                                onValueChange={setContextWindow}
                                step={1_024}
                                type="number"
                                value={contextWindow}
                              />
                            </SettingsRow>
                            <div className="provider-form-actions">
                              <Button
                                disabled={
                                  busy ||
                                  Boolean(editingModelKey) ||
                                  !selectedModel ||
                                  !contextWindowValid ||
                                  !selectedModelCanBeAdded
                                }
                                onClick={addModel}
                                variant="primary"
                              >
                                {selectedAddedModel
                                  ? t.saveChanges
                                  : t.saveModel}
                              </Button>
                            </div>
                          </div>
                        )}
                        <div
                          aria-label={t.addedModels}
                          className="added-model-list"
                        >
                          {settings.addedModels
                            .filter(
                              (model) =>
                                model.providerId === selectedProviderId,
                            )
                            .map((model) => {
                              const key = modelKey(
                                model.providerId,
                                model.modelId,
                              );
                              const editing = editingModelKey === key;
                              const catalogModel = models.find(
                                (candidate) =>
                                  candidate.providerId === model.providerId &&
                                  candidate.modelId === model.modelId,
                              );
                              return (
                                <div
                                  className="added-model-item"
                                  data-editing={editing || undefined}
                                  key={key}
                                >
                                  <ManagementRow
                                    leading={
                                      <Cube
                                        aria-hidden="true"
                                        size={26}
                                        weight="regular"
                                      />
                                    }
                                    actions={
                                      <span className="mcp-server-actions">
                                        <IconButton
                                          disabled={
                                            busy ||
                                            Boolean(editingModelKey && !editing)
                                          }
                                          label={`${editing ? t.cancelEdit : t.edit}: ${catalogModel?.name ?? model.modelId}`}
                                          onClick={(event) => {
                                            if (editing) {
                                              setEditingModelKey(undefined);
                                              return;
                                            }
                                            setMessage("");
                                            setSavedModelKey(undefined);
                                            const provider =
                                              settings.providers.find(
                                                (item) =>
                                                  item.id === model.providerId,
                                              );
                                            if (provider) {
                                              editProviderConnection(
                                                provider,
                                                model.modelId,
                                              );
                                            } else {
                                              modelEditTriggerRef.current =
                                                event.currentTarget;
                                              setEditingModelKey(key);
                                            }
                                          }}
                                          variant="quiet"
                                          icon={
                                            editing ? (
                                              <CaretUp
                                                size={20}
                                                aria-hidden="true"
                                              />
                                            ) : (
                                              <CaretDown
                                                size={20}
                                                aria-hidden="true"
                                              />
                                            )
                                          }
                                        />
                                        <IconButton
                                          className="management-destructive-action"
                                          icon={<ArtemisIcon name="trash" />}
                                          title={t.delete}
                                          disabled={
                                            busy || Boolean(editingModelKey)
                                          }
                                          label={`${t.delete}: ${catalogModel?.name ?? model.modelId}`}
                                          onClick={() => {
                                            setMessage("");
                                            setModelDeleteTarget(model);
                                          }}
                                          variant="quiet"
                                        />
                                      </span>
                                    }
                                    className="added-model-row"
                                    description={`${model.providerId} · ${model.modelId} · ${new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(model.contextWindow)} token`}
                                    title={catalogModel?.name ?? model.modelId}
                                  />
                                  {editing && (
                                    <AddedModelEditor
                                      busy={busy}
                                      catalogModel={catalogModel}
                                      locale={locale}
                                      model={model}
                                      onCancel={() =>
                                        setEditingModelKey(undefined)
                                      }
                                      onSave={saveModelEdit}
                                      settings={settings}
                                    />
                                  )}
                                  {savedModelKey === key && (
                                    <InlineNotice
                                      className="added-model-feedback"
                                      tone="success"
                                    >
                                      {t.modelUpdated}
                                    </InlineNotice>
                                  )}
                                </div>
                              );
                            })}
                          {!settings.addedModels.some(
                            (model) => model.providerId === selectedProviderId,
                          ) && (
                            <EmptyState
                              className="settings-empty"
                              title={t.noAddedModels}
                            />
                          )}
                        </div>
                      </ManagementSection>
                    )}
                    {showProviderForm && (
                      <ManagementSection
                        className="settings-section"
                        description={t.providerHint}
                        title={t.customProviders}
                      >
                        <form
                          className="credential-form provider-form"
                          onSubmit={(event) =>
                            void saveProviderConnection(event)
                          }
                        >
                          <TextField
                            autoCapitalize="none"
                            autoCorrect="off"
                            disabled={busy || Boolean(editingProviderId)}
                            label={t.provider}
                            labelVisibility="visible"
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
                            labelVisibility="visible"
                            onValueChange={setProviderName}
                            placeholder={t.providerName}
                            value={providerName}
                          />
                          <TextField
                            disabled={busy}
                            label={t.baseUrl}
                            labelVisibility="visible"
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
                            labelVisibility="visible"
                            onValueChange={setProviderModelId}
                            placeholder={t.modelId}
                            value={providerModelId}
                          />
                          <TextField
                            disabled={busy}
                            label={t.modelName}
                            labelVisibility="visible"
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
                          <TextAreaField
                            label={uiText(locale, "Model.advanced")}
                            value={providerAdvanced}
                            onValueChange={setProviderAdvanced}
                            disabled={busy}
                            rows={5}
                          />
                          <Button
                            disabled={
                              busy ||
                              !providerIdValid ||
                              !baseUrl.trim() ||
                              !providerModelId.trim() ||
                              !providerContextWindowValid ||
                              !providerMaxTokensValid
                            }
                            type="submit"
                            variant="primary"
                          >
                            {t.saveProvider}
                          </Button>
                          <Button disabled={busy} onClick={resetProviderForm}>
                            {t.cancel}
                          </Button>
                        </form>
                      </ManagementSection>
                    )}
                  </ProviderWorkspace>
                </>
              )}

              {activeTab === "general" && (
                <>
                  <ManagementSection
                    className="settings-section"
                    title={t.profileAvatar}
                  >
                    <div className="settings-profile-avatar">
                      <div className="settings-profile-avatar-preview">
                        {settings.profileAvatar ? (
                          <img alt="" src={settings.profileAvatar} />
                        ) : (
                          <span aria-hidden="true">
                            {userInitials(username)}
                          </span>
                        )}
                      </div>
                      <div className="settings-profile-avatar-copy">
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
                            size="compact"
                            disabled={busy}
                            onClick={() =>
                              profileAvatarInputRef.current?.click()
                            }
                          >
                            {settings.profileAvatar
                              ? t.profileAvatarChange
                              : t.profileAvatarUpload}
                          </Button>
                          {settings.profileAvatar && (
                            <Button
                              size="compact"
                              disabled={busy}
                              onClick={() => void setProfileAvatar(undefined)}
                            >
                              {t.profileAvatarRemove}
                            </Button>
                          )}
                        </div>
                        <p className="settings-avatar-hint">
                          {t.profileAvatarHint}
                        </p>
                      </div>
                    </div>
                  </ManagementSection>

                  <SettingsRow
                    className="settings-preference-row"
                    label={t.language}
                    description={t.languageHint}
                  >
                    <Select<AppLanguage>
                      size="compact"
                      labelVisibility="hidden"
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
                  </SettingsRow>

                  <SettingsRow
                    className="settings-preference-row"
                    label={t.theme}
                    description={t.themeHint}
                  >
                    <Select<AppTheme>
                      size="compact"
                      labelVisibility="hidden"
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
                  </SettingsRow>
                  <AppearanceSettingsSection locale={locale} />
                  <SettingsRow
                    label={uiText(locale, "SettingsPanel.preventSleep")}
                    description={uiText(
                      locale,
                      "SettingsPanel.preventSleepHint",
                    )}
                  >
                    <Switch
                      checked={settings.preventSleep ?? true}
                      disabled={busy}
                      label={uiText(locale, "SettingsPanel.preventSleep")}
                      labelVisibility="hidden"
                      onCheckedChange={(checked) =>
                        void run(async () => {
                          const updated =
                            await window.artemis.setPreventSleep(checked);
                          setSettings(updated);
                          onSettingsChange(updated);
                        })
                      }
                    />
                  </SettingsRow>
                </>
              )}

              {activeTab === "agents" && (
                <>
                  <ManagementSection
                    className="settings-section"
                    title={t.agentConcurrency}
                  >
                    <SettingsRow
                      label={t.concurrencyMode}
                      description={t.agentConcurrencyHint}
                    >
                      <Select<"auto" | "manual">
                        size="compact"
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
                    </SettingsRow>
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
                    <dl className="agent-concurrency-hardware">
                      <div>
                        <dt>{t.concurrencyHardware}</dt>
                        <dd>
                          {t.concurrencyHardwareValue
                            .replace(
                              "{cores}",
                              String(settings.agentConcurrency.parallelism),
                            )
                            .replace(
                              "{memory}",
                              String(settings.agentConcurrency.totalMemoryGiB),
                            )}
                        </dd>
                      </div>
                    </dl>
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
                    title={t.globalAgents}
                  >
                    <p className="settings-hint">
                      {uiText(locale, "SettingsPanel.inline3")}{" "}
                      <code>{settings.globalAgents.path}</code>
                    </p>
                    <TextAreaField
                      description={t.globalAgentsHint}
                      disabled={busy}
                      label={t.globalAgents}
                      labelVisibility="hidden"
                      onValueChange={setGlobalAgentsContent}
                      rows={8}
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
                    actions={
                      <Button
                        disabled={busy}
                        onClick={() => void scanConfigurationImports()}
                      >
                        <ArtemisIcon name="refresh" />
                        {t.scanImports}
                      </Button>
                    }
                    className="settings-section configuration-import-section"
                    description={t.configurationImportHint}
                    title={t.configurationImport}
                  >
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
                        <div className="configuration-import-sources">
                          {importPreview.sources.map((source) => {
                            const sourceLabel =
                              source.source === "claude"
                                ? "Claude Code"
                                : source.source === "opencode"
                                  ? "OpenCode"
                                  : "Codex";
                            return (
                              <ManagementRow
                                leading={
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
                                description={
                                  <>
                                    <span>{`${source.detected ? t.detected : t.notDetected} · ${t.importInstructions} ${source.counts.instructions} · ${t.importSkills} ${source.counts.skills} · ${t.importMcp} ${source.counts.mcp}`}</span>
                                    {source.warnings.map((warning, index) => (
                                      <InlineNotice
                                        className="configuration-import-warning"
                                        key={`${source.source}-${index}`}
                                        tone="warning"
                                      >
                                        {warning}
                                      </InlineNotice>
                                    ))}
                                  </>
                                }
                                key={source.source}
                                state={source.detected ? "ready" : "disabled"}
                                title={sourceLabel}
                              />
                            );
                          })}
                        </div>
                        <Button
                          disabled={
                            busy ||
                            importSources.length === 0 ||
                            importCategories.length === 0
                          }
                          className="configuration-import-apply"
                          onClick={() => void importConfiguration()}
                          variant="primary"
                        >
                          <ArtemisIcon name="download" />
                          {t.applyImports}
                        </Button>
                      </div>
                    )}
                  </ManagementSection>
                  <CustomAgentsSettingsSection
                    applySettings={(updated) => {
                      setSettings(updated);
                      onSettingsChange(updated);
                    }}
                    busy={busy}
                    locale={locale}
                    projects={projects}
                    setBusy={setBusy}
                    settings={settings}
                  />
                </>
              )}

              {activeTab === "capabilities" && (
                <>
                  <ManagementSection
                    className="settings-section"
                    title="Computer Use"
                  >
                    <ComputerUseControls locale={locale} permissionsOnly />
                  </ManagementSection>
                  <ManagementSection
                    className="settings-section"
                    description={t.shellRuntimeHint}
                    title={t.shellRuntime}
                  >
                    {settings.platform === "win32" && (
                      <SettingsRow label={t.windowsShell}>
                        <Select<WindowsShellPreference>
                          size="compact"
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
                      </SettingsRow>
                    )}
                    <SettingsRow label={t.shellProfileMode}>
                      <Select<ShellProfileMode>
                        size="compact"
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
                    </SettingsRow>
                  </ManagementSection>

                  <ManagementSection
                    className="settings-section"
                    title={t.capabilityAccess}
                    tone="warning"
                  >
                    <SettingsRow
                      label={t.localFullAccess}
                      description={t.localFullAccessDetail}
                    >
                      <Switch
                        checked={settings.localFullAccess}
                        disabled={busy}
                        label={t.localFullAccess}
                        labelVisibility="hidden"
                        onCheckedChange={(checked) =>
                          void run(async () => {
                            const updated =
                              await window.artemis.setLocalFullAccess(checked);
                            setSettings(updated);
                            onSettingsChange(updated);
                          })
                        }
                      />
                    </SettingsRow>
                  </ManagementSection>
                </>
              )}

              {activeTab === "im" && (
                <Suspense
                  fallback={
                    <LoadingState
                      label={uiText(locale, "ImSettingsPanel.message31")}
                    />
                  }
                >
                  <ImSettingsPanel locale={locale} />
                </Suspense>
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
                    className="settings-section settings-updates"
                    title={t.updates}
                  >
                    <SettingsRow
                      label="Artemis"
                      description={
                        <>
                          {settings.update.currentVersion} ·{" "}
                          {settings.update.state === "idle" &&
                          settings.update.upToDate
                            ? uiText(locale, "Update.upToDate")
                            : statusText(locale, settings.update.state)}
                          {settings.update.availableVersion
                            ? ` → ${settings.update.availableVersion}`
                            : ""}
                          {settings.update.progress === undefined
                            ? ""
                            : ` · ${Math.round(settings.update.progress)}%`}
                        </>
                      }
                    >
                      <span className="settings-update-actions">
                        <Button
                          className="settings-check-update"
                          variant="secondary"
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
                          <ArtemisIcon name="refresh" />
                          {t.checkUpdates}
                        </Button>
                        {settings.update.availableVersion &&
                          ["available", "error"].includes(
                            settings.update.state,
                          ) && (
                            <Button
                              disabled={busy}
                              onClick={() =>
                                void run(async () => {
                                  if (settings.update.manualDownloadUrl) {
                                    window.open(
                                      settings.update.manualDownloadUrl,
                                      "_blank",
                                      "noopener,noreferrer",
                                    );
                                    return;
                                  }
                                  const update =
                                    await window.artemis.downloadUpdate();
                                  setSettings((current) =>
                                    current ? { ...current, update } : current,
                                  );
                                })
                              }
                            >
                              {uiText(
                                locale,
                                settings.update.manualUpdate
                                  ? "Update.manualDownload"
                                  : "Update.download",
                              )}
                            </Button>
                          )}
                        {settings.update.state === "downloaded" && (
                          <Button
                            disabled={busy}
                            onClick={() =>
                              void run(() => window.artemis.installUpdate())
                            }
                          >
                            {uiText(locale, "Update.install")}
                          </Button>
                        )}
                      </span>
                    </SettingsRow>
                    {settings.update.manualUpdate && (
                      <InlineNotice tone="neutral">
                        {uiText(locale, "Update.manualInstructions")}
                      </InlineNotice>
                    )}
                    {settings.update.state === "downloading" && (
                      <div className="sidebar-update-progress">
                        <progress
                          aria-label={statusText(locale, "downloading")}
                          max={100}
                          value={settings.update.progress ?? 0}
                        />
                      </div>
                    )}
                    {settings.update.state === "downloaded" && (
                      <InlineNotice tone="success">
                        {uiText(locale, "Update.downloaded")}
                      </InlineNotice>
                    )}
                    {settings.update.completedVersion && (
                      <InlineNotice tone="success">
                        {uiText(locale, "Update.completed", {
                          version: settings.update.completedVersion,
                        })}
                      </InlineNotice>
                    )}
                    {settings.update.rollbackAvailable && (
                      <InlineNotice
                        className="settings-security"
                        tone="success"
                      >
                        {t.rollbackReady}
                      </InlineNotice>
                    )}
                    {settings.update.message && (
                      <InlineNotice
                        tone={
                          settings.update.state === "error"
                            ? "danger"
                            : "neutral"
                        }
                      >
                        {settings.update.message}
                      </InlineNotice>
                    )}
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
              ? (modelApplyResult.title ?? t.modelSaved)
              : t.modelSaveFailed
          }
          onOpenChange={(open) => {
            if (!open) setModelApplyResult(undefined);
          }}
          open
          title={
            modelApplyResult.kind === "success"
              ? (modelApplyResult.title ?? t.modelSaved)
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
                {t.cancel}
              </Button>
              <Button
                loading={busy}
                onClick={() => void removeModel()}
                variant="danger"
              >
                {t.confirmDelete}
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
                {t.cancel}
              </Button>
              <Button
                loading={busy}
                onClick={() =>
                  void deleteProviderConnection(providerDeleteTarget)
                }
                variant="danger"
              >
                {t.confirmDelete}
              </Button>
            </>
          }
          className="model-delete-dialog"
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

import {
  type SettingsTab,
  type ProviderThinkingLevel,
  modelKey,
  parseModelKey,
  normalizedModelLabel,
} from "../settings/settings-values.js";
import { useSettingsState } from "../settings/controllers/use-settings-state.js";
import { useSettingsSubscriptions } from "../settings/controllers/use-settings-subscriptions.js";
import { useModelForm } from "../settings/controllers/use-model-form.js";
import { useModelActions } from "../settings/controllers/use-model-actions.js";
import { useGeneralSettingsActions } from "../settings/controllers/use-general-settings-actions.js";
import { useProviderActions } from "../settings/controllers/use-provider-actions.js";
import { useConfigurationImportActions } from "../settings/controllers/use-configuration-import-actions.js";
import { ThinkingLevelControl } from "../settings/ThinkingLevelControl.js";
import {
  selectionForModelSwitch,
  thinkingLevelLabel,
  thinkingLevelsForModel,
} from "../settings/model-selection.js";
import { ProviderWorkspace } from "../settings/ProviderWorkspace.js";
import "../settings/provider-settings.css";

import { AppearanceSettingsSection } from "../appearance/AppearanceSettingsSection.js";
import { ComputerUseControls } from "../computer-use/ComputerUseControls.js";
import { HooksSettingsSection } from "../hooks/HooksSettingsSection.js";
import type { HookQuery } from "@artemis/protocol";
import { statusText } from "../../shared/i18n/status-text.js";
import { uiText } from "../../shared/i18n/ui-text.js";
import { UI_COPY } from "../../shared/i18n/ui-copy.js";
import { CustomAgentsSettingsSection } from "../settings/CustomAgentsSettingsSection.js";
import { AddedModelEditor } from "../settings/AddedModelEditor.js";
import { ProfileNameField } from "../settings/ProfileNameField.js";
import {
  lazy,
  Suspense,
  type FormEvent,
  type RefObject,
  type ReactNode,
} from "react";
import type {
  AppLocale,
  ModelSelection,
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
  Popover,
} from "@artemis/ui/feedback";
import {
  Checkbox,
  SearchField,
  Select,
  Switch,
  TextAreaField,
  TextField,
} from "@artemis/ui/forms";
import { ArtemisIcon, ArtemisLogo } from "@artemis/ui/icons";
import { userInitials } from "./user-profile.js";
import { PanelHeader } from "@artemis/ui/layout";
import {
  ManagementRow,
  ManagementSection,
  SettingsSurface,
} from "@artemis/ui/management";
import { SegmentedControl, Tabs } from "@artemis/ui/navigation";
import type { MaterialPreference } from "../../shared/window-material.js";

import type {
  AddedModelConfiguration,
  ConfigurationImportCategory,
  ConfigurationImportSource,
  SettingsSnapshot,
} from "../../shared/api.js";
import {
  LOCALE_METADATA,
  SUPPORTED_LOCALES,
} from "../../shared/i18n/locales.js";

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

const ImSettingsPanel = lazy(() =>
  import("../im/ImSettingsPanel.js").then((module) => ({
    default: module.ImSettingsPanel,
  })),
);

const providerTokenFormat = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

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
  const useSettingsStateRuntime = useSettingsState({
    locale,
    returnFocusRef,
    initialTab,
    initialSettings,
  });
  const {
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
  } = useSettingsStateRuntime;

  const useSettingsSubscriptionsRuntime = useSettingsSubscriptions({
    modelEditTriggerRef,
    editingModelKey,
    setMessage,
    setSettings,
    setSelectedProviderId,
    setGlobalAgentsContent,
    setAgentConcurrencyLimit,
    setSelectedModel,
    setContextWindow,
  });

  const useModelFormRuntime = useModelForm({
    settings,
    selectedModel,
    contextWindow,
    providerContextWindow,
    providerId,
    providerMaxTokens,
    baseUrl,
    providerModelId,
    agentConcurrencyLimit,
  });
  const {
    models,
    selectedModelInfo,
    modelOptions,
    selectedAddedModel,
    selectedModelCanBeAdded,
    parsedContextWindow,
    contextWindowValid,
    parsedProviderContextWindow,
    trimmedProviderId,
    parsedProviderMaxTokens,
    providerFormValid,
    parsedAgentConcurrencyLimit,
    agentConcurrencyLimitValid,
  } = useModelFormRuntime;

  const useModelActionsRuntime = useModelActions({
    setSelectedModel,
    models,
    settings,
    setContextWindow,
    operationPendingRef,
    selectedModel,
    contextWindowValid,
    selectedModelCanBeAdded,
    setBusy,
    setModelApplyResult,
    parsedContextWindow,
    setSettings,
    onSettingsChange,
    t,
    selectedAddedModel,
    modelDeleteTarget,
    setModelDeleteTarget,
    get run() {
      return run;
    },
    setSavedModelKey,
    setEditingModelKey,
  });
  function selectModel(
    value: string,
  ): ReturnType<typeof useModelActionsRuntime.selectModel> {
    return useModelActionsRuntime.selectModel(value);
  }
  function addModel(): ReturnType<typeof useModelActionsRuntime.addModel> {
    return useModelActionsRuntime.addModel();
  }
  function removeModel(): ReturnType<
    typeof useModelActionsRuntime.removeModel
  > {
    return useModelActionsRuntime.removeModel();
  }
  function saveModelEdit(
    model: AddedModelConfiguration,
    apiKey?: string,
  ): ReturnType<typeof useModelActionsRuntime.saveModelEdit> {
    return useModelActionsRuntime.saveModelEdit(model, apiKey);
  }

  const useGeneralSettingsActionsRuntime = useGeneralSettingsActions({
    setSettings,
    onSettingsChange,
    get run() {
      return run;
    },
    locale,
    settings,
    parsedAgentConcurrencyLimit,
    agentConcurrencyLimitValid,
    setAgentConcurrencyLimit,
  });
  function setLanguage(
    language: AppLanguage,
  ): ReturnType<typeof useGeneralSettingsActionsRuntime.setLanguage> {
    return useGeneralSettingsActionsRuntime.setLanguage(language);
  }
  function setMaterial(
    material: MaterialPreference,
  ): ReturnType<typeof useGeneralSettingsActionsRuntime.setMaterial> {
    return useGeneralSettingsActionsRuntime.setMaterial(material);
  }
  function setTheme(
    theme: AppTheme,
  ): ReturnType<typeof useGeneralSettingsActionsRuntime.setTheme> {
    return useGeneralSettingsActionsRuntime.setTheme(theme);
  }
  function setProfileAvatar(
    file: File | undefined,
  ): ReturnType<typeof useGeneralSettingsActionsRuntime.setProfileAvatar> {
    return useGeneralSettingsActionsRuntime.setProfileAvatar(file);
  }
  function setProfileName(
    name: string | undefined,
  ): ReturnType<typeof useGeneralSettingsActionsRuntime.setProfileName> {
    return useGeneralSettingsActionsRuntime.setProfileName(name);
  }
  function setShellRuntimeConfiguration(
    change:
      | { windowsPreference: WindowsShellPreference }
      | { profileMode: ShellProfileMode },
  ): ReturnType<
    typeof useGeneralSettingsActionsRuntime.setShellRuntimeConfiguration
  > {
    return useGeneralSettingsActionsRuntime.setShellRuntimeConfiguration(
      change,
    );
  }
  function setAgentConcurrencyMode(
    mode: "auto" | "manual",
  ): ReturnType<
    typeof useGeneralSettingsActionsRuntime.setAgentConcurrencyMode
  > {
    return useGeneralSettingsActionsRuntime.setAgentConcurrencyMode(mode);
  }
  function applyAgentConcurrencyLimit(): ReturnType<
    typeof useGeneralSettingsActionsRuntime.applyAgentConcurrencyLimit
  > {
    return useGeneralSettingsActionsRuntime.applyAgentConcurrencyLimit();
  }

  const useProviderActionsRuntime = useProviderActions({
    editingProviderId,
    settings,
    providerAdvanced,
    providerAdvancedDisclosure,
    get run() {
      return run;
    },
    providerModelId,
    providerModelName,
    providerReasoning,
    providerHighestThinkingLevel,
    providerImages,
    parsedProviderContextWindow,
    parsedProviderMaxTokens,
    trimmedProviderId,
    providerName,
    baseUrl,
    providerApi,
    editingProviderModelId,
    setSettings,
    onSettingsChange,
    setSelectedModel,
    setContextWindow,
    setSelectedProviderId,
    setShowProviderForm,
    setEditingProviderId,
    setEditingProviderModelId,
    setProviderAdvanced,
    setProviderId,
    setProviderName,
    setBaseUrl,
    setProviderApi,
    setProviderModelId,
    setProviderModelName,
    setProviderContextWindow,
    setProviderMaxTokens,
    setProviderReasoning,
    setProviderHighestThinkingLevel,
    setProviderImages,
    setProviderDeleteTarget,
  });
  function saveProviderConnection(
    event: FormEvent<HTMLFormElement>,
  ): ReturnType<typeof useProviderActionsRuntime.saveProviderConnection> {
    return useProviderActionsRuntime.saveProviderConnection(event);
  }
  function resetProviderForm(): ReturnType<
    typeof useProviderActionsRuntime.resetProviderForm
  > {
    return useProviderActionsRuntime.resetProviderForm();
  }
  function editProviderConnection(
    provider: ProviderConnection,
    modelId?: string,
  ): ReturnType<typeof useProviderActionsRuntime.editProviderConnection> {
    return useProviderActionsRuntime.editProviderConnection(provider, modelId);
  }
  function deleteProviderConnection(
    provider: ProviderConnection,
  ): ReturnType<typeof useProviderActionsRuntime.deleteProviderConnection> {
    return useProviderActionsRuntime.deleteProviderConnection(provider);
  }

  const useConfigurationImportActionsRuntime = useConfigurationImportActions({
    globalAgentsContent,
    setSettings,
    setGlobalAgentsContent,
    onSettingsChange,
    setImportPreview,
    setImportSources,
    importSources,
    importCategories,
    t,
    setMessage,
    setImportCategories,
    operationPendingRef,
    setBusy,
  });
  function saveGlobalAgents(): ReturnType<
    typeof useConfigurationImportActionsRuntime.saveGlobalAgents
  > {
    return useConfigurationImportActionsRuntime.saveGlobalAgents();
  }
  function scanConfigurationImports(): ReturnType<
    typeof useConfigurationImportActionsRuntime.scanConfigurationImports
  > {
    return useConfigurationImportActionsRuntime.scanConfigurationImports();
  }
  function importConfiguration(): ReturnType<
    typeof useConfigurationImportActionsRuntime.importConfiguration
  > {
    return useConfigurationImportActionsRuntime.importConfiguration();
  }
  function toggleImportSource(
    source: ConfigurationImportSource,
    selected: boolean,
  ): ReturnType<
    typeof useConfigurationImportActionsRuntime.toggleImportSource
  > {
    return useConfigurationImportActionsRuntime.toggleImportSource(
      source,
      selected,
    );
  }
  function toggleImportCategory(
    category: ConfigurationImportCategory,
    selected: boolean,
  ): ReturnType<
    typeof useConfigurationImportActionsRuntime.toggleImportCategory
  > {
    return useConfigurationImportActionsRuntime.toggleImportCategory(
      category,
      selected,
    );
  }
  function run(
    action: () => Promise<void>,
  ): ReturnType<typeof useConfigurationImportActionsRuntime.run> {
    return useConfigurationImportActionsRuntime.run(action);
  }

  const defaultModels = models.filter(
    (model) =>
      model.configured &&
      (settings?.addedModels.some(
        (added) =>
          added.providerId === model.providerId &&
          added.modelId === model.modelId,
      ) ||
        settings?.providers.some(
          (provider) => provider.id === model.providerId,
        ) ||
        (settings?.selection?.providerId === model.providerId &&
          settings.selection.modelId === model.modelId)),
  );
  const defaultModel = defaultModels.find(
    (model) =>
      model.providerId === settings?.selection?.providerId &&
      model.modelId === settings?.selection?.modelId,
  );
  const defaultThinkingLevels = thinkingLevelsForModel(defaultModel);
  async function saveDefaultModel(selection: ModelSelection) {
    setBusy(true);
    setMessage("");
    try {
      const updated = await window.artemis.setModelSelection(selection);
      setSettings(updated);
      onSettingsChange(updated);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
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
        initialFocusRef={pointerOpening.current ? initialFocus : undefined}
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
              headingLevel={3}
              title={`${t.title} / ${activeTabLabel[activeTab]}`}
            />
          }
          label={`${t.title} · ${activeTabLabel[activeTab]}`}
          navigation={
            settings ? (
              <div
                className="settings-navigation-content"
                ref={initialFocus}
                tabIndex={-1}
              >
                <h2 className="settings-navigation-title">{t.title}</h2>
                <SearchField
                  className="settings-search"
                  label={uiText(locale, "SettingsPanel.search")}
                  placeholder={uiText(locale, "SettingsPanel.search")}
                  value={settingsSearch}
                  onValueChange={setSettingsSearch}
                  size="compact"
                />
                <Tabs<SettingsTab>
                  className="settings-tabs"
                  label={t.title}
                  onValueChange={setActiveTab}
                  orientation={narrowNavigation ? "horizontal" : "vertical"}
                  options={(
                    [
                      {
                        id: "settings-tab-general-button",
                        icon: <ArtemisIcon name="gear" />,
                        label: t.tabGeneral,
                        panelId: "settings-tab-general",
                        value: "general",
                      },
                      {
                        id: "settings-tab-providers-button",
                        icon: <ArtemisIcon name="model" />,
                        label: t.tabProviders,
                        panelId: "settings-tab-providers",
                        value: "providers",
                      },
                      {
                        id: "settings-tab-agents-button",
                        icon: <ArtemisIcon name="agent-configuration" />,
                        label: t.tabAgents,
                        panelId: "settings-tab-agents",
                        value: "agents",
                      },
                      {
                        id: "settings-tab-im-button",
                        icon: <ArtemisIcon name="message" />,
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
                        icon: <ArtemisIcon name="hooks" />,
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
                    ] as const
                  ).filter(
                    (option) =>
                      option.value === activeTab ||
                      !settingsSearch.trim() ||
                      option.label
                        .toLocaleLowerCase(locale)
                        .includes(
                          settingsSearch.trim().toLocaleLowerCase(locale),
                        ),
                  )}
                  value={activeTab}
                />
                <Button
                  className="settings-import-shortcut"
                  variant="quiet"
                  icon={<ArtemisIcon name="download" />}
                  onClick={() => {
                    setSettingsSearch("");
                    setActiveTab("agents");
                    setImportOpen(true);
                    void scanConfigurationImports();
                    window.requestAnimationFrame(() =>
                      document
                        .querySelector(".configuration-import-section")
                        ?.scrollIntoView?.({ block: "start" }),
                    );
                  }}
                >
                  {uiText(locale, "Review02.importConfiguration")}
                </Button>
              </div>
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
                          <>
                            <button
                              ref={addModelMenuAnchor}
                              className="provider-add-model-trigger"
                              type="button"
                              disabled={busy}
                              aria-haspopup="menu"
                              aria-controls={addModelMenuId}
                              aria-expanded={addModelMenuOpen}
                              onClick={() =>
                                setAddModelMenuOpen(!addModelMenuOpen)
                              }
                            >
                              <ArtemisIcon name="plus" width={14} height={14} />
                              {t.saveModel}
                            </button>
                            <Popover
                              anchorRef={addModelMenuAnchor}
                              portalContainer={addModelMenuAnchor.current?.closest(
                                "dialog",
                              )}
                              open={addModelMenuOpen}
                              onOpenChange={setAddModelMenuOpen}
                              role="menu"
                              id={addModelMenuId}
                              label={t.saveModel}
                              className="provider-add-model-menu"
                            >
                              <button
                                role="menuitem"
                                type="button"
                                onClick={() => {
                                  addModelMenuAnchor.current?.focus({
                                    preventScroll: true,
                                  });
                                  setAddModelMenuOpen(false);
                                  setAddModelProviderId(selectedProviderId);
                                }}
                              >
                                {uiText(locale, "Review02.catalogModel")}
                              </button>
                              {settings.providers.some(
                                (item) => item.id === selectedProviderId,
                              ) && (
                                <button
                                  role="menuitem"
                                  type="button"
                                  onClick={() => {
                                    const provider = settings.providers.find(
                                      (item) => item.id === selectedProviderId,
                                    )!;
                                    addModelMenuAnchor.current?.focus({
                                      preventScroll: true,
                                    });
                                    setAddModelMenuOpen(false);
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
                                </button>
                              )}
                            </Popover>
                          </>
                        }
                      >
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
                          {settings.addedModels.some(
                            (model) => model.providerId === selectedProviderId,
                          ) && (
                            <div
                              className="added-model-table-header"
                              aria-hidden="true"
                            >
                              <span>
                                {UI_COPY.AutomationPage_text[locale].name}
                              </span>
                              <span>
                                {uiText(locale, "Review03.modelContext")}
                              </span>
                              <span>
                                {uiText(locale, "Review03.modelDefault")}
                              </span>
                            </div>
                          )}
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
                                    leading={<ArtemisIcon name="model" />}
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
                                              <ArtemisIcon
                                                name="chevron"
                                                style={{
                                                  transform: "rotate(180deg)",
                                                }}
                                              />
                                            ) : (
                                              <ArtemisIcon name="chevron" />
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
                                    description={
                                      <>
                                        <span
                                          className="added-model-context"
                                          title={`${t.contextWindow}: ${model.contextWindow.toLocaleString(locale)} token`}
                                        >
                                          {new Intl.NumberFormat("en", {
                                            notation: "compact",
                                            maximumFractionDigits: 1,
                                          }).format(model.contextWindow)}
                                        </span>
                                        <span className="added-model-default">
                                          {defaultModel?.providerId ===
                                            model.providerId &&
                                            defaultModel.modelId ===
                                              model.modelId && (
                                              <span
                                                role="img"
                                                aria-label={`${uiText(locale, "SettingsPanel.defaultModel")}: ${catalogModel?.name ?? model.modelId}`}
                                              >
                                                <ArtemisIcon name="check" />
                                              </span>
                                            )}
                                        </span>
                                      </>
                                    }
                                    title={
                                      <span
                                        title={`${model.providerId} · ${model.modelId}`}
                                      >
                                        {catalogModel?.name ?? model.modelId}
                                      </span>
                                    }
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
                            <p className="settings-empty-inline">
                              {t.noAddedModels}
                            </p>
                          )}
                        </div>
                      </ManagementSection>
                    )}
                    {!showProviderForm && (
                      <ManagementSection
                        className="settings-section provider-defaults"
                        title={uiText(locale, "SettingsPanel.newTaskDefaults")}
                      >
                        <Select
                          label={uiText(locale, "SettingsPanel.defaultModel")}
                          disabled={busy || defaultModels.length === 0}
                          size="compact"
                          value={
                            defaultModel
                              ? modelKey(
                                  defaultModel.providerId,
                                  defaultModel.modelId,
                                )
                              : ""
                          }
                          options={
                            defaultModels.length
                              ? defaultModels.map((model) => ({
                                  value: modelKey(
                                    model.providerId,
                                    model.modelId,
                                  ),
                                  label: defaultModels.some(
                                    (other) =>
                                      other !== model &&
                                      normalizedModelLabel(other.name) ===
                                        normalizedModelLabel(model.name),
                                  )
                                    ? `${model.name} · ${model.providerId}/${model.modelId}`
                                    : model.name,
                                }))
                              : [{ value: "", label: t.noAddedModels }]
                          }
                          onValueChange={(key) => {
                            const model = defaultModels.find(
                              (item) =>
                                modelKey(item.providerId, item.modelId) === key,
                            );
                            if (model)
                              void saveDefaultModel(
                                selectionForModelSwitch(
                                  model,
                                  settings.selection,
                                ),
                              );
                          }}
                        />
                        {defaultThinkingLevels.length > 0 &&
                          settings.selection && (
                            <ThinkingLevelControl
                              model={defaultModel}
                              selection={settings.selection}
                              locale={locale}
                              disabled={busy}
                              onChange={(thinkingLevel, ultraMode) => {
                                if (settings.selection)
                                  void saveDefaultModel({
                                    ...settings.selection,
                                    thinkingLevel,
                                    ultraMode,
                                  });
                              }}
                            />
                          )}
                        <p className="settings-hint provider-defaults-note">
                          {uiText(locale, "Review02.existingTaskDefaults")}
                        </p>
                      </ManagementSection>
                    )}
                    {showProviderForm && (
                      <ManagementSection
                        className="settings-section custom-provider-section"
                        description={uiText(locale, "ProviderForm.description")}
                        title={uiText(
                          locale,
                          editingProviderId
                            ? "ProviderForm.editTitle"
                            : "ProviderForm.addTitle",
                        )}
                      >
                        <form
                          className="provider-form"
                          onSubmit={(event) =>
                            void saveProviderConnection(event)
                          }
                        >
                          <div className="provider-form-body">
                            <fieldset className="provider-form-section">
                              <legend>
                                {uiText(locale, "ProviderForm.connection")}
                              </legend>
                              <TextField
                                disabled={busy}
                                label={uiText(locale, "ProviderForm.name")}
                                onValueChange={setProviderName}
                                placeholder={uiText(
                                  locale,
                                  "ResourceCenter_labels.optional",
                                )}
                                value={providerName}
                              />
                              <TextField
                                autoCapitalize="none"
                                autoCorrect="off"
                                disabled={busy || Boolean(editingProviderId)}
                                label={t.provider}
                                labelVisibility="visible"
                                description={uiText(
                                  locale,
                                  "ProviderForm.idHint",
                                )}
                                maxLength={80}
                                onValueChange={(value) =>
                                  setProviderId(
                                    value.toLocaleLowerCase("en-US"),
                                  )
                                }
                                pattern="[a-z0-9][a-z0-9._-]*"
                                placeholder={t.provider}
                                spellCheck={false}
                                value={providerId}
                              />
                              <TextField
                                disabled={busy}
                                label="Base URL"
                                labelVisibility="visible"
                                onValueChange={setBaseUrl}
                                placeholder="http://127.0.0.1:11434/v1"
                                type="url"
                                value={baseUrl}
                              />
                              <Select<NonNullable<ProviderConnection["api"]>>
                                label={t.providerApi}
                                labelVisibility="visible"
                                description={uiText(
                                  locale,
                                  "ProviderForm.apiHint",
                                  {
                                    path:
                                      providerApi === "openai-responses"
                                        ? "/responses"
                                        : "/chat/completions",
                                  },
                                )}
                                disabled={busy}
                                onValueChange={setProviderApi}
                                options={[
                                  {
                                    value: "openai-completions",
                                    label: "Chat Completions",
                                  },
                                  {
                                    value: "openai-responses",
                                    label: "Responses",
                                  },
                                ]}
                                value={providerApi}
                              />
                            </fieldset>
                            <fieldset className="provider-form-section">
                              <legend>
                                {uiText(locale, "ProviderForm.model")}
                              </legend>
                              <TextField
                                disabled={busy}
                                label={uiText(locale, "ProviderForm.modelId")}
                                labelVisibility="visible"
                                onValueChange={setProviderModelId}
                                placeholder="deepseek-r1:8b"
                                value={providerModelId}
                              />
                              <TextField
                                disabled={busy}
                                label={t.modelName}
                                labelVisibility="visible"
                                onValueChange={setProviderModelName}
                                placeholder={uiText(
                                  locale,
                                  "ResourceCenter_labels.optional",
                                )}
                                value={providerModelName}
                              />
                            </fieldset>
                            <details className="provider-form-disclosure">
                              <summary>
                                <ArtemisIcon
                                  name="chevron"
                                  aria-hidden="true"
                                />
                                <span>
                                  <strong>
                                    {uiText(
                                      locale,
                                      "ProviderForm.capabilities",
                                    )}
                                  </strong>
                                  <small>
                                    {[
                                      uiText(
                                        locale,
                                        "ProviderForm.limitsSummary",
                                        {
                                          context: providerTokenFormat.format(
                                            parsedProviderContextWindow,
                                          ),
                                          output: providerTokenFormat.format(
                                            parsedProviderMaxTokens,
                                          ),
                                        },
                                      ),
                                      providerReasoning ? t.reasoningModel : "",
                                      providerImages ? t.imageInput : "",
                                    ]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </small>
                                </span>
                              </summary>
                              <div className="provider-form-disclosure-content">
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
                                    labelVisibility="visible"
                                    disabled={busy}
                                    onValueChange={
                                      setProviderHighestThinkingLevel
                                    }
                                    options={[
                                      {
                                        value: "minimal",
                                        label: t.thinkingMinimal,
                                      },
                                      { value: "low", label: t.thinkingLow },
                                      {
                                        value: "medium",
                                        label: t.thinkingMedium,
                                      },
                                      { value: "high", label: t.thinkingHigh },
                                      {
                                        value: "xhigh",
                                        label: t.thinkingXHigh,
                                      },
                                      { value: "max", label: t.thinkingMax },
                                    ]}
                                    value={providerHighestThinkingLevel}
                                  />
                                )}
                              </div>
                            </details>
                            <details
                              className="provider-form-disclosure"
                              ref={providerAdvancedDisclosure}
                            >
                              <summary>
                                <ArtemisIcon
                                  name="chevron"
                                  aria-hidden="true"
                                />
                                <span>
                                  <strong>
                                    {uiText(locale, "ProviderForm.advanced")}
                                  </strong>
                                  <small>
                                    {uiText(
                                      locale,
                                      "ResourceCenter_labels.optional",
                                    )}
                                  </small>
                                </span>
                                <span className="provider-form-format">
                                  JSON
                                </span>
                              </summary>
                              <div className="provider-form-disclosure-content">
                                <TextAreaField
                                  label={uiText(locale, "Model.advanced")}
                                  value={providerAdvanced}
                                  onValueChange={setProviderAdvanced}
                                  disabled={busy}
                                  rows={5}
                                />
                                <p className="provider-form-advanced-help">
                                  {t.providerHint}
                                </p>
                              </div>
                            </details>
                            <p className="provider-form-key-note">
                              {uiText(locale, "ProviderForm.keyHint")}
                            </p>
                          </div>
                          <footer className="provider-form-footer">
                            <span
                              className="provider-form-status"
                              role="status"
                            >
                              {providerFormValid && (
                                <ArtemisIcon
                                  name="check-circle"
                                  aria-hidden="true"
                                />
                              )}
                              {uiText(
                                locale,
                                providerFormValid
                                  ? "ProviderForm.ready"
                                  : "ProviderForm.required",
                              )}
                            </span>
                            <div className="provider-form-actions">
                              <Button
                                disabled={busy}
                                onClick={resetProviderForm}
                              >
                                {t.cancel}
                              </Button>
                              <Button
                                disabled={busy || !providerFormValid}
                                type="submit"
                                variant="primary"
                              >
                                {uiText(locale, "ProviderForm.save")}
                              </Button>
                            </div>
                          </footer>
                        </form>
                      </ManagementSection>
                    )}
                  </ProviderWorkspace>
                </>
              )}

              {activeTab === "general" && (
                <>
                  <ManagementSection
                    className="settings-section settings-general-profile"
                    title={t.tabGeneral}
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
                        <strong>{t.profileAvatar}</strong>
                        <p className="settings-avatar-hint">
                          {t.profileAvatarHint}
                        </p>
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
                          size="compact"
                          disabled={busy}
                          onClick={() => profileAvatarInputRef.current?.click()}
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
                    </div>
                  </ManagementSection>

                  <SettingsRow
                    className="settings-preference-row"
                    label={t.profileName}
                    description={t.profileNameHint}
                  >
                    <ProfileNameField
                      defaultName={settings.defaultUserName}
                      disabled={busy}
                      label={t.profileName}
                      onCommit={(name) => void setProfileName(name)}
                      savedName={settings.profileName}
                    />
                  </SettingsRow>

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
                      footer={uiText(locale, "Review06.languageCount", {
                        count: SUPPORTED_LOCALES.length,
                      })}
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
                    <SegmentedControl<AppTheme>
                      className="settings-theme-options"
                      size="compact"
                      label={t.theme}
                      disabled={busy}
                      onValueChange={(theme) => void setTheme(theme)}
                      options={[
                        {
                          value: "light",
                          label: t.themeLight,
                          icon: <ArtemisIcon name="sun" />,
                        },
                        {
                          value: "dark",
                          label: t.themeDark,
                          icon: <ArtemisIcon name="moon" />,
                        },
                        { value: "system", label: t.themeSystem },
                      ]}
                      value={settings.theme}
                    />
                  </SettingsRow>
                  <SettingsRow
                    label={uiText(locale, "SettingsPanel.material")}
                    description={uiText(locale, "SettingsPanel.materialHint")}
                  >
                    <SegmentedControl<MaterialPreference>
                      label={uiText(locale, "SettingsPanel.material")}
                      disabled={busy}
                      onValueChange={(material) => void setMaterial(material)}
                      options={[
                        {
                          value: "glass",
                          label: uiText(locale, "SettingsPanel.materialGlass"),
                        },
                        {
                          value: "solid",
                          label: uiText(locale, "SettingsPanel.materialSolid"),
                        },
                      ]}
                      size="compact"
                      value={settings.material ?? "glass"}
                    />
                  </SettingsRow>
                  <AppearanceSettingsSection locale={locale} />
                  <SettingsRow
                    label={uiText(locale, "SettingsPanel.composerPredictions")}
                    description={uiText(
                      locale,
                      "SettingsPanel.composerPredictionsHint",
                    )}
                  >
                    <Switch
                      checked={settings.composerPredictions ?? true}
                      disabled={busy}
                      label={uiText(
                        locale,
                        "SettingsPanel.composerPredictions",
                      )}
                      labelVisibility="hidden"
                      onCheckedChange={(checked) =>
                        void run(async () => {
                          const updated =
                            await window.artemis.setComposerPredictions(
                              checked,
                            );
                          setSettings(updated);
                          onSettingsChange(updated);
                        })
                      }
                    />
                  </SettingsRow>
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
                  <h2 className="settings-page-title">{t.tabAgents}</h2>
                  <ManagementSection
                    className="settings-section settings-global-agents"
                    title={t.globalAgents}
                    actions={
                      <small
                        className="settings-hint"
                        title={settings.globalAgents.path}
                      >
                        {t.globalAgentsHint}
                      </small>
                    }
                  >
                    <TextAreaField
                      disabled={busy}
                      label={t.globalAgents}
                      labelVisibility="hidden"
                      onValueChange={setGlobalAgentsContent}
                      rows={8}
                      value={globalAgentsContent}
                    />
                    {globalAgentsContent !== settings.globalAgents.content && (
                      <Button
                        disabled={busy}
                        onClick={() => void saveGlobalAgents()}
                        variant="primary"
                      >
                        {t.saveGlobalAgents}
                      </Button>
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
                  <details className="settings-advanced">
                    <summary>
                      <ArtemisIcon
                        className="disclosure-chevron"
                        name="chevron"
                      />
                      {uiText(locale, "Review02.advancedConcurrency")}
                    </summary>
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
                      {settings.agentConcurrency.preference.mode ===
                        "manual" && (
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
                      {settings.agentConcurrency.preference.mode ===
                        "manual" && (
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
                          <dd>
                            {settings.agentConcurrency.automaticSafeLimit}
                          </dd>
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
                                String(
                                  settings.agentConcurrency.totalMemoryGiB,
                                ),
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
                  </details>
                  {importOpen && (
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
                                        toggleImportSource(
                                          source.source,
                                          checked,
                                        )
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
                  )}
                </>
              )}

              {activeTab === "capabilities" && (
                <>
                  <ManagementSection
                    className="settings-section"
                    title={t.tabCapabilities}
                  >
                    <p className="settings-hint">
                      {uiText(locale, "Review02.modeDescription")}
                    </p>
                    <table className="settings-mode-capabilities">
                      <thead>
                        <tr>
                          <th>{uiText(locale, "Review03.capability")}</th>
                          {(["plan", "work", "codemode"] as const).map(
                            (mode) => (
                              <th key={mode}>
                                <ArtemisIcon
                                  name={mode === "codemode" ? "code" : mode}
                                />
                                {uiText(locale, `ComposerMode.${mode}`)}
                              </th>
                            ),
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {(
                          [
                            "readWorkspace",
                            "writeFiles",
                            "shellAccess",
                            "mcpSandbox",
                            "singleEscalation",
                          ] as const
                        ).map((capability, index) => (
                          <tr key={capability}>
                            <th scope="row">
                              {uiText(locale, `Review02.${capability}`)}
                            </th>
                            {(["plan", "work", "codemode"] as const).map(
                              (mode) => (
                                <td
                                  key={mode}
                                  data-capability-state={
                                    mode === "plan" && index > 0
                                      ? "unavailable"
                                      : index === 4
                                        ? "approval"
                                        : "allowed"
                                  }
                                >
                                  {mode === "plan" && index > 0 ? (
                                    "—"
                                  ) : index === 4 ? (
                                    uiText(locale, "Review02.approvalRequired")
                                  ) : (
                                    <ArtemisIcon name="check" />
                                  )}
                                </td>
                              ),
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <SettingsRow
                      label={uiText(locale, "Review02.defaultApproval")}
                      description={uiText(locale, "Review02.approvalNote")}
                    >
                      <Select
                        label={uiText(locale, "Review02.defaultApproval")}
                        labelVisibility="hidden"
                        value={settings.approvalPolicy}
                        disabled={busy}
                        options={[
                          {
                            value: "ask",
                            label: UI_COPY.App_copy[locale].askApproval,
                          },
                          {
                            value: "agent",
                            label: UI_COPY.App_copy[locale].agentApproval,
                          },
                          {
                            value: "full-access",
                            label: UI_COPY.App_copy[locale].fullAccess,
                            disabled: !settings.fullAccessAvailable,
                          },
                        ]}
                        onValueChange={(value) =>
                          void run(async () => {
                            const updated =
                              await window.artemis.setApprovalPolicy(value);
                            setSettings(updated);
                            onSettingsChange(updated);
                          })
                        }
                      />
                    </SettingsRow>
                    <SettingsRow
                      label={uiText(locale, "Review03.localMcpSandbox")}
                      description={uiText(locale, "Review03.mcpSandboxDetail")}
                    >
                      <span className="settings-readonly-status">
                        <ArtemisIcon name="sandbox" width={14} height={14} />
                        {uiText(locale, "Review02.defaultEnabled")}
                      </span>
                    </SettingsRow>
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
                  <h2 className="settings-page-title">{t.tabMaintenance}</h2>
                  <ManagementSection
                    className="settings-section settings-updates"
                    title={t.updates}
                  >
                    <div className="settings-release-summary">
                      <span className="settings-release-mark">
                        <ArtemisLogo size={36} />
                      </span>
                      <SettingsRow
                        label={`Artemis ${settings.update.currentVersion}`}
                        description={
                          <>
                            {settings.update.state === "disabled"
                              ? uiText(locale, "Review02.developmentUpdates")
                              : settings.update.state === "idle" &&
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
                                      current
                                        ? { ...current, update }
                                        : current,
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
                              {
                                UI_COPY.SettingsPanel_labels[locale]
                                  .installUpdate
                              }
                            </Button>
                          )}
                        </span>
                      </SettingsRow>
                    </div>
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
                    {settings.update.state === "downloaded" &&
                      !settings.update.message && (
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
                    {settings.update.message &&
                      settings.update.state !== "disabled" && (
                        <InlineNotice
                          tone={
                            settings.update.state === "error" ||
                            settings.update.state === "downloaded"
                              ? "danger"
                              : "neutral"
                          }
                        >
                          {settings.update.message}
                        </InlineNotice>
                      )}
                  </ManagementSection>
                  <ManagementSection
                    actions={
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const path =
                              await window.artemis.exportDiagnostics();
                            if (path) setMessage(t.diagnosticsExported);
                          })
                        }
                      >
                        {t.exportDiagnostics}
                      </Button>
                    }
                    className="settings-section settings-diagnostics"
                    children={null}
                    description={t.diagnosticsHint}
                    title={t.diagnostics}
                  />
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

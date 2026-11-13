import { uiText } from "../../../src/shared/i18n/ui-text.js";
import { findCssDeclarations } from "../css-test-utils.js";

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  appSource,
  stylesSource,
  nocturneStylesSource,
  publicUiStylesSource,
  settingsSource,
  providerWorkspaceSource,
  mcpServerEditorSource,
  apiSource,
  preloadSource,
  mainProcessSource,
  runtimeSource,
  codexSelectSource,
  uiFormsSource,
  uiManagementSource,
  uiStylesSource,
  cssRule,
  publicUiCssRule,
} from "../../fixtures/application/layout-contract.js";
describe("renderer layout contract", () => {
  it("keeps settings in the footer and collapsed rail without the obsolete command menu", () => {
    const sidebar = appSource.slice(
      appSource.indexOf("<NavigationSidebar"),
      appSource.indexOf("</NavigationSidebar>"),
    );
    expect(sidebar).toContain('className="rail-item"');
    expect(sidebar).toContain('className="activity-button foot-icon"');
    expect(sidebar).toContain('openSettings("general", event.currentTarget)');
    expect(sidebar).toContain("<SettingsIcon />");
    expect(sidebar).not.toContain('name="mobile"');
    expect(sidebar).not.toContain("t.commandMenu");
    expect(appSource).not.toContain("commandMenuOpen");
    expect(appSource).not.toContain('className="command-backdrop"');
    expect(stylesSource).not.toContain(".command-backdrop");
    const icon = appSource.slice(
      appSource.indexOf("function SettingsIcon()"),
      appSource.indexOf("function ReviewIcon()"),
    );
    expect(icon).toContain('name="gear"');
    expect(icon).toContain("height={17}");
  });
  it("shows the current version beside the username and opens update settings", () => {
    const sidebarBrandStart = appSource.indexOf(
      '<div className="sidebar-brand">',
    );
    const sidebarBrandEnd = appSource.indexOf(
      '<nav className="sidebar-nav"',
      sidebarBrandStart,
    );
    const sidebarBrandSource = appSource.slice(
      sidebarBrandStart,
      sidebarBrandEnd,
    );

    expect(sidebarBrandStart).toBeGreaterThan(-1);
    expect(sidebarBrandEnd).toBeGreaterThan(sidebarBrandStart);
    expect(sidebarBrandSource).not.toContain("app-version");
    const sidebarFooterStart = appSource.indexOf(
      '<div className="sidebar-footer">',
    );
    const sidebarFooterEnd = appSource.indexOf("</div>", sidebarFooterStart);
    const sidebarFooterSource = appSource.slice(
      sidebarFooterStart,
      sidebarFooterEnd,
    );
    expect(sidebarFooterSource).toContain("<SettingsIcon />");
    expect(sidebarFooterSource).not.toContain('name="mobile"');
    expect(sidebarFooterSource).toContain('className="app-version"');
    expect(sidebarFooterSource).toContain(
      "runtimeSettings?.update.currentVersion",
    );
    expect(sidebarFooterSource).toContain(
      'openSettings("maintenance", event.currentTarget)',
    );
    expect(sidebarFooterSource).toContain(
      "sidebarUpdateSubtitle(runtimeSettings.update, locale)",
    );
    expect(appSource).toContain("initialTab={settingsTab}");
    expect(settingsSource).toContain('initialTab = "general"');
    expect(settingsSource).toContain("useState<SettingsTab>(initialTab)");
    expect(
      findCssDeclarations(
        nocturneStylesSource,
        ".app-shell .sidebar .app-version",
      ),
    ).toContain("font-size: var(--meta)");
    expect(nocturneStylesSource).toContain("color: var(--muted-2)");
    expect(cssRule(".app-version")).toMatch(/\bbackground:\s*transparent/u);
    expect(nocturneStylesSource).toContain("padding: 8px 10px");
  });
  it("routes composer model changes to only the selected conversation", () => {
    expect(appSource).toContain("window.artemis.setThreadModelSelection(");
    expect(appSource).toContain("pendingModelSelection ??");
    expect(appSource).toContain("activeThread?.modelSelection ??");
    expect(appSource).toContain("runtimeSettings?.selection");
    expect(apiSource).toContain("setThreadModelSelection(");
    expect(preloadSource).toContain("IPC.threadModelSet");
    expect(mainProcessSource).toContain('type: "thread.model.set"');
    expect(runtimeSource).toContain("return this.modelRuntime.setThreadModel(");
    expect(runtimeSource).toContain("async function setThreadModel(");
  });
  it("keeps model names and thinking levels readable at compact widths", () => {
    expect(cssRule(".model-information strong")).toMatch(
      /font-size:\s*12\.5px/u,
    );
    expect(cssRule(".model-information strong")).toContain(
      "text-overflow: ellipsis",
    );
    expect(cssRule(".model-information small")).toMatch(
      /font-size:\s*12\.5px/u,
    );
    expect(nocturneStylesSource).toContain(
      "@container composer (max-width: 680px)",
    );
    expect(nocturneStylesSource).toContain(
      "@container composer (max-width: 460px)",
    );
    expect(nocturneStylesSource).toContain(
      '.composer-run-modes [aria-checked="false"] [data-part="label"]',
    );
    expect(
      findCssDeclarations(
        nocturneStylesSource,
        ".app-shell .model-information",
      ),
    ).toContain("display: flex");
    expect(stylesSource).not.toMatch(
      /\.model-information\s*\{[^}]*display:\s*none/u,
    );
    expect(appSource).toContain("thinkingLevelLabel(");
  });
  it("uses model risk and exact user authorization for Agent approval", () => {
    expect(mainProcessSource).not.toContain(
      'request.document.operation !== "delete"',
    );
    expect(mainProcessSource).toContain("modelApproval: request.modelApproval");
    expect(mainProcessSource).toContain(
      "risk: effectiveApprovalRisk(approvalOperation)",
    );
    expect(uiText("zh-CN", "App_copy.agentApprovalDetail")).toBe(
      "自动批准低、中风险及你明确要求的高风险操作",
    );
  });
  it("adds fuzzy model search inside the Settings model selector", () => {
    expect(settingsSource).toContain("searchPlaceholder={t.modelSearch}");
    expect(settingsSource).toContain("noResultsLabel={t.modelSearchEmpty}");
    expect(settingsSource).toContain(
      "searchText: `${model.providerId} ${model.name} ${model.modelId}`",
    );
    expect(settingsSource).toContain("options={modelOptions.filter(");
    expect(uiFormsSource).toContain('role="combobox"');
    expect(uiFormsSource).toContain('type="search"');
    expect(codexSelectSource).toContain(
      "export function filterCodexSelectOptions",
    );
    expect(uiFormsSource).toContain("filterSelectOptions(options, query)");
    expect(uiStylesSource).toContain(
      '[data-artemis-component="select"] [data-part="empty"]',
    );
  });
  it("shows the selected model name in the composer with catalog-free fallbacks", () => {
    expect(appSource).toContain(
      "const activeProviderModel = activeProvider?.models.find(",
    );
    expect(appSource).toContain(
      "activeModel?.name ??\n    activeProviderModel?.name ??\n    activeSelection?.modelId ??\n    t.model",
    );
    expect(appSource).toContain("provider.id === activeSelection.providerId");
    expect(appSource).toContain("thinkingLevelLabel");
    expect(appSource).toContain('className="model-information"');
  });
  it("switches models and supported thinking levels through one integrated menu", () => {
    const picker = readFileSync(
      new URL(
        "../../../src/renderer/settings/ModelPickerMenu.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const thinking = readFileSync(
      new URL(
        "../../../src/renderer/settings/ThinkingLevelControl.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    expect(appSource).toContain("<ModelPickerMenu");
    expect(appSource).toContain("switchComposerModel(model)");
    expect(appSource).toContain("switchComposerThinking(level, ultra)");
    expect(picker).toContain('className="model-picker-menu"');
    expect(picker).toContain('className="model-picker-search"');
    expect(picker).toContain("activeModel?.reasoning && selection");
    expect(picker).toContain("<ThinkingLevelControl");
    expect(thinking).toContain("thinkingLevelsForModel(model)");
    expect(thinking).toContain('"Review06.ultra"');
    expect(uiText("zh-CN", "Review06.ultra")).toBe("超强");
    expect(appSource).toContain(
      "selectionForModelSwitch(model, activeSelection)",
    );
  });
  it("shows context usage beside the model and configures the context window", () => {
    const usageIndex = appSource.indexOf("<ContextUsageIndicator");
    const modelIndex = appSource.indexOf('className="model-button"');

    expect(usageIndex).toBeGreaterThan(-1);
    expect(modelIndex).toBeGreaterThan(usageIndex);
    expect(appSource).toContain("threadState?.contextUsage");
    expect(settingsSource).toContain("<TextField");
    expect(settingsSource).toContain("label={t.contextWindow}");
    expect(settingsSource).toContain("contextWindowHint");
    expect(
      cssRule(".context-usage-indicator:hover .context-usage-popover"),
    ).toBeTruthy();
    expect(cssRule(".context-usage-indicator")).toMatch(
      /\bposition:\s*static/u,
    );
    expect(cssRule(".context-usage-popover")).toMatch(
      /\bbox-sizing:\s*border-box[\s\S]*\bright:\s*12px[\s\S]*\bwhite-space:\s*normal[\s\S]*\bwidth:\s*min\(320px,\s*calc\(100%\s*-\s*24px\)\)/u,
    );
  });
  it("supports provider base URLs, language selection, and model-save feedback", () => {
    expect(settingsSource).toContain("baseUrl");
    expect(settingsSource).toContain("providerApi");
    expect(settingsSource).toContain('"openai-responses"');
    expect(settingsSource).toContain(
      "const DEFAULT_PROVIDER_CONTEXT_WINDOW = 1_000_000;",
    );
    expect(settingsSource).toContain(
      "const DEFAULT_PROVIDER_MAX_TOKENS = 128_000;",
    );
    expect(settingsSource).toContain("value={providerContextWindow}");
    expect(settingsSource).toContain("value={providerMaxTokens}");
    const providerFormSource = settingsSource.slice(
      settingsSource.indexOf('className="provider-form"'),
      settingsSource.indexOf(
        "</form>",
        settingsSource.indexOf('className="provider-form"'),
      ),
    );
    expect(providerFormSource.match(/step=\{1\}/gu)).toHaveLength(2);
    expect(providerFormSource).not.toContain("step={1_024}");
    expect(settingsSource).toContain(
      "const providerIdPattern = /^[a-z0-9][a-z0-9._-]*$/u;",
    );
    expect(settingsSource).toContain('value.toLocaleLowerCase("en-US")');
    expect(settingsSource).toContain('pattern="[a-z0-9][a-z0-9._-]*"');
    expect(settingsSource).toContain("providerIdValid &&");
    expect(settingsSource).toContain("!providerFormValid");
    expect(settingsSource).toContain(
      "contextWindow: parsedProviderContextWindow",
    );
    expect(settingsSource).toContain("maxTokens: parsedProviderMaxTokens");
    expect(settingsSource).toContain(
      "highestThinkingLevel: providerHighestThinkingLevel",
    );
    expect(uiText("zh-CN", "SettingsPanel_labels.highestReasoningLevel")).toBe(
      "支持的最高推理档位",
    );
    expect(settingsSource).toContain("<Select<ProviderThinkingLevel>");
    expect(settingsSource).toMatch(
      /\{\s*value: "xhigh",\s*label: t\.thinkingXHigh,?\s*\}/u,
    );
    expect(settingsSource).toContain('{ value: "max", label: t.thinkingMax }');
    expect(mainProcessSource).toContain("customModelThinkingLevels(model)");
    expect(providerWorkspaceSource).toContain("<ProviderBaseUrl");
    expect(providerWorkspaceSource).toContain("baseUrl: value.trim()");
    expect(settingsSource).toContain("saveProviderConnection");
    const providerSaveHandler = mainProcessSource.slice(
      mainProcessSource.indexOf("IPC.settingsProviderSave"),
      mainProcessSource.indexOf("IPC.settingsCredentialDelete"),
    );
    expect(providerSaveHandler).toContain(
      "const activatesProvider = !configuration.selection;",
    );
    expect(providerSaveHandler).toContain(
      "configuration.selection = providerSelection;",
    );
    expect(providerSaveHandler).toContain(
      "await services.settingsStore.setModel(",
    );
    expect(providerSaveHandler).toContain("providerContextWindow");
    expect(settingsSource).toContain("setLanguage");
    expect(settingsSource).toContain('className="model-apply-dialog"');
    expect(settingsSource).toContain("modelSaved");
    expect(settingsSource).toContain("modelSaveFailed");
  });
  it("creates, edits, and deletes multiple provider connections", () => {
    const providerSaveHandler = mainProcessSource.slice(
      mainProcessSource.indexOf("IPC.settingsProviderSave"),
      mainProcessSource.indexOf("IPC.settingsProviderDelete"),
    );
    const providerDeleteHandler = mainProcessSource.slice(
      mainProcessSource.indexOf("IPC.settingsProviderDelete"),
      mainProcessSource.indexOf("IPC.settingsCredentialDelete"),
    );

    expect(settingsSource).toContain("editingProviderId");
    expect(settingsSource).toContain("function resetProviderForm()");
    expect(settingsSource).toContain("resetProviderForm();");
    expect(settingsSource).toContain(
      "disabled={busy || Boolean(editingProviderId)}",
    );
    expect(settingsSource).toMatch(
      /window\.artemis\.deleteProviderConnection\(\s*provider\.id,?\s*\)/u,
    );
    expect(settingsSource).toContain("onDeleteConnection=");
    expect(providerWorkspaceSource).toContain("onDeleteConnection();");
    expect(settingsSource).toContain('variant="danger"');
    expect(settingsSource).toContain("<ConfirmationDialog");
    expect(apiSource).toMatch(
      /deleteProviderConnection\(providerId: string\): Promise<SettingsSnapshot>/u,
    );
    expect(apiSource).toContain(
      'settingsProviderDelete: "artemis:settings-provider-delete"',
    );
    expect(preloadSource).toContain(
      "deleteProviderConnection: (providerId) =>",
    );
    expect(providerSaveHandler).toContain("updatesActiveProvider");
    expect(providerSaveHandler).toContain("configuration.selection?.modelId");
    expect(providerSaveHandler).toContain(
      "selectedProviderModel ?? providerModel",
    );
    expect(providerSaveHandler).toContain(
      "configuration.selection = providerSelection",
    );
    expect(providerSaveHandler).toContain(
      "await services.settingsStore.setModel(",
    );
    expect(providerDeleteHandler).toContain(
      "await services.settingsStore.deleteProviderConnection(",
    );
    expect(providerDeleteHandler).toContain(
      "delete configuration.credentials[provider.id]",
    );
  });
  it("saves models and provider credentials separately without using the switch API", () => {
    const providersTabStart = settingsSource.indexOf(
      '{activeTab === "providers"',
    );
    const generalTabStart = settingsSource.indexOf("{showProviderForm && (");
    const customProvidersStart = settingsSource.indexOf(
      "{showProviderForm && (",
    );
    const agentsTabStart = settingsSource.indexOf('{activeTab === "agents"');
    const builtInProvidersTabSource = settingsSource.slice(
      providersTabStart,
      generalTabStart,
    );
    const customProvidersTabSource = settingsSource.slice(
      customProvidersStart,
      agentsTabStart,
    );

    const addModelSource = settingsSource.slice(
      settingsSource.indexOf("async function addModel()"),
      settingsSource.indexOf("async function setLanguage"),
    );
    const modelAddHandler = mainProcessSource.slice(
      mainProcessSource.indexOf("IPC.settingsModelAdd"),
      mainProcessSource.indexOf("IPC.settingsModelDelete"),
    );
    const modelDeleteHandler = mainProcessSource.slice(
      mainProcessSource.indexOf("IPC.settingsModelDelete"),
      mainProcessSource.indexOf("IPC.settingsModelSet"),
    );
    const modelSwitchHandler = mainProcessSource.slice(
      mainProcessSource.indexOf("IPC.settingsModelSet"),
      mainProcessSource.indexOf("IPC.settingsApiKeySave"),
    );

    expect(builtInProvidersTabSource).toContain("title={t.addedModels}");
    expect(builtInProvidersTabSource).not.toContain("{t.thinking}");
    expect(builtInProvidersTabSource).not.toContain("<h3>{t.apiKey}</h3>");
    expect(providerWorkspaceSource).toContain(
      "window.artemis.saveApiKey(providerId, apiKey.trim())",
    );
    expect(builtInProvidersTabSource).toContain("onClick={addModel}");
    expect(builtInProvidersTabSource).not.toContain("onClick={saveKey}");
    expect(builtInProvidersTabSource).not.toContain("keyProviderId");
    expect(
      builtInProvidersTabSource.match(/variant="primary"/gu) ?? [],
    ).toHaveLength(1);
    expect(builtInProvidersTabSource).not.toContain("settings.credentials.map");
    expect(builtInProvidersTabSource).not.toContain(
      "window.artemis.deleteCredential",
    );
    expect(builtInProvidersTabSource).toContain("settings.addedModels");
    expect(builtInProvidersTabSource).toContain(
      "model.providerId === selectedProviderId",
    );
    expect(builtInProvidersTabSource).toContain("setModelDeleteTarget(model)");
    expect(providerWorkspaceSource).toContain("importPiCredentials");
    expect(addModelSource).not.toContain("keyApiKey");
    expect(apiSource).toMatch(
      /addModel\(\s*model: AddedModelConfiguration,\s*apiKey\?: string,/u,
    );
    expect(preloadSource).toContain("addModel: (model, apiKey)");
    expect(apiSource).toContain("removeModel(");
    expect(preloadSource).toContain("removeModel: (model)");
    expect(modelAddHandler).toContain("apiKeyInput?: string");
    expect(modelAddHandler).toContain(
      "configuration.credentials[selectedModel.providerId]",
    );
    expect(modelAddHandler).toContain("await services.settingsStore.addModel(");
    expect(modelDeleteHandler).toContain("activeTurns.size > 0");
    expect(modelDeleteHandler).toContain(
      "await services.settingsStore.removeModel(",
    );
    expect(modelDeleteHandler).not.toContain(
      "Switch conversations using this model before deleting it.",
    );
    expect(settingsSource).toContain(
      "onSettingsChange(updated, { refreshThreads: true })",
    );
    expect(modelDeleteHandler).toContain(
      "delete configuration.credentials[target.providerId]",
    );
    expect(modelSwitchHandler).not.toContain("apiKeyInput");
    expect(modelSwitchHandler).toMatch(
      /await services\.settingsStore\.setModel\(\s*resolved\.selection,\s*resolved\.contextWindow,?\s*\)/u,
    );
    expect(mainProcessSource).toContain(
      'typeof selection.ultraMode !== "boolean"',
    );
    expect(mainProcessSource).toContain("normalizeModelSelection(");
    expect(mainProcessSource).toContain("selectedModel.reasoning");
    expect(mainProcessSource).toContain("selectedModel.highestThinkingLevel");
    expect(mainProcessSource).toContain("selection.ultraMode === true");

    // Custom provider setup keeps its independent, working connection flow.
    expect(customProvidersTabSource).toContain('"ProviderForm.addTitle"');
    expect(customProvidersTabSource).toContain('"ProviderForm.editTitle"');
    expect(customProvidersTabSource).toContain("saveProviderConnection");
    expect(customProvidersTabSource).not.toContain("t.optionalApiKey");
    expect(customProvidersTabSource).not.toContain("onClick={saveKey}");
    expect(customProvidersTabSource).not.toContain("keyProviderId");
  });
  it("uses a centered settings dialog with left tabs and one active content panel", () => {
    const settingsSurface = publicUiCssRule(
      '[data-artemis-component="settings-surface"]',
    );
    const settingsBody = publicUiCssRule(
      '[data-artemis-component="settings-surface"] > [data-part="body"]',
    );

    expect(settingsSource).toContain("<Dialog");
    expect(settingsSource).toContain("<SettingsSurface");
    expect(settingsSource).toContain('className="settings-panel"');
    expect(settingsSource).toContain('className="settings-tabs"');
    expect(settingsSource).toContain("<Tabs<SettingsTab>");
    expect(settingsSource).toContain('role="tabpanel"');
    expect(settingsSource).toContain('activeTab === "general"');
    expect(settingsSource).toContain('activeTab === "providers"');
    expect(settingsSource).toContain('activeTab === "agents"');
    expect(settingsSource).toContain('activeTab === "capabilities"');
    expect(settingsSource).toContain('activeTab === "maintenance"');
    expect(uiText("en", "SettingsPanel_labels.tabProviders")).toBe(
      "Model services",
    );
    expect(uiText("zh-CN", "SettingsPanel_labels.tabProviders")).toBe(
      "模型服务",
    );
    expect(settingsSource).toContain("<ProviderWorkspace");
    expect(providerWorkspaceSource).toContain('className="provider-sidebar"');
    expect(providerWorkspaceSource).toContain('className="provider-detail"');
    expect(uiManagementSource).not.toMatch(
      /@artemis\/protocol|electron|node:/u,
    );
    expect(stylesSource).not.toContain(".settings-backdrop");
    expect(settingsSurface).toMatch(/\bdisplay:\s*flex/u);
    expect(settingsBody).toMatch(/\bdisplay:\s*grid/u);
    expect(publicUiStylesSource).toContain(
      "grid-template-columns: 196px minmax(0, 1fr)",
    );
    expect(cssRule(".profile-avatar-input")).toMatch(
      /\bposition:\s*absolute[\s\S]*\bwidth:\s*1px/u,
    );
  });
  it("uses native dialogs for Settings and confirmations above workspace overlays", () => {
    expect(settingsSource).toContain("<Dialog");
    expect(appSource).toMatch(
      /<Dialog[\s\S]*?className=\{`confirmation-dialog/u,
    );
    expect(cssRule(".settings-panel")).not.toMatch(/\bz-index:/u);
    expect(stylesSource).not.toContain(".confirmation-backdrop");
    expect(publicUiCssRule('[data-artemis-component="dialog"]')).toContain(
      "max-block-size:",
    );
  });
  it("uses a real provider form with editable controls and a submit action", () => {
    expect(settingsSource).toMatch(/<form\s+className="provider-form"/u);
    expect(settingsSource).toMatch(
      /onSubmit=\{\(event\) =>\s*void saveProviderConnection\(event\)\s*\}/u,
    );
    expect(settingsSource).toContain('type="submit"');
    expect(settingsSource).toContain('variant="primary"');
  });
  it("keeps configuration import source checkboxes compact", () => {
    expect(settingsSource).toContain('className="configuration-import-source"');
    expect(settingsSource).toContain("<ManagementRow");
    expect(settingsSource).toContain("<Checkbox");
    expect(uiFormsSource).toContain('component="checkbox"');
  });
  it("enables Save and connect from the command or URL and prefills imported servers", () => {
    expect(mcpServerEditorSource).toContain('loading={busyAction === "save"}');
    expect(mcpServerEditorSource).toContain(
      '(actionsLocked && busyAction !== "save")',
    );
    expect(mcpServerEditorSource).not.toContain("!workspace.trim()");
    expect(mcpServerEditorSource).not.toContain("!serverId.trim()");
    expect(mcpServerEditorSource).not.toContain("!name.trim()");
    expect(mcpServerEditorSource).toContain("server.config.command");
    expect(mcpServerEditorSource).toContain("server.config.args");
    expect(mcpServerEditorSource).toContain(
      "Object.entries(server.config.env)",
    );
    expect(mcpServerEditorSource).toContain("server.config.envVars");
    expect(mcpServerEditorSource).toContain("server.config.workspacePath");
    expect(mcpServerEditorSource).toContain("server.config.url");
  });
  it("renders settings actions as visually distinct primary and secondary buttons", () => {
    const buttonBefore = (label: string) => {
      const source =
        label === "importPi" ? providerWorkspaceSource : settingsSource;
      const labelIndex = source.indexOf(
        label === "saveProvider"
          ? '{uiText(locale, "ProviderForm.save")}'
          : `{t.${label}}`,
      );
      expect(labelIndex).toBeGreaterThan(-1);
      const buttonIndex = source.lastIndexOf("<Button", labelIndex);
      return source.slice(buttonIndex, labelIndex);
    };

    // The model action changes its label between add and edit; its variant is
    // covered by the interactive settings test.
    for (const label of ["saveProvider", "saveGlobalAgents"]) {
      expect(buttonBefore(label)).toContain('variant="primary"');
    }

    for (const label of [
      "importPi",
      "scanImports",
      "exportDiagnostics",
      "checkUpdates",
    ]) {
      expect(buttonBefore(label)).toContain("<Button");
    }

    expect(
      publicUiCssRule(
        '[data-artemis-component="button"][data-variant="primary"]',
      ),
    ).toMatch(/\bbackground:/u);
    expect(publicUiStylesSource).toContain(
      '[data-artemis-component="button"][data-state="disabled"]',
    );
  });
  it("keeps settings primary actions visible in the light theme above generic button rules", () => {
    const primaryAction = publicUiCssRule(
      '[data-artemis-component="button"][data-variant="primary"]',
    );

    expect(primaryAction).toMatch(
      /\bbackground:\s*var\(--artemis-color-accent-primary\)/u,
    );
    expect(primaryAction).toMatch(
      /\bcolor:\s*var\(--artemis-color-accent-on-primary\)/u,
    );
    expect(publicUiStylesSource).toMatch(
      /\[data-artemis-component="button"\]\[data-state="disabled"\][\s\S]*?opacity:\s*var\(--artemis-opacity-disabled\)/u,
    );
    expect(stylesSource).not.toContain(".settings-primary-action");
  });
  it("keeps configuration-import warnings visible while source paths stay hidden", () => {
    expect(settingsSource).toContain("source.warnings.map");
    expect(settingsSource).toContain(
      'className="configuration-import-warning"',
    );
    expect(settingsSource).not.toContain("source.paths.map");
  });
});

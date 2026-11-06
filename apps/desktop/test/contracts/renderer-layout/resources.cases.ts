import { uiText } from "../../../src/shared/i18n/ui-text.js";
import { findCssDeclarations } from "../css-test-utils.js";

import { describe, expect, it } from "vitest";

import {
  appSource,
  stylesSource,
  publicUiStylesSource,
  settingsSource,
  resourceCenterSource,
  resourceIconsSource,
  mcpServerEditorSource,
  apiSource,
  preloadSource,
  mainProcessSource,
  smokeSource,
  runtimeSource,
  agentProcessSource,
  uiFormsSource,
  skillCommandsSource,
  cssRule,
  publicUiCssRule,
} from "../../fixtures/application/layout-contract.js";
describe("renderer layout contract", () => {
  it("exposes MCP, Skills, and persistent task goals as first-class navigation", () => {
    expect(appSource).toContain("<ResourceCenter");
    expect(appSource).toContain('activeView === "resources"');
    expect(appSource).toContain('selectComposerCommand("/goal ")');
    expect(appSource).toContain("window.artemis.setThreadGoal");
  });
  it("uses a compact Codex-style slash menu and keeps selected Skills visible", () => {
    expect(appSource).toContain(".listInstalledSkills()");
    expect(appSource).toContain(".listArtemisPlugins()");
    expect(appSource).toContain('className="slash-command-menu"');
    expect(appSource).toContain("ref={slashCommandMenu}");
    expect(appSource).toContain("installedPluginBySkillName");
    expect(appSource).toContain("plugin.iconDataUrl");
    expect(appSource).toContain("menu.scrollTop =");
    expect(appSource).toContain('role="listbox"');
    expect(appSource).toContain('aria-autocomplete="list"');
    expect(appSource).toContain("{t.initCommand}");
    expect(appSource).toContain('selectComposerCommand("/init")');
    expect(appSource).toContain("{t.compactCommand}");
    expect(appSource).toContain('selectComposerCommand("/compact")');
    expect(appSource).toContain("<ComposerSkillChip");
    expect(appSource).toContain('className="composer-resource-strip"');
    expect(appSource).toContain("selectedComposerSkillNames");
    expect(appSource).toContain('replaceActiveSlashCommand(current, "")');
    expect(appSource).toContain("promptWithSelectedSkills(");
    expect(appSource).toContain("removeLabel={t.removeSelectedSkill}");
    expect(appSource).toContain("selectedSkills.length === 0");
    expect(appSource).toContain("!installedPluginBySkillName.has(skill.name)");
    expect(appSource).toContain("<strong>{skill.name}</strong>");
    expect(appSource).not.toContain(
      "<strong>{`/skill:${skill.name}`}</strong>",
    );
    expect(skillCommandsSource).toContain("skill.enabled");
    expect(skillCommandsSource).toContain("`/skill:${skill.name} `");
    expect(cssRule(".slash-command-menu")).toMatch(/\boverflow-y:\s*auto/u);
    expect(cssRule(".slash-command-menu")).toMatch(/\bmax-height:\s*286px/u);
    expect(cssRule(".slash-command-menu")).toMatch(/\bposition:\s*absolute/u);
    expect(cssRule(".slash-command-menu")).toMatch(
      /\bbottom:\s*calc\(100%\s*\+\s*10px\)/u,
    );
    expect(cssRule(".slash-command-suggestion")).toMatch(/\bborder:\s*0/u);
    expect(cssRule(".slash-command-suggestion")).toMatch(
      /\bmin-height:\s*40px/u,
    );
    expect(
      cssRule(
        '.slash-command-suggestion > span:last-child:not([data-part="state-indicator"])',
      ),
    ).toMatch(/\bflex-direction:\s*column/u);
    expect(
      cssRule(
        '.slash-command-suggestion > span:last-child:not([data-part="state-indicator"])',
      ),
    ).toMatch(/\bgap:\s*0\.5px/u);
    expect(appSource).toContain("<ResourceAvatar");
    expect(appSource).toContain("iconDataUrl={plugin.iconDataUrl}");
    expect(appSource).toContain("<CommandArtwork");
    expect(
      findCssDeclarations(
        stylesSource,
        ".slash-command-suggestion .resource-avatar",
      ),
    ).toBeUndefined();
  });
  it("imports only global instructions, Skills, and MCP configuration", () => {
    expect(settingsSource).toContain('>(["instructions", "skills", "mcp"]);');
    expect(settingsSource).not.toContain("importModel:");
    expect(settingsSource).not.toContain('["model", t.importModel]');
    expect(mainProcessSource).toContain(
      '["instructions", "skills", "mcp"].includes(category)',
    );
    expect(mainProcessSource).not.toContain("applyImportedModel(");
  });
  it("uses a standalone structured MCP editor for installed stdio servers", () => {
    expect(resourceCenterSource).toContain('mode === "mcp-editor"');
    expect(resourceCenterSource).toContain("<McpServerEditor");
    expect(resourceCenterSource).toContain("function openMcpEditor");
    expect(mcpServerEditorSource).toContain('className="mcp-editor-card"');
    expect(mcpServerEditorSource).toContain('className="mcp-argument-row"');
    expect(mcpServerEditorSource).toContain('className="mcp-environment-row"');
    expect(mcpServerEditorSource).toContain("{t.environmentVariables}");
    expect(mcpServerEditorSource).toContain(
      "{t.environmentVariablePassthrough}",
    );
    expect(mcpServerEditorSource).toContain("t.transportChangeHint");
    expect(settingsSource).not.toContain("window.artemis.saveMcpServer");
    expect(settingsSource).not.toContain("window.artemis.removeMcpServer");
  });
  it("exposes persisted MCP and Skill switches in the capability center", () => {
    expect(resourceCenterSource).toContain(
      "window.artemis.setMcpServerEnabled",
    );
    expect(resourceCenterSource).toContain("window.artemis.setSkillEnabled");
    expect(resourceCenterSource).toContain("<Switch");
    expect(uiFormsSource).toContain(
      'role={component === "switch" ? "switch" : undefined}',
    );
    expect(stylesSource).toContain(".resource-switch");
  });
  it("uses the latest prototype grid mark for the resource entry", () => {
    const iconStart = appSource.indexOf("function ResourceIcon()");
    const iconEnd = appSource.indexOf("function TokenUsageIcon()", iconStart);
    const icon = appSource.slice(iconStart, iconEnd);

    expect(icon).toContain('<ArtemisIcon className="icon"');
    expect(icon).toContain('name="grid"');
    expect(icon).not.toContain('name="source"');
  });
  it("keeps the Nocturne marketplace and manager on the shared resource surface", () => {
    const resourceSurface = publicUiCssRule(
      '[data-artemis-component="resource-surface"]',
    );
    const toolbar = cssRule(".resource-management-toolbar");

    expect(resourceCenterSource).toContain("<ResourceSurface");
    expect(resourceCenterSource).toContain(
      'className="resource-installed-overview"',
    );
    expect(resourceCenterSource).toContain(
      'className="resource-category-tabs"',
    );
    expect(resourceCenterSource).toContain("value={selectedMarketplaceView}");
    expect(resourceCenterSource).toContain("options={managementTabOptions}");
    expect(resourceSurface).toMatch(/\bdisplay:\s*flex/u);
    expect(publicUiStylesSource).toContain("inline-size: min(100%, 72rem)");
    expect(toolbar).toMatch(/\bdisplay:\s*flex/u);
    expect(toolbar).toMatch(/\bjustify-content:\s*space-between/u);
    expect(resourceCenterSource).toContain("<SegmentedControl");
  });
  it("renders MCP switches from configuration independently of connection status", () => {
    const mcpStart = resourceCenterSource.indexOf('managementTab === "mcp" &&');
    const mcpEnd = resourceCenterSource.indexOf(
      'managementTab === "skills" &&',
      mcpStart,
    );
    const mcpSection = resourceCenterSource.slice(mcpStart, mcpEnd);
    expect(mcpSection).toContain("checked={server.config.enabled}");
    expect(mcpSection).not.toContain('checked={server.state === "connected"}');
  });
  it("lets capability-center MCP entries be removed", () => {
    expect(resourceCenterSource).toContain("window.artemis.removeMcpServer");
    expect(resourceCenterSource).toContain("<ManagementRow");
    expect(resourceCenterSource).toContain('variant="danger"');
  });
  it("keeps resource search editable and notices aligned after installation", () => {
    expect(resourceCenterSource).toContain('<InlineNotice tone="info">');
    expect(publicUiStylesSource).toContain(
      '[data-artemis-component="inline-notice"]',
    );
    expect(resourceCenterSource).toContain("inputRef={catalogSearchRef}");
    expect(resourceCenterSource).toContain("focusCatalogSearch()");
    expect(resourceCenterSource).toContain("value={catalogQuery}");
    expect(resourceCenterSource).not.toMatch(
      /<input[\s\S]*?disabled=\{installProgress/u,
    );
  });
  it("distinguishes active, empty, and untouched MCP and Skill searches", () => {
    expect(resourceCenterSource).toContain("catalogSearchPhase");
    expect(resourceCenterSource).toContain("setMcpResults([])");
    expect(resourceCenterSource).toContain("setSkillResults([])");
    expect(resourceCenterSource).toContain("t.searchingMcp");
    expect(resourceCenterSource).toContain("t.searchingSkills");
    expect(resourceCenterSource).toContain("t.noMcpCatalogResults");
    expect(resourceCenterSource).toContain("t.noSkillCatalogResults");
    expect(resourceCenterSource).toContain("<LoadingState");
    expect(resourceCenterSource).toContain("<EmptyState");
    const mcpSearch = resourceCenterSource.indexOf("label={t.searchMcp}");
    const mcpList = resourceCenterSource.indexOf(
      'className="resource-management-list resource-mcp-list grouped"',
      mcpSearch,
    );
    const skillSearch = resourceCenterSource.indexOf("label={t.searchSkills}");
    const skillList = resourceCenterSource.indexOf(
      'className="resource-management-list"',
      skillSearch,
    );
    expect(mcpSearch).toBeGreaterThan(-1);
    expect(mcpList).toBeGreaterThan(mcpSearch);
    expect(skillSearch).toBeGreaterThan(-1);
    expect(skillList).toBeGreaterThan(skillSearch);
    for (const view of [
      "mcp-search-loading",
      "mcp-search-empty",
      "skill-search-loading",
      "skill-search-empty",
    ]) {
      expect(smokeSource).toContain(view);
    }
  });
  it("shows real Skill and MCP installation progress through isolated IPC", () => {
    expect(apiSource).toContain("export interface ResourceInstallProgress");
    expect(apiSource).toContain("onResourceInstallProgress(");
    expect(apiSource).toContain(
      'resourceInstallProgress: "artemis:resource-install-progress"',
    );
    expect(preloadSource).toContain(
      "ipcRenderer.on(IPC.resourceInstallProgress",
    );
    expect(mainProcessSource).toContain("IPC.resourceInstallProgress");
    expect(resourceCenterSource).toContain('role="progressbar"');
    expect(resourceCenterSource).toContain(
      'className="catalog-progress-track"',
    );
    expect(resourceCenterSource).toContain("installProgress.percent");
  });
  it("makes the local Skill installer visibly interactive", () => {
    expect(resourceCenterSource).toContain(
      'className="resource-add-button subtle"',
    );
    expect(resourceCenterSource).toContain(
      "onClick={() => runResourceOperation(installLocalSkill)}",
    );
    expect(publicUiStylesSource).toMatch(
      /\[data-artemis-component="button"\]\[data-variant="secondary"\][\s\S]*?background:\s*var\(--artemis-color-surface-base\)/u,
    );
  });
  it("installs a local Skill only from the Skills tab and refreshes the installed cache", () => {
    expect(uiText("en", "ResourceCenter_labels.installLocalSkill")).toBe(
      "Install local Skill",
    );
    expect(resourceCenterSource).toContain('managementTab === "skills" &&');
    expect(resourceCenterSource).toContain(
      "window.artemis.installLocalSkill(operationId)",
    );
    expect(resourceCenterSource).toContain("if (!installed) return;");
    expect(resourceCenterSource).toMatch(
      /resourceCache\.installedSkillsCache =\s*await window\.artemis\.listInstalledSkills\(\)/u,
    );
    expect(resourceCenterSource).toContain(
      "setInstalledSkills(resourceCache.installedSkillsCache)",
    );
  });
  it("routes local Skill installation through a native directory-picker IPC contract", () => {
    expect(apiSource).toContain(
      "installLocalSkill(operationId: string): Promise<InstalledSkill | undefined>;",
    );
    expect(apiSource).toContain(
      'resourceSkillInstallLocal: "artemis:resource-skill-install-local"',
    );
    expect(preloadSource).toMatch(
      /installLocalSkill:\s*\(operationId\)\s*=>\s*ipcRenderer\.invoke\(IPC\.resourceSkillInstallLocal,\s*operationId\)/u,
    );
    expect(mainProcessSource).toContain("IPC.resourceSkillInstallLocal");
    expect(mainProcessSource).toContain('properties: ["openDirectory"]');
    expect(mainProcessSource).toMatch(
      /if\s*\(\s*selection\.canceled\s*\|\|\s*selection\.filePaths\.length\s*!==\s*1\s*\)\s*return undefined;/u,
    );
    expect(mainProcessSource).toContain(
      "resourceCatalogService.installLocalSkill(",
    );
    expect(mainProcessSource).toContain("selection.filePaths[0]");
    expect(mainProcessSource).toContain(
      "(percent) => publish(10 + percent * 0.7)",
    );
  });
  it("lets installed Skills be removed through the managed catalog root", () => {
    expect(resourceCenterSource).toContain("window.artemis.removeSkill");
    expect(apiSource).toContain(
      "removeSkill(skillId: string): Promise<InstalledSkill[]>;",
    );
    expect(apiSource).toContain(
      'resourceSkillRemove: "artemis:resource-skill-remove"',
    );
    expect(preloadSource).toMatch(
      /removeSkill:\s*\(skillId\)\s*=>\s*ipcRenderer\.invoke\(IPC\.resourceSkillRemove,\s*skillId\)/u,
    );
    expect(mainProcessSource).toContain("IPC.resourceSkillRemove");
    expect(mainProcessSource).toContain("resourceCatalogService.removeSkill");
  });
  it("routes multi-marketplace plugin compatibility through isolated Resource Center IPC", () => {
    expect(uiText("en", "ResourceCenter_labels.plugins")).toBe("Plugins");
    expect(uiText("zh-CN", "ResourceCenter_labels.plugins")).toBe("插件");
    expect(resourceCenterSource).toContain(
      "window.artemis.getArtemisPluginMarketplaces()",
    );
    expect(resourceCenterSource).toContain(
      "window.artemis.inspectLocalArtemisPlugin()",
    );
    expect(resourceCenterSource).toContain(
      "window.artemis.addArtemisPluginMarketplace(",
    );
    expect(resourceCenterSource).toContain(
      "window.artemis.refreshArtemisPluginMarketplace(",
    );
    expect(resourceCenterSource).toContain(
      "window.artemis.reorderArtemisPluginMarketplaces(",
    );
    expect(resourceCenterSource).toContain(
      "window.artemis.removeArtemisPluginMarketplace(",
    );
    expect(resourceCenterSource).toContain(
      "window.artemis.installArtemisPlugin(",
    );
    expect(resourceCenterSource).toContain(
      "window.artemis.updateArtemisPlugin(",
    );
    expect(resourceCenterSource).toContain(
      "window.artemis.removeArtemisPlugin(",
    );
    expect(uiText("en", "ResourceCenter_labels.confirmPlugin")).toContain(
      "MCP servers and Connectors will be enabled",
    );

    for (const method of [
      "listArtemisPlugins",
      "inspectLocalArtemisPlugin",
      "loadArtemisPluginMarketplace",
      "getArtemisPluginMarketplaces",
      "addArtemisPluginMarketplace",
      "selectArtemisPluginMarketplace",
      "refreshArtemisPluginMarketplace",
      "removeArtemisPluginMarketplace",
      "reorderArtemisPluginMarketplaces",
      "loadBundledPluginMarketplace",
      "installBundledPlugins",
      "installArtemisPlugin",
      "updateArtemisPlugin",
      "setArtemisPluginEnabled",
      "removeArtemisPlugin",
    ]) {
      expect(apiSource).toContain(`${method}(`);
      expect(preloadSource).toContain(`${method}:`);
    }
    for (const channel of [
      "resourcePluginList",
      "resourcePluginInspectLocal",
      "resourcePluginMarketplaceLoad",
      "resourcePluginMarketplaceList",
      "resourcePluginMarketplaceAdd",
      "resourcePluginMarketplaceSelect",
      "resourcePluginMarketplaceRefresh",
      "resourcePluginMarketplaceRemove",
      "resourcePluginMarketplaceReorder",
      "resourcePluginRuntimeMarketplace",
      "resourcePluginRuntimeInstall",
      "resourcePluginInstall",
      "resourcePluginUpdate",
      "resourcePluginEnable",
      "resourcePluginRemove",
    ]) {
      expect(apiSource).toContain(channel);
      expect(preloadSource).toContain(`IPC.${channel}`);
      expect(mainProcessSource).toContain(`IPC.${channel}`);
    }
    expect(mainProcessSource).toContain("new ArtemisPluginService({");
    expect(mainProcessSource).toContain('"plugins"');
    expect(mainProcessSource).toContain('"plugins.json"');
    expect(mainProcessSource).toContain('"plugin-marketplaces.json"');
    expect(mainProcessSource).toContain(
      "bundledArtifactRoot: bundledArtifactPluginsPath()",
    );
    expect(mainProcessSource).toContain(
      'join(process.resourcesPath, "resources", "bundled-artifact-plugins")',
    );
    expect(resourceCenterSource).toContain(
      "managedMcpIds.has(server.config.id)",
    );
    expect(resourceCenterSource).toContain("managedSkillNames.has(skill.name)");
    expect(resourceCenterSource).toContain(
      '["plugins", "mcp", "skills"] as const',
    );
    expect(resourceCenterSource).not.toContain('managementTab === "apps"');
    expect(resourceCenterSource).not.toContain(
      'managementTab === "connectors"',
    );
    expect(resourceCenterSource).toContain("<PluginConnectionDialog");
    expect(resourceCenterSource).toContain("authorizeMcpServer(serverId)");
    const labelsStart = resourceCenterSource.indexOf("const labels =");
    const labelsEnd = resourceCenterSource.indexOf(
      "function CatalogIcon",
      labelsStart,
    );
    const visibleLabels = resourceCenterSource.slice(labelsStart, labelsEnd);
    expect(visibleLabels).not.toMatch(
      /:\s*["'`][^"'`\n]*(?:Codex|OpenAI)[^"'`\n]*["'`]/u,
    );
    expect(resourceCenterSource).toContain("function pluginPageText");
    expect(resourceCenterSource).toContain('? result.warnings.join("\\n")');
    expect(resourceCenterSource).not.toContain(
      't.pluginWarnings.replace("{count}"',
    );
    expect(resourceCenterSource.match(/trust\.repository/gu)).toHaveLength(3);
    expect(resourceCenterSource).toContain(
      "`${source.displayName} · ${source.repository}`",
    );
    expect(resourceCenterSource).toContain('plugin.warnings.join(" · ")');
    expect(resourceCenterSource).toContain('plugin.unsupported.join(", ")');
    expect(resourceCenterSource).toContain("description={item.source}");
    expect(resourceCenterSource).toContain(
      "description={`${source.repository}${source.offline",
    );
    expect(resourceCenterSource).toContain(
      "pluginPageText(localizedPluginText(plugin, locale).displayName)",
    );
    expect(resourceCenterSource).toContain("pluginPageText(message)");
    expect(resourceCenterSource).toContain(
      "pluginPageText(server.config.name)",
    );
    expect(resourceCenterSource).toContain("marketplaceSourceLabel(source)");
    expect(resourceCenterSource).toContain("t.marketplaceStale");
    expect(resourceCenterSource).toContain("pluginSkillConflict(plugin)");
    expect(resourceCenterSource).toContain(
      "plugin.source.pluginName === skill.name",
    );
    expect(resourceCenterSource).toContain("pluginsForMarketplace(source.id)");
    expect(resourceCenterSource).not.toContain(
      "pluginsForMarketplace(source.id, false)",
    );
    expect(resourceCenterSource).toContain("marketplaceGroups.length === 0");
    expect(resourceCenterSource).toContain("<ManagementRow");
    expect(resourceCenterSource).toContain(
      "resource-marketplace-remove-button",
    );
    expect(resourceCenterSource).toContain("label={`${t.removeMarketplace}:");
    expect(stylesSource).toContain(".plugin-market-source");
    expect(resourceCenterSource).not.toContain("{marketplace.name}");
    expect(resourceCenterSource).toContain(
      "(skill) => !managedSkillNames.has(skill.name)",
    );
    expect(apiSource).toContain("iconDataUrl?: string;");
    expect(resourceCenterSource).toContain("function visualForPlugin");
    expect(resourceCenterSource).toContain(
      "iconDataUrl: bundled?.iconDataUrl ?? plugin.iconDataUrl",
    );
    expect(resourceCenterSource).toMatch(
      /plugin\.source\.kind === "builtin"\s*\|\|\s*plugin\.source\.kind === "bundled"\s*\|\|\s*plugin\.source\.kind === "runtime"[\s\S]*?\? undefined[\s\S]*?: sourceId/u,
    );
    expect(mainProcessSource).toContain("MCP server is managed by plugin");
    const skillEnableHandler = mainProcessSource.slice(
      mainProcessSource.indexOf("IPC.resourceSkillEnable"),
      mainProcessSource.indexOf("IPC.resourceSkillRemove"),
    );
    const skillRemoveHandler = mainProcessSource.slice(
      mainProcessSource.indexOf("IPC.resourceSkillRemove"),
      mainProcessSource.indexOf("IPC.resourcePluginList"),
    );
    expect(skillEnableHandler).not.toContain("Skill is managed by plugin");
    expect(skillRemoveHandler).toContain("Skill is managed by plugin");
    expect(mainProcessSource).toContain("current.url !== previous.url");
    expect(mainProcessSource).toContain("reconcileManagedPluginSkills(");
    expect(mainProcessSource).toContain("previousSkillState");
    expect(resourceCenterSource).toContain("marketplaceStateCache");
    expect(resourceCenterSource).toContain("runtimeMarketplaceCache");
    expect(resourceCenterSource).toContain("void runtimeRequest");
    expect(resourceCenterSource).toContain("void marketplaceRequest");
    expect(resourceCenterSource).not.toContain(
      "Promise.allSettled([marketplaceRequest, runtimeRequest])",
    );
    expect(resourceCenterSource).not.toContain(
      ".filter((plugin) => plugin.installable)",
    );
    expect(resourceCenterSource).toContain("plugin-market-diagnostic");
    expect(resourceCenterSource).toContain("Boolean(conflict)");
    expect(resourceCenterSource).toContain("title={item.name}");
    expect(resourceCenterSource).toContain(
      'resourceIconName(skill.name, "skill", {',
    );
    expect(resourceIconsSource).toContain(
      "onError={() => setImageFailed(true)}",
    );
    expect(resourceIconsSource).toContain("data-icon={semanticIcon}");
    expect(resourceIconsSource).toContain('from "@artemis/ui/icons"');
    expect(resourceIconsSource).toContain("ArtemisIcon");
    expect(resourceIconsSource).not.toContain("@phosphor-icons/react");
    expect(stylesSource).not.toContain("--resource-icon-accent");
    expect(stylesSource).not.toContain(
      ".resource-avatar[data-icon] .resource-semantic-icon path[opacity]",
    );
    expect(resourceCenterSource).toContain("plugin.iconDataUrl");
    expect(stylesSource).not.toContain(
      ".resource-installed-icon-button::after",
    );
    expect(stylesSource).not.toContain(".resource-runtime-banner");
    expect(runtimeSource).toContain('name: "load_workspace_dependencies"');
    expect(runtimeSource).toContain("resolveCodexWorkspaceDependencies()");
    expect(agentProcessSource).toContain("ARTEMIS_CODEX_RUNTIME_ROOT");
  });
  it("starts OAuth only after an explicit enable action needs authorization", () => {
    expect(mainProcessSource).toContain(
      'status.state === "authorization-required"',
    );
    const saveMcpStart = mainProcessSource.indexOf(
      "async function saveMcpConfiguration",
    );
    const saveMcpEnd = mainProcessSource.indexOf(
      "async function refreshTrustedExtensions",
      saveMcpStart,
    );
    expect(mainProcessSource.slice(saveMcpStart, saveMcpEnd)).toContain(
      "await connectMcpServer(saved, true, connectionOptions)",
    );

    const pluginEnableStart = mainProcessSource.indexOf(
      "IPC.resourcePluginEnable",
    );
    const pluginEnableEnd = mainProcessSource.indexOf(
      "IPC.resourcePluginRemove",
      pluginEnableStart,
    );
    expect(mainProcessSource.slice(pluginEnableStart, pluginEnableEnd)).toMatch(
      /reconnectEnabledMcpServers\([\s\S]*?,\s*true,?\s*\)/u,
    );

    const startupStart = mainProcessSource.indexOf(
      "async function initializeOptionalCapabilities",
    );
    const startupEnd = mainProcessSource.indexOf(
      "function pathIsInside",
      startupStart,
    );
    const startupSource = mainProcessSource.slice(startupStart, startupEnd);
    expect(startupSource).not.toContain("authorizeMcpServer(");
    expect(startupSource).toContain("connectMcpServer(config)");
    expect(startupSource).not.toContain("connectMcpServer(config, true)");
  });
  it("keeps a manually enabled stdio MCP enabled when its connection fails", () => {
    const saveMcpStart = mainProcessSource.indexOf(
      "async function saveMcpConfiguration",
    );
    const saveMcpEnd = mainProcessSource.indexOf(
      "async function refreshTrustedExtensions",
      saveMcpStart,
    );
    const saveMcpSource = mainProcessSource.slice(saveMcpStart, saveMcpEnd);

    expect(saveMcpSource).toContain("rejectConnectionFailure = false");
    expect(saveMcpSource).toContain(
      'rejectConnectionFailure || saved.transport !== "stdio"',
    );
    expect(saveMcpSource).toContain("remains enabled but did not connect");
  });
  it("waits for cold Registry npm MCP startup and rejects failed connections", () => {
    const connectStart = mainProcessSource.indexOf(
      "async function connectMcpServer",
    );
    const connectEnd = mainProcessSource.indexOf(
      "async function ensureGoogleMcpReady",
      connectStart,
    );
    const connectSource = mainProcessSource.slice(connectStart, connectEnd);
    expect(connectSource).toContain('status.state === "failed"');
    expect(connectSource).toContain("throw new Error(");

    const installStart = mainProcessSource.indexOf("IPC.resourceMcpInstall");
    const installEnd = mainProcessSource.indexOf(
      "IPC.resourceSkillSearch",
      installStart,
    );
    const installSource = mainProcessSource.slice(installStart, installEnd);
    expect(installSource).toContain("MCP_REGISTRY_NPM_STARTUP_TIMEOUT_MS");
    expect(installSource).toContain("startupTimeoutMs:");
    expect(installSource).toMatch(
      /saveMcpConfiguration\([\s\S]*?MCP_REGISTRY_NPM_STARTUP_TIMEOUT_MS[\s\S]*?\n\s*true,\n\s*\);/u,
    );
  });
  it("lets users edit global AGENTS.md and selectively import other agents", () => {
    expect(settingsSource).toContain("settings.globalAgents.content");
    expect(settingsSource).toContain("window.artemis.saveGlobalAgents");
    expect(settingsSource).toContain("window.artemis.scanConfigurationImports");
    expect(settingsSource).toContain("window.artemis.importConfiguration");
    expect(settingsSource).toContain('"Codex"');
    expect(settingsSource).toContain('"OpenCode"');
    expect(settingsSource).toContain('"Claude Code"');
  });
  it("edits an installed stdio MCP server with structured Codex-style fields", () => {
    expect(apiSource).toContain("env: Record<string, string>;");
    expect(apiSource).toContain("envVars: string[];");
    expect(mcpServerEditorSource).toContain("server.config.command");
    expect(mcpServerEditorSource).toContain("server.config.args");
    expect(mcpServerEditorSource).toContain("server.config.env");
    expect(mcpServerEditorSource).toContain("server.config.envVars");
    expect(mcpServerEditorSource).toContain("server.config.workspacePath");
    expect(mcpServerEditorSource).toMatch(/argumentsList\.map\(/u);
    expect(mcpServerEditorSource).toMatch(/environment\.map\(/u);
    expect(mcpServerEditorSource).toMatch(/environmentVariables\.map\(/u);
    expect(mcpServerEditorSource).not.toContain(
      "MCP arguments must be a JSON string array",
    );
    expect(mcpServerEditorSource).toContain("window.artemis.saveMcpServer");
    expect(mcpServerEditorSource).toContain("window.artemis.removeMcpServer");
  });
  it("omits identity and transport controls from the MCP editor", () => {
    expect(mcpServerEditorSource).not.toContain(
      "<strong>{t.serverId}</strong>",
    );
    expect(mcpServerEditorSource).not.toContain(
      "<strong>{t.serverName}</strong>",
    );
    expect(mcpServerEditorSource).not.toContain(
      "<strong>{t.transport}</strong>",
    );
    expect(mcpServerEditorSource).not.toContain(
      '<CodexSelect<McpServerConfig["transport"]>',
    );
  });
  it("moves plugin and extension installation out of Settings", () => {
    const labelIndex = resourceCenterSource.lastIndexOf("{t.trustExtension}");
    expect(labelIndex).toBeGreaterThan(-1);
    const buttonIndex = resourceCenterSource.lastIndexOf("<Button", labelIndex);
    const trustButton = resourceCenterSource.slice(buttonIndex, labelIndex);

    expect(trustButton).toContain(
      "onClick={() => runResourceOperation(trustExtension)}",
    );
    expect(resourceCenterSource).toContain('mode === "add-plugin"');
    expect(resourceCenterSource).toContain("{t.gitMarketplace}");
    expect(resourceCenterSource).toContain("{t.offlineMarketplace}");
    expect(resourceCenterSource).toContain(
      "inspectOfflineArtemisPluginMarketplace",
    );
    expect(resourceCenterSource).toContain(
      "addOfflineArtemisPluginMarketplace",
    );
    expect(resourceCenterSource).toContain("{t.localPlugin}");
    expect(settingsSource).not.toContain("window.artemis.trustExtension");
    expect(settingsSource).not.toContain("window.artemis.retrustExtension");
  });
});

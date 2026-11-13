import { join } from "node:path";
import { app } from "electron";
import { getPlatformContract } from "@artemis/platform";
import {
  type InstalledSkill,
  type InstalledArtemisPlugin,
  type SettingsSnapshot,
} from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
import { defaultUserName } from "./profile-name.js";
type Dependencies = Pick<
  ApplicationServices,
  | "settingsStore"
  | "globalInstructionsStore"
  | "mcpConfigStore"
  | "mcpClientManager"
  | "trustedExtensionManager"
  | "getModelSettingsSnapshot"
  | "agentConcurrencyStatus"
  | "currentLocale"
  | "releaseUpdateManager"
  | "store"
  | "resourceCatalogService"
  | "artemisPluginService"
  | "getHooksService"
>;
export function createSettingsSnapshot(services: Dependencies) {
  const {
    getModelSettingsSnapshot,
    agentConcurrencyStatus,
    currentLocale,
    getHooksService,
  } = services;
  async function getSettingsSnapshot(): Promise<SettingsSnapshot> {
    if (
      !services.settingsStore ||
      !services.globalInstructionsStore ||
      !services.mcpConfigStore ||
      !services.mcpClientManager ||
      !services.trustedExtensionManager
    ) {
      throw new Error("Agent settings are not ready.");
    }
    const contract = getPlatformContract();
    const [
      modelSettings,
      language,
      theme,
      approvalPolicy,
      localFullAccess,
      shellConfiguration,
      mcpServers,
      globalAgents,
      agentConcurrency,
      profileAvatar,
      profileName,
      projectOrder,
      projectThreadOrder,
      collapsedProjectIds,
      expandedProjectIds,
      projectSidebarWidth,
      temporaryConversationsOpen,
      workspaceDockWidth,
    ] = await Promise.all([
      getModelSettingsSnapshot(),
      services.settingsStore.languagePreference(),
      services.settingsStore.themePreference(),
      services.settingsStore.approvalPolicy(),
      services.settingsStore.localFullAccess(),
      services.settingsStore.shellRuntimeConfiguration(),
      getMcpServerStatuses(),
      services.globalInstructionsStore.snapshot(),
      agentConcurrencyStatus(false),
      services.settingsStore.profileAvatar(),
      services.settingsStore.profileName(),
      services.settingsStore.projectOrder(),
      services.settingsStore.projectThreadOrder(),
      services.settingsStore.collapsedProjectIds(),
      services.settingsStore.expandedProjectIds(),
      services.settingsStore.projectSidebarWidth(),
      services.settingsStore.temporaryConversationsOpen(),
      services.settingsStore.workspaceDockWidth(),
    ]);
    return {
      platform: contract.platform,
      encryptionAvailable: services.settingsStore.encryptionAvailable,
      language,
      theme,
      material: await services.settingsStore.materialPreference(),
      preventSleep: await services.settingsStore.preventSleepPreference(),
      composerPredictions:
        await services.settingsStore.composerPredictionsPreference(),
      resolvedLocale: currentLocale(),
      approvalPolicy,
      localFullAccess,
      shell: shellConfiguration,
      fullAccessAvailable: contract.sandbox.available,
      ...modelSettings,
      mcpServers,
      globalAgents,
      trustedExtensions: services.trustedExtensionManager.status(),
      update: services.releaseUpdateManager?.getStatus() ?? {
        state: "disabled",
        currentVersion: app.getVersion(),
        rollbackAvailable: false,
      },
      agentConcurrency,
      // Metadata only — dedicated instructions stay off snapshots (D#152).
      // Policies ride along so the settings list can badge model/tool state.
      customAgents: (services.store?.listCustomAgents() ?? []).map(
        (definition) => ({
          id: definition.id,
          revision: definition.revision,
          name: definition.name,
          description: definition.description,
          color: definition.color,
          enabled: definition.enabled,
          scope: definition.scope,
          projectIds:
            services.store?.listCustomAgentProjectIds(definition.id) ?? [],
          modelPolicy: definition.modelPolicy,
          thinkingPolicy: definition.thinkingPolicy,
          toolPolicy: definition.toolPolicy,
          allowAutomaticInvocation: definition.allowAutomaticInvocation,
          triggers: definition.triggers,
          createdAt: definition.createdAt,
          updatedAt: definition.updatedAt,
        }),
      ),
      ...(profileAvatar === undefined ? {} : { profileAvatar }),
      ...(profileName === undefined ? {} : { profileName }),
      defaultUserName: defaultUserName(),
      projectOrder,
      projectThreadOrder,
      collapsedProjectIds,
      expandedProjectIds,
      ...(projectSidebarWidth === undefined ? {} : { projectSidebarWidth }),
      temporaryConversationsOpen,
      ...(workspaceDockWidth === undefined ? {} : { workspaceDockWidth }),
    };
  }

  async function getMcpServerStatuses(): Promise<
    SettingsSnapshot["mcpServers"]
  > {
    if (!services.mcpConfigStore || !services.mcpClientManager) {
      throw new Error("MCP services are not ready.");
    }
    return services.mcpClientManager.status(
      await services.mcpConfigStore.listAvailable(),
    );
  }

  async function installedSkillsWithState(): Promise<InstalledSkill[]> {
    if (!services.resourceCatalogService || !services.settingsStore) {
      throw new Error("Resource catalog is not ready.");
    }
    const comparable = (value: string) =>
      process.platform === "win32" ? value.toLowerCase() : value;
    const disabled = new Set(
      (await services.settingsStore.disabledSkillFiles()).map(comparable),
    );
    return (await services.resourceCatalogService.listInstalledSkills()).map(
      (skill) => ({
        ...skill,
        enabled: !disabled.has(comparable(join(skill.path, "SKILL.md"))),
      }),
    );
  }

  async function pluginsWithHookState(): Promise<InstalledArtemisPlugin[]> {
    const plugins =
      (await services.artemisPluginService?.listInstalled()) ?? [];
    return Promise.all(
      plugins.map(async (plugin) => ({
        ...plugin,
        ...(plugin.hasHooks
          ? { hooksEnabled: await getHooksService().pluginEnabled(plugin.id) }
          : {}),
      })),
    );
  }
  return {
    getSettingsSnapshot,
    getMcpServerStatuses,
    installedSkillsWithState,
    pluginsWithHookState,
  };
}

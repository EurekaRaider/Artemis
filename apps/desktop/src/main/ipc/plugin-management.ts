import { join } from "node:path";
import {
  IPC,
  type ArtemisPluginMarketplace,
  type ArtemisPluginMarketplaceState,
  type ArtemisPluginMutationResult,
  type ArtemisPluginSource,
} from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "artemisPluginService"
  | "ipcMain"
  | "resourceInstallOperationId"
  | "publishResourceInstallProgress"
  | "installOfficeSuite"
  | "artemisPluginMutationResult"
  | "computerUseRuntime"
  | "enableManagedPluginSkills"
  | "mcpConfigStore"
  | "reconnectEnabledMcpServers"
  | "applyAgentRuntime"
  | "installedSkillsWithState"
  | "getHooksService"
  | "disconnectMcpServers"
  | "cleanupRemovedMcpAuthentication"
  | "reconcileManagedPluginSkills"
  | "settingsStore"
  | "computerUseHost"
  | "computerUseServerId"
  | "connectorService"
>;

export function registerPluginManagementIpc(services: Dependencies): void {
  const {
    ipcMain,
    resourceInstallOperationId,
    publishResourceInstallProgress,
    installOfficeSuite,
    artemisPluginMutationResult,
    enableManagedPluginSkills,
    reconnectEnabledMcpServers,
    applyAgentRuntime,
    installedSkillsWithState,
    getHooksService,
    disconnectMcpServers,
    cleanupRemovedMcpAuthentication,
    reconcileManagedPluginSkills,
  } = services;

  ipcMain.handle(
    IPC.resourcePluginMarketplaceSelect,
    async (
      _event,
      sourceIdInput: string,
    ): Promise<ArtemisPluginMarketplaceState> => {
      if (!services.artemisPluginService) {
        throw new Error("Plugin service is not ready.");
      }
      return services.artemisPluginService.selectMarketplace(
        String(sourceIdInput ?? "").trim(),
      );
    },
  );
  ipcMain.handle(
    IPC.resourcePluginMarketplaceRefresh,
    async (
      event,
      sourceIdInput: string,
      operationIdInput: string,
    ): Promise<ArtemisPluginMarketplaceState> => {
      if (!services.artemisPluginService) {
        throw new Error("Plugin service is not ready.");
      }
      const sourceId = String(sourceIdInput ?? "").trim();
      const operationId = resourceInstallOperationId(operationIdInput);
      const publish = (percent: number) =>
        publishResourceInstallProgress(event.sender, {
          operationId,
          kind: "plugin",
          resourceId: sourceId,
          percent,
        });
      publish(5);
      return services.artemisPluginService.refreshMarketplaceSource(
        sourceId,
        (percent) => publish(10 + percent * 0.9),
      );
    },
  );
  ipcMain.handle(
    IPC.resourcePluginMarketplaceRemove,
    async (
      _event,
      sourceIdInput: string,
    ): Promise<ArtemisPluginMarketplaceState> => {
      if (!services.artemisPluginService) {
        throw new Error("Plugin service is not ready.");
      }
      return services.artemisPluginService.removeMarketplace(
        String(sourceIdInput ?? "").trim(),
      );
    },
  );
  ipcMain.handle(
    IPC.resourcePluginMarketplaceReorder,
    async (
      _event,
      sourceIdsInput: unknown,
    ): Promise<ArtemisPluginMarketplaceState> => {
      if (!services.artemisPluginService || !Array.isArray(sourceIdsInput)) {
        throw new Error("Plugin marketplace order is invalid.");
      }
      return services.artemisPluginService.reorderMarketplaces(
        sourceIdsInput.map((sourceId) => String(sourceId ?? "").trim()),
      );
    },
  );
  ipcMain.handle(
    IPC.resourcePluginRuntimeMarketplace,
    async (): Promise<ArtemisPluginMarketplace | undefined> => {
      if (!services.artemisPluginService) {
        throw new Error("Plugin service is not ready.");
      }
      const marketplace =
        await services.artemisPluginService.loadBundledArtifactMarketplace();
      if (!marketplace) return undefined;
      return {
        ...marketplace,
        plugins: marketplace.plugins.filter(
          (plugin) =>
            !(
              ["bundled", "runtime"].includes(plugin.source.kind) &&
              ["documents", "spreadsheets", "presentations", "pdf"].includes(
                plugin.name,
              )
            ),
        ),
      };
    },
  );
  ipcMain.handle(
    IPC.resourcePluginRuntimeInstall,
    async (): Promise<ArtemisPluginMutationResult> => {
      await installOfficeSuite();
      return artemisPluginMutationResult([]);
    },
  );
  ipcMain.handle(
    IPC.resourcePluginInstall,
    async (
      event,
      source: ArtemisPluginSource,
      operationIdInput: string,
    ): Promise<ArtemisPluginMutationResult> => {
      if (!services.artemisPluginService) {
        throw new Error("Plugin service is not ready.");
      }
      if (
        (source.kind === "bundled" || source.kind === "runtime") &&
        ["documents", "spreadsheets", "presentations", "pdf"].includes(
          source.pluginName,
        )
      ) {
        await installOfficeSuite();
        return artemisPluginMutationResult([]);
      }
      const operationId = resourceInstallOperationId(operationIdInput);
      const resourceId =
        source?.kind === "git" ||
        source?.kind === "builtin" ||
        source?.kind === "bundled" ||
        source?.kind === "runtime"
          ? source.pluginName
          : source?.path;
      const publish = (percent: number) =>
        publishResourceInstallProgress(event.sender, {
          operationId,
          kind: "plugin",
          resourceId: String(resourceId ?? "Plugin"),
          percent,
        });
      publish(5);
      if (source.kind === "builtin" && source.pluginName === "computer-use") {
        if (!services.computerUseRuntime)
          throw new Error("Computer Use is unavailable on this platform.");
        await services.computerUseRuntime.install();
        const installed = (
          await services.artemisPluginService.listInstalled()
        ).find((plugin) => plugin.source.kind === "builtin");
        if (installed) {
          await enableManagedPluginSkills(installed.skillNames);
          await reconnectEnabledMcpServers(
            (await services.mcpConfigStore!.list()).filter((config) =>
              installed.mcpServerIds.includes(config.id),
            ),
          );
        }
        await applyAgentRuntime();
        publish(100);
        return artemisPluginMutationResult([]);
      }
      const installed = await services.artemisPluginService.install(
        source,
        (percent) => publish(10 + percent * 0.8),
      );
      await enableManagedPluginSkills(installed.plugin.skillNames);
      await reconnectEnabledMcpServers(
        (await services.mcpConfigStore!.list()).filter((config) =>
          installed.plugin.mcpServerIds.includes(config.id),
        ),
      );
      await applyAgentRuntime();
      publish(100);
      return artemisPluginMutationResult(installed.warnings);
    },
  );
  ipcMain.handle(
    IPC.resourcePluginUpdate,
    async (
      event,
      pluginIdInput: string,
      operationIdInput: string,
    ): Promise<ArtemisPluginMutationResult> => {
      if (!services.artemisPluginService || !services.mcpConfigStore) {
        throw new Error("Plugin service is not ready.");
      }
      const pluginId = String(pluginIdInput ?? "").trim();
      const existing =
        await services.artemisPluginService.installedById(pluginId);
      if (!existing) throw new Error("Installed plugin was not found.");
      const operationId = resourceInstallOperationId(operationIdInput);
      const publish = (percent: number) =>
        publishResourceInstallProgress(event.sender, {
          operationId,
          kind: "plugin",
          resourceId: existing.displayName,
          percent,
        });
      if (
        existing.source.kind === "builtin" &&
        existing.source.pluginName === "computer-use"
      ) {
        if (!services.computerUseRuntime)
          throw new Error("Computer Use is unavailable on this platform.");
        await services.computerUseRuntime.install();
        await applyAgentRuntime();
        publish(100);
        return artemisPluginMutationResult([]);
      }
      const before = await services.mcpConfigStore.list();
      const scopedIds = new Set(existing.mcpServerIds);
      const existingSkillNames = new Set(existing.skillNames);
      const previousSkillState = new Map(
        (await installedSkillsWithState())
          .filter((skill) => existingSkillNames.has(skill.name))
          .map((skill) => [skill.name, skill.enabled]),
      );
      const pluginEnabled =
        (Boolean(existing.skins?.length) && existing.skinsEnabled !== false) ||
        Boolean(existing.formatMigrationEnabledMcpIds?.length) ||
        (existing.hasHooks &&
          (await getHooksService().pluginEnabled(pluginId))) ||
        [...previousSkillState.values()].some(Boolean) ||
        before.some((config) => scopedIds.has(config.id) && config.enabled);
      publish(5);
      await disconnectMcpServers(existing.mcpServerIds);
      try {
        const updated = await services.artemisPluginService.update(
          pluginId,
          (percent) => publish(10 + percent * 0.8),
          { newServicesEnabled: pluginEnabled },
        );
        const after = await services.mcpConfigStore.list();
        await cleanupRemovedMcpAuthentication(before, after, scopedIds);
        await reconcileManagedPluginSkills(
          existing.skillNames,
          updated.plugin.skillNames,
          previousSkillState,
          pluginEnabled,
        );
        await reconnectEnabledMcpServers(
          after.filter((config) =>
            updated.plugin.mcpServerIds.includes(config.id),
          ),
        );
        await applyAgentRuntime();
        publish(100);
        return artemisPluginMutationResult(updated.warnings);
      } catch (error) {
        await reconnectEnabledMcpServers(
          before.filter((config) => scopedIds.has(config.id)),
        );
        await applyAgentRuntime();
        throw error;
      }
    },
  );
  ipcMain.handle(
    IPC.resourcePluginEnable,
    async (
      _event,
      pluginIdInput: string,
      enabledInput: boolean,
    ): Promise<ArtemisPluginMutationResult> => {
      if (
        !services.artemisPluginService ||
        !services.mcpConfigStore ||
        !services.settingsStore ||
        typeof enabledInput !== "boolean"
      ) {
        throw new Error("Plugin service is not ready.");
      }
      const pluginId = String(pluginIdInput ?? "").trim();
      const existing =
        await services.artemisPluginService.installedById(pluginId);
      if (!existing) throw new Error("Installed plugin was not found.");
      if (enabledInput && existing.formatMigrationRequired)
        throw new Error(
          "Update this plugin to the Artemis native format before enabling it.",
        );
      const installedSkills = await installedSkillsWithState();
      const skillNames = new Set(existing.skillNames);
      const ownedSkills = installedSkills.filter((skill) =>
        skillNames.has(skill.name),
      );
      if (ownedSkills.length !== existing.skillNames.length) {
        throw new Error("A plugin-managed Skill is missing.");
      }
      const previousSkillState = new Map(
        ownedSkills.map((skill) => [skill.id, skill.enabled]),
      );
      const previousMcp = await services.mcpConfigStore.list();
      const mcpIds = new Set(existing.mcpServerIds);
      if (
        previousMcp.filter((config) => mcpIds.has(config.id)).length !==
        existing.mcpServerIds.length
      ) {
        throw new Error("A plugin-managed MCP server is missing.");
      }
      const nextMcp = previousMcp.map((config) =>
        mcpIds.has(config.id) ? { ...config, enabled: enabledInput } : config,
      );
      if (!enabledInput)
        await getHooksService().setPluginEnabled(pluginId, false);
      if (existing.mcpServerIds.includes(services.computerUseServerId ?? ""))
        services.computerUseHost?.dispose();
      await disconnectMcpServers(existing.mcpServerIds);
      try {
        for (const skill of ownedSkills) {
          await services.settingsStore.setSkillEnabled(
            join(skill.path, "SKILL.md"),
            enabledInput,
          );
        }
        await services.mcpConfigStore.replaceAll(nextMcp);
        if (enabledInput) {
          await reconnectEnabledMcpServers(
            nextMcp.filter((config) => mcpIds.has(config.id)),
            true,
          );
        }
        await applyAgentRuntime();
        await getHooksService().setPluginEnabled(pluginId, enabledInput);
        if (existing.skins?.length)
          await services.artemisPluginService.setSkinsEnabled(
            pluginId,
            enabledInput,
          );
        return artemisPluginMutationResult([]);
      } catch (error) {
        if (existing.skins?.length && !existing.formatMigrationRequired)
          await services.artemisPluginService
            .setSkinsEnabled(pluginId, existing.skinsEnabled !== false)
            .catch(() => undefined);
        for (const skill of ownedSkills) {
          await services.settingsStore
            .setSkillEnabled(
              join(skill.path, "SKILL.md"),
              previousSkillState.get(skill.id) ?? true,
            )
            .catch(() => undefined);
        }
        await services.mcpConfigStore
          .replaceAll(previousMcp)
          .catch(() => undefined);
        await reconnectEnabledMcpServers(
          previousMcp.filter(
            (config) => mcpIds.has(config.id) && config.enabled,
          ),
        );
        await applyAgentRuntime();
        throw error;
      }
    },
  );
  ipcMain.handle(
    IPC.resourcePluginRemove,
    async (
      _event,
      pluginIdInput: string,
    ): Promise<ArtemisPluginMutationResult> => {
      if (!services.artemisPluginService || !services.mcpConfigStore) {
        throw new Error("Plugin service is not ready.");
      }
      const pluginId = String(pluginIdInput ?? "").trim();
      const existing =
        await services.artemisPluginService.installedById(pluginId);
      if (!existing) throw new Error("Installed plugin was not found.");
      await getHooksService().removePlugin(pluginId);
      const before = await services.mcpConfigStore.list();
      const scopedIds = new Set(existing.mcpServerIds);
      await disconnectMcpServers(existing.mcpServerIds);
      try {
        if (
          existing.source.kind === "builtin" &&
          existing.source.pluginName === "computer-use"
        )
          await services.computerUseRuntime?.uninstall();
        const removed = await services.artemisPluginService.remove(pluginId);
        const after = await services.mcpConfigStore.list();
        await cleanupRemovedMcpAuthentication(before, after, scopedIds);
        await enableManagedPluginSkills(existing.skillNames);
        for (const config of before.filter(
          (c) => scopedIds.has(c.id) && c.connector,
        )) {
          await services.connectorService?.disconnect(config.id);
        }
        await applyAgentRuntime();
        return artemisPluginMutationResult(removed.warnings);
      } catch (error) {
        await reconnectEnabledMcpServers(
          before.filter((config) => scopedIds.has(config.id)),
        );
        await applyAgentRuntime();
        throw error;
      }
    },
  );
}

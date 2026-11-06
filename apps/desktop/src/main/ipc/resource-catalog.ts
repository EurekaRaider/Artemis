import { join } from "node:path";
import { BrowserWindow, dialog } from "electron";
import { mainText } from "../settings/i18n.js";
import { I18N_RESOURCES } from "../../shared/i18n/i18n-resources.js";
import {
  IPC,
  type InstalledSkill,
  type McpCatalogInstallRequest,
  type McpCatalogItem,
  type SettingsSnapshot,
  type SkillCatalogItem,
} from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "currentLocale"
  | "restoreResourceDialogFocus"
  | "ipcMain"
  | "getMcpServerStatuses"
  | "resourceCatalogService"
  | "mcpConfigStore"
  | "mcpClientManager"
  | "mcpSecretStore"
  | "resourceInstallOperationId"
  | "publishResourceInstallProgress"
  | "MCP_REGISTRY_NPM_STARTUP_TIMEOUT_MS"
  | "saveMcpConfiguration"
  | "applyAgentRuntime"
  | "installedSkillsWithState"
  | "settingsStore"
  | "mainWindow"
  | "resetAgentThreadsForToolChange"
  | "artemisPluginService"
>;

export function registerResourceCatalogIpc(services: Dependencies): void {
  const {
    currentLocale,
    restoreResourceDialogFocus,
    ipcMain,
    getMcpServerStatuses,
    resourceInstallOperationId,
    publishResourceInstallProgress,
    MCP_REGISTRY_NPM_STARTUP_TIMEOUT_MS,
    saveMcpConfiguration,
    applyAgentRuntime,
    installedSkillsWithState,
    resetAgentThreadsForToolChange,
  } = services;

  ipcMain.handle(
    IPC.resourceConfirm,
    async (event, messageInput: string): Promise<boolean> => {
      const message = String(messageInput ?? "").trim();
      if (!message || message.length > 1_024) {
        throw new Error("Resource confirmation message is invalid.");
      }
      const owner = BrowserWindow.fromWebContents(event.sender);
      if (!owner || owner.isDestroyed()) return false;
      try {
        const result = await dialog.showMessageBox(owner, {
          type: "question",
          buttons: [
            mainText(currentLocale(), "confirm"),
            I18N_RESOURCES[currentLocale()].common.cancel,
          ],
          cancelId: 1,
          defaultId: 0,
          message,
          noLink: true,
        });
        return result.response === 0;
      } finally {
        restoreResourceDialogFocus(event.sender);
      }
    },
  );
  ipcMain.handle(
    IPC.resourceMcpList,
    async (): Promise<SettingsSnapshot["mcpServers"]> => getMcpServerStatuses(),
  );
  ipcMain.handle(
    IPC.resourceMcpSearch,
    async (_event, query: string): Promise<McpCatalogItem[]> => {
      if (!services.resourceCatalogService || !services.mcpConfigStore) {
        throw new Error("Resource catalog is not ready.");
      }

      const normalized = String(query ?? "")
        .trim()
        .slice(0, 200);
      const installed = new Set(
        (await services.mcpConfigStore.list()).map((server) => server.id),
      );
      return services.resourceCatalogService.searchMcp(normalized, installed);
    },
  );
  ipcMain.handle(
    IPC.resourceMcpInstall,
    async (
      event,
      input: McpCatalogInstallRequest,
    ): Promise<SettingsSnapshot> => {
      if (
        !services.resourceCatalogService ||
        !services.mcpConfigStore ||
        !services.mcpClientManager ||
        !services.mcpSecretStore
      ) {
        throw new Error("Resource catalog is not ready.");
      }
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new Error("MCP installation request is invalid.");
      }
      const operationId = resourceInstallOperationId(input.operationId);
      const resourceId = String(input.registryName ?? "").trim();
      const version = String(input.version ?? "").trim();
      const optionId = String(input.optionId ?? "").trim();
      if (
        !resourceId ||
        resourceId.length > 300 ||
        !version ||
        version.length > 128 ||
        !/^(?:remote|npm)-\d{1,3}$/u.test(optionId) ||
        !input.inputValues ||
        typeof input.inputValues !== "object" ||
        Array.isArray(input.inputValues) ||
        Object.keys(input.inputValues).length > 100
      ) {
        throw new Error("MCP installation request is invalid.");
      }
      const publish = (percent: number) =>
        publishResourceInstallProgress(event.sender, {
          operationId,
          kind: "mcp",
          resourceId,
          percent,
        });
      publish(5);
      const resolved = await services.resourceCatalogService.resolveMcpInstall(
        resourceId,
        version,
        optionId,
        input.inputValues,
      );
      if (
        (await services.mcpConfigStore.list()).some(
          (server) => server.id === resolved.config.id,
        )
      ) {
        throw new Error("This MCP server is already installed.");
      }
      const hasSecrets =
        Object.keys(resolved.secrets.env).length > 0 ||
        Object.keys(resolved.secrets.headers).length > 0;
      publish(35);
      if (hasSecrets) {
        await services.mcpSecretStore.set(resolved.config.id, resolved.secrets);
      }
      publish(50);
      try {
        const settings = await saveMcpConfiguration(
          resolved.config,
          undefined,
          resolved.config.transport === "stdio" &&
            resolved.config.command === "npx"
            ? { startupTimeoutMs: MCP_REGISTRY_NPM_STARTUP_TIMEOUT_MS }
            : undefined,
          true,
        );
        publish(100);
        return settings;
      } catch (error) {
        await services.mcpClientManager
          .disconnect(resolved.config.id)
          .catch(() => {});
        await services.mcpConfigStore
          .remove(resolved.config.id)
          .catch(() => {});
        if (hasSecrets) {
          await services.mcpSecretStore
            .delete(resolved.config.id)
            .catch(() => {});
        }
        await applyAgentRuntime().catch(() => {});
        throw error;
      }
    },
  );
  ipcMain.handle(
    IPC.resourceSkillSearch,
    async (_event, query: string): Promise<SkillCatalogItem[]> => {
      if (!services.resourceCatalogService) {
        throw new Error("Resource catalog is not ready.");
      }

      return services.resourceCatalogService.searchSkills(
        String(query ?? "")
          .trim()
          .slice(0, 200),
      );
    },
  );
  ipcMain.handle(IPC.resourceSkillList, async (): Promise<InstalledSkill[]> => {
    return installedSkillsWithState();
  });
  ipcMain.handle(
    IPC.resourceSkillInstall,
    async (
      event,
      skillId: string,
      operationIdInput: string,
    ): Promise<InstalledSkill> => {
      if (!services.resourceCatalogService) {
        throw new Error("Resource catalog is not ready.");
      }
      const operationId = resourceInstallOperationId(operationIdInput);
      const resourceId = String(skillId ?? "").trim();
      const publish = (percent: number) =>
        publishResourceInstallProgress(event.sender, {
          operationId,
          kind: "skill",
          resourceId,
          percent,
        });
      publish(5);
      const installed = await services.resourceCatalogService.installSkill(
        resourceId,
        (percent) => publish(10 + percent * 0.7),
      );
      publish(85);
      await services.settingsStore?.setSkillEnabled(
        join(installed.path, "SKILL.md"),
        true,
      );
      await applyAgentRuntime();
      publish(100);
      return { ...installed, enabled: true };
    },
  );
  ipcMain.handle(
    IPC.resourceSkillInstallLocal,
    async (
      event,
      operationIdInput: string,
    ): Promise<InstalledSkill | undefined> => {
      if (!services.resourceCatalogService || !services.mainWindow) {
        throw new Error("Resource catalog is not ready.");
      }
      const operationId = resourceInstallOperationId(operationIdInput);
      const selection = await dialog.showOpenDialog(services.mainWindow, {
        properties: ["openDirectory"],
        title: mainText(currentLocale(), "selectLocalSkill"),
      });
      restoreResourceDialogFocus(event.sender);
      if (selection.canceled || selection.filePaths.length !== 1)
        return undefined;
      if (!selection.filePaths[0]) return undefined;
      const resourceId = selection.filePaths[0];
      const publish = (percent: number) =>
        publishResourceInstallProgress(event.sender, {
          operationId,
          kind: "skill",
          resourceId,
          percent,
        });
      publish(5);
      const installed = await services.resourceCatalogService.installLocalSkill(
        selection.filePaths[0],
        (percent) => publish(10 + percent * 0.7),
      );
      publish(85);
      await services.settingsStore?.setSkillEnabled(
        join(installed.path, "SKILL.md"),
        true,
      );
      await applyAgentRuntime();
      publish(100);
      return { ...installed, enabled: true };
    },
  );
  ipcMain.handle(
    IPC.resourceSkillEnable,
    async (
      _event,
      skillId: string,
      enabled: boolean,
    ): Promise<InstalledSkill[]> => {
      if (!services.settingsStore) {
        throw new Error("Agent settings are not ready.");
      }
      const installed = await installedSkillsWithState();
      const skill = installed.find((candidate) => candidate.id === skillId);
      if (!skill) throw new Error("Installed Skill was not found.");
      await resetAgentThreadsForToolChange();
      await services.settingsStore.setSkillEnabled(
        join(skill.path, "SKILL.md"),
        Boolean(enabled),
      );
      await applyAgentRuntime();
      return installedSkillsWithState();
    },
  );
  ipcMain.handle(
    IPC.resourceSkillRemove,
    async (_event, skillId: string): Promise<InstalledSkill[]> => {
      if (!services.resourceCatalogService || !services.settingsStore) {
        throw new Error("Resource catalog is not ready.");
      }
      const installed = await installedSkillsWithState();
      const skill = installed.find((candidate) => candidate.id === skillId);
      if (!skill) throw new Error("Installed Skill was not found.");
      const owningPlugin = (
        await services.artemisPluginService?.listInstalled()
      )?.find((plugin) => plugin.skillNames.includes(skill.name));
      if (owningPlugin) {
        throw new Error(
          `Skill is managed by plugin "${owningPlugin.displayName}". Remove the plugin from Resource Center instead.`,
        );
      }
      await resetAgentThreadsForToolChange();
      await services.resourceCatalogService.removeSkill(skill.id);
      await services.settingsStore.setSkillEnabled(
        join(skill.path, "SKILL.md"),
        true,
      );
      await applyAgentRuntime();
      return installedSkillsWithState();
    },
  );
}

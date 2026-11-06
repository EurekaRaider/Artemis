import {
  IPC,
  type McpServerConfig,
  type SettingsSnapshot,
} from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "saveMcpConfiguration"
  | "ipcMain"
  | "mcpConfigStore"
  | "ensureConnectorReady"
  | "mcpClientManager"
  | "resetAgentThreadsForToolChange"
  | "mcpAuthentication"
  | "applyAgentRuntime"
  | "getSettingsSnapshot"
  | "authorizeMcpServer"
  | "settingsStore"
  | "artemisPluginService"
  | "removeMcpAuthentication"
>;

export function registerMcpIpc(services: Dependencies): void {
  const {
    saveMcpConfiguration,
    ipcMain,
    ensureConnectorReady,
    resetAgentThreadsForToolChange,
    mcpAuthentication,
    applyAgentRuntime,
    getSettingsSnapshot,
    authorizeMcpServer,
    removeMcpAuthentication,
  } = services;

  ipcMain.handle(
    IPC.mcpServerSave,
    async (
      _event,
      input: McpServerConfig,
      bearerToken?: string,
      credentialEnv?: Record<string, string>,
    ): Promise<SettingsSnapshot> => {
      return saveMcpConfiguration(
        input,
        bearerToken,
        undefined,
        false,
        credentialEnv,
      );
    },
  );
  let mcpEnableQueue: Promise<unknown> = Promise.resolve();
  ipcMain.handle(
    IPC.mcpServerEnable,
    async (
      _event,
      serverId: string,
      enabled: boolean,
    ): Promise<SettingsSnapshot> => {
      const operation = mcpEnableQueue.then(async () => {
        if (!services.mcpConfigStore) {
          throw new Error("MCP service is not ready.");
        }
        const config = (await services.mcpConfigStore.list()).find(
          (server) => server.id === serverId,
        );
        if (!config) throw new Error("MCP server not found.");
        if (enabled) await ensureConnectorReady(config);
        return saveMcpConfiguration({ ...config, enabled: Boolean(enabled) });
      });
      mcpEnableQueue = operation.catch(() => undefined);
      return operation;
    },
  );
  ipcMain.handle(
    IPC.mcpServerReconnect,
    async (_event, serverId: string): Promise<SettingsSnapshot> => {
      if (!services.mcpConfigStore || !services.mcpClientManager) {
        throw new Error("MCP service is not ready.");
      }
      await resetAgentThreadsForToolChange();
      const config = (await services.mcpConfigStore.list()).find(
        (server) => server.id === serverId,
      );
      if (!config) throw new Error("MCP server not found.");
      await services.mcpClientManager.connect(
        config,
        await mcpAuthentication(config),
      );
      await applyAgentRuntime();
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.mcpServerAuthorize,
    async (_event, serverId: string): Promise<SettingsSnapshot> => {
      if (!services.mcpConfigStore || !services.mcpClientManager) {
        throw new Error("MCP service is not ready.");
      }
      await resetAgentThreadsForToolChange();
      const config = (await services.mcpConfigStore.list()).find(
        (server) => server.id === serverId,
      );
      if (!config) throw new Error("MCP server not found.");
      await authorizeMcpServer(config);
      await applyAgentRuntime();
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.mcpServerRemove,
    async (_event, serverId: string): Promise<SettingsSnapshot> => {
      if (
        !services.mcpConfigStore ||
        !services.mcpClientManager ||
        !services.settingsStore
      ) {
        throw new Error("MCP service is not ready.");
      }
      const config = (await services.mcpConfigStore.list()).find(
        (server) => server.id === serverId,
      );
      const owningPlugin = (
        await services.artemisPluginService?.listInstalled()
      )?.find((plugin) => plugin.mcpServerIds.includes(serverId));
      if (owningPlugin) {
        throw new Error(
          `MCP server is managed by plugin "${owningPlugin.displayName}". Remove the plugin from Resource Center instead.`,
        );
      }
      await resetAgentThreadsForToolChange();
      await services.mcpClientManager.disconnect(serverId);
      await services.mcpConfigStore.remove(serverId);
      if (config) await removeMcpAuthentication(config);
      await applyAgentRuntime();
      return getSettingsSnapshot();
    },
  );
}

import { importMcpServers } from "../mcp/mcp-import.js";
import {
  IPC,
  type ConfigurationImportPreview,
  type ConfigurationImportRequest,
  type ConfigurationImportResult,
} from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "configurationImportService"
  | "ipcMain"
  | "settingsStore"
  | "mcpConfigStore"
  | "mcpClientManager"
  | "validateConfigurationImportRequest"
  | "resetAgentThreadsForToolChange"
  | "mcpAuthentication"
  | "applyAgentRuntime"
  | "getSettingsSnapshot"
>;

export function registerConfigurationImportIpc(services: Dependencies): void {
  const {
    ipcMain,
    validateConfigurationImportRequest,
    resetAgentThreadsForToolChange,
    mcpAuthentication,
    applyAgentRuntime,
    getSettingsSnapshot,
  } = services;

  ipcMain.handle(
    IPC.settingsImportScan,
    async (): Promise<ConfigurationImportPreview> => {
      if (!services.configurationImportService) {
        throw new Error("Configuration import is not ready.");
      }
      return services.configurationImportService.scan();
    },
  );
  ipcMain.handle(
    IPC.settingsImportApply,
    async (
      _event,
      input: ConfigurationImportRequest,
    ): Promise<ConfigurationImportResult> => {
      if (
        !services.configurationImportService ||
        !services.settingsStore ||
        !services.mcpConfigStore ||
        !services.mcpClientManager
      ) {
        throw new Error("Configuration import is not ready.");
      }
      const activeMcpConfigStore = services.mcpConfigStore;
      const activeMcpClientManager = services.mcpClientManager;
      const request = validateConfigurationImportRequest(input);
      await resetAgentThreadsForToolChange();
      const imported =
        await services.configurationImportService.import(request);

      await importMcpServers(imported.mcpServers, imported.summary, {
        list: () => activeMcpConfigStore.list(),
        upsert: (server) => activeMcpConfigStore.upsert(server),
        connect: async (server) =>
          activeMcpClientManager.connect(
            server,
            await mcpAuthentication(server),
          ),
      });

      await applyAgentRuntime();
      return {
        settings: await getSettingsSnapshot(),
        summary: imported.summary,
      };
    },
  );
}

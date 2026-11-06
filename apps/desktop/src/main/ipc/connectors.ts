import {
  type ConnectorConnectInput,
  type ConnectorCatalogEntry,
} from "../../shared/connectors.js";
import { IPC } from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "artemisPluginService"
  | "mcpConfigStore"
  | "ipcMain"
  | "connectorService"
  | "resetAgentThreadsForToolChange"
  | "applyAgentRuntime"
  | "disableConnector"
>;

export function registerConnectorsIpc(services: Dependencies): void {
  const {
    ipcMain,
    resetAgentThreadsForToolChange,
    applyAgentRuntime,
    disableConnector,
  } = services;

  ipcMain.handle(
    IPC.connectorDefinitions,
    async (): Promise<ConnectorCatalogEntry[]> => {
      const installed =
        (await services.artemisPluginService?.listInstalled()) ?? [];
      const catalog =
        (await services.artemisPluginService?.listConnectorDefinitions()) ?? [];
      const configured: ConnectorCatalogEntry[] = (
        (await services.mcpConfigStore?.list()) ?? []
      ).flatMap((config) =>
        config.connector
          ? [
              {
                ...config.connector,
                serverId: config.id,
                installed: true,
                pluginId: installed.find((p) =>
                  p.mcpServerIds.includes(config.id),
                )?.id,
              },
            ]
          : [],
      );
      return [
        ...configured,
        ...catalog.filter(
          (item) => !configured.some((c) => c.serverId === item.serverId),
        ),
      ];
    },
  );
  ipcMain.handle(
    IPC.connectorConnections,
    () => services.connectorService?.list() ?? [],
  );
  const connectConnector = async (
    input: ConnectorConnectInput,
    reconnect = false,
  ) => {
    if (!services.connectorService || !services.mcpConfigStore)
      throw new Error("Connector service is not ready.");
    if (!input || typeof input.serverId !== "string")
      throw new Error("Connector input is invalid.");
    await resetAgentThreadsForToolChange();
    const result = reconnect
      ? await services.connectorService.reconnect(input.serverId)
      : await services.connectorService.connect(input);
    const configs = await services.mcpConfigStore.list();
    await services.mcpConfigStore.replaceAll(
      configs.map((c) =>
        c.id === input.serverId ? { ...c, enabled: true } : c,
      ),
    );
    await applyAgentRuntime();
    return result;
  };
  ipcMain.handle(IPC.connectorConnect, (_event, input: ConnectorConnectInput) =>
    connectConnector(input),
  );
  ipcMain.handle(IPC.connectorReconnect, (_event, id: string) =>
    connectConnector({ serverId: id }, true),
  );
  ipcMain.handle(IPC.connectorCancel, (_event, id: string) =>
    services.connectorService?.cancel(id),
  );
  ipcMain.handle(IPC.connectorDisconnect, async (_event, id: string) => {
    await services.connectorService?.disconnect(id);
    await disableConnector(id);
  });
}

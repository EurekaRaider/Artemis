import { ipcRenderer } from "electron";

import { IPC } from "../../shared/ipc-channels.js";
import type { McpApi } from "../../shared/api/mcp.js";
export const mcpBridge: McpApi = {
  saveMcpServer: (config, bearerToken, credentialEnv) =>
    ipcRenderer.invoke(IPC.mcpServerSave, config, bearerToken, credentialEnv),
  setMcpServerEnabled: (serverId, enabled) =>
    ipcRenderer.invoke(IPC.mcpServerEnable, serverId, enabled),
  reconnectMcpServer: (serverId) =>
    ipcRenderer.invoke(IPC.mcpServerReconnect, serverId),
  authorizeMcpServer: (serverId) =>
    ipcRenderer.invoke(IPC.mcpServerAuthorize, serverId),
  removeMcpServer: (serverId) =>
    ipcRenderer.invoke(IPC.mcpServerRemove, serverId),
  confirmResourceAction: (message) =>
    ipcRenderer.invoke(IPC.resourceConfirm, message),
  listMcpServers: () => ipcRenderer.invoke(IPC.resourceMcpList),
  searchMcpCatalog: (query) => ipcRenderer.invoke(IPC.resourceMcpSearch, query),
  installMcpCatalog: (request) =>
    ipcRenderer.invoke(IPC.resourceMcpInstall, request),
};

import { ipcRenderer } from "electron";

import { IPC } from "../../shared/ipc-channels.js";
import type { IntegrationsApi } from "../../shared/api/integrations.js";
export const integrationsBridge: IntegrationsApi = {
  listArtemisPlugins: () => ipcRenderer.invoke(IPC.resourcePluginList),
  inspectLocalArtemisPlugin: () =>
    ipcRenderer.invoke(IPC.resourcePluginInspectLocal),
  loadArtemisPluginMarketplace: (url, operationId, refresh) =>
    ipcRenderer.invoke(
      IPC.resourcePluginMarketplaceLoad,
      url,
      operationId,
      refresh,
    ),
  getArtemisPluginMarketplaces: (sourceId) =>
    ipcRenderer.invoke(IPC.resourcePluginMarketplaceList, sourceId),
  addArtemisPluginMarketplace: (url, operationId, signingKeyFingerprint) =>
    ipcRenderer.invoke(
      IPC.resourcePluginMarketplaceAdd,
      url,
      operationId,
      signingKeyFingerprint,
    ),
  inspectArtemisPluginMarketplaceTrust: (url) =>
    ipcRenderer.invoke(IPC.resourcePluginMarketplaceTrust, url),
  inspectOfflineArtemisPluginMarketplace: () =>
    ipcRenderer.invoke(IPC.resourcePluginMarketplaceInspectOffline),
  addOfflineArtemisPluginMarketplace: (
    path,
    operationId,
    signingKeyFingerprint,
  ) =>
    ipcRenderer.invoke(
      IPC.resourcePluginMarketplaceAddOffline,
      path,
      operationId,
      signingKeyFingerprint,
    ),
  listConnectorDefinitions: () => ipcRenderer.invoke(IPC.connectorDefinitions),
  listConnectorConnections: () => ipcRenderer.invoke(IPC.connectorConnections),
  connectConnector: (input) => ipcRenderer.invoke(IPC.connectorConnect, input),
  cancelConnectorAuthorization: (id) =>
    ipcRenderer.invoke(IPC.connectorCancel, id),
  reconnectConnector: (id) => ipcRenderer.invoke(IPC.connectorReconnect, id),
  disconnectConnector: (id) => ipcRenderer.invoke(IPC.connectorDisconnect, id),
  selectArtemisPluginMarketplace: (sourceId) =>
    ipcRenderer.invoke(IPC.resourcePluginMarketplaceSelect, sourceId),
  refreshArtemisPluginMarketplace: (sourceId, operationId) =>
    ipcRenderer.invoke(
      IPC.resourcePluginMarketplaceRefresh,
      sourceId,
      operationId,
    ),
  removeArtemisPluginMarketplace: (sourceId) =>
    ipcRenderer.invoke(IPC.resourcePluginMarketplaceRemove, sourceId),
  reorderArtemisPluginMarketplaces: (sourceIds) =>
    ipcRenderer.invoke(IPC.resourcePluginMarketplaceReorder, sourceIds),
  loadBundledPluginMarketplace: () =>
    ipcRenderer.invoke(IPC.resourcePluginRuntimeMarketplace),
  installBundledPlugins: (operationId) =>
    ipcRenderer.invoke(IPC.resourcePluginRuntimeInstall, operationId),
  installArtemisPlugin: (source, operationId) =>
    ipcRenderer.invoke(IPC.resourcePluginInstall, source, operationId),
  updateArtemisPlugin: (pluginId, operationId) =>
    ipcRenderer.invoke(IPC.resourcePluginUpdate, pluginId, operationId),
  setArtemisPluginEnabled: (pluginId, enabled) =>
    ipcRenderer.invoke(IPC.resourcePluginEnable, pluginId, enabled),
  removeArtemisPlugin: (pluginId) =>
    ipcRenderer.invoke(IPC.resourcePluginRemove, pluginId),
};

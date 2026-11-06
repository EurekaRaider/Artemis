import { ipcRenderer } from "electron";

import { IPC } from "../../shared/ipc-channels.js";
import type { ExtensionsApi } from "../../shared/api/extensions.js";
export const extensionsBridge: ExtensionsApi = {
  trustExtension: () => ipcRenderer.invoke(IPC.extensionTrust),
  retrustExtension: (extensionId) =>
    ipcRenderer.invoke(IPC.extensionRetrust, extensionId),
  setTrustedExtensionEnabled: (extensionId, enabled) =>
    ipcRenderer.invoke(IPC.extensionEnable, extensionId, enabled),
  setTrustedExtensionNetwork: (extensionId, allowNetwork) =>
    ipcRenderer.invoke(IPC.extensionNetwork, extensionId, allowNetwork),
  removeTrustedExtension: (extensionId) =>
    ipcRenderer.invoke(IPC.extensionRemove, extensionId),
};

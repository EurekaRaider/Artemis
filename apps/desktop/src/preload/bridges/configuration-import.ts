import { ipcRenderer } from "electron";

import { IPC } from "../../shared/ipc-channels.js";
import type { ConfigurationImportApi } from "../../shared/api/configuration-import.js";
export const configurationImportBridge: ConfigurationImportApi = {
  scanConfigurationImports: () => ipcRenderer.invoke(IPC.settingsImportScan),
  importConfiguration: (request) =>
    ipcRenderer.invoke(IPC.settingsImportApply, request),
};

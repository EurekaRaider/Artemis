import { ipcRenderer } from "electron";

import { IPC } from "../../shared/ipc-channels.js";
import type { UpdatesDiagnosticsApi } from "../../shared/api/updates-diagnostics.js";
export const updatesDiagnosticsBridge: UpdatesDiagnosticsApi = {
  checkForUpdates: () => ipcRenderer.invoke(IPC.updateCheck),
  downloadUpdate: () => ipcRenderer.invoke(IPC.updateDownload),
  installUpdate: () => ipcRenderer.invoke(IPC.updateInstall),
  exportDiagnostics: () => ipcRenderer.invoke(IPC.diagnosticsExport),
  reportRendererError: (diagnostic) =>
    ipcRenderer.send(IPC.diagnosticsRendererError, diagnostic),
};

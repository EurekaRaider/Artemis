import { ipcRenderer } from "electron";

import { IPC } from "../../shared/ipc-channels.js";
import type { OfficeApi } from "../../shared/api/office.js";
export const officeBridge: OfficeApi = {
  openOfficeFile: (threadId, path) =>
    ipcRenderer.invoke(IPC.officeOpen, threadId, path),
  readOfficeSnapshot: (threadId, sessionId) =>
    ipcRenderer.invoke(IPC.officeSnapshot, threadId, sessionId),
  editOfficeFile: (threadId, request) =>
    ipcRenderer.invoke(IPC.officeEdit, threadId, request),
  saveWorkspaceCsv: (threadId, path, content, expectedContent) =>
    ipcRenderer.invoke(
      IPC.workspaceCsvSave,
      threadId,
      path,
      content,
      expectedContent,
    ),
  openOfficePreview: (threadId, sessionId, assetId) =>
    ipcRenderer.invoke(IPC.officePreview, threadId, sessionId, assetId),
  officeCapabilityStatus: () => ipcRenderer.invoke(IPC.officeCapabilityStatus),
  checkOfficeCapabilityUpdates: () =>
    ipcRenderer.invoke(IPC.officeCapabilityCheckUpdates),
  installOfficeCapability: () =>
    ipcRenderer.invoke(IPC.officeCapabilityInstall),
  importOfficeCapability: () => ipcRenderer.invoke(IPC.officeCapabilityImport),
  cancelOfficeCapability: () => ipcRenderer.invoke(IPC.officeCapabilityCancel),
  activateOfficeCapability: (version) =>
    ipcRenderer.invoke(IPC.officeCapabilityActivate, version),
  deactivateOfficeCapability: () =>
    ipcRenderer.invoke(IPC.officeCapabilityDeactivate),
  uninstallOfficeCapability: (version) =>
    ipcRenderer.invoke(IPC.officeCapabilityUninstall, version),
};

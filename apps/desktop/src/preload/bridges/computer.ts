import { ipcRenderer } from "electron";

import { bindPreviewCanvas, unbindPreviewCanvas } from "../preview-textures.js";
import { IPC } from "../../shared/ipc-channels.js";
import type { ComputerApi } from "../../shared/api/computer.js";
export const computerBridge: ComputerApi = {
  bindPreviewCanvas,
  unbindPreviewCanvas,
  browserSession: (command) => ipcRenderer.invoke(IPC.browserSession, command),
  onBrowserSession(listener) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      snapshot: import("@artemis/protocol").BrowserSessionSnapshot,
    ) => listener(snapshot);
    ipcRenderer.on(IPC.browserSession, handler);
    return () => ipcRenderer.removeListener(IPC.browserSession, handler);
  },
  getComputerPreviews: () => ipcRenderer.invoke(IPC.computerPreviews),
  computerPreview: (command) =>
    ipcRenderer.invoke(IPC.computerPreview, command),
  onComputerPreviews(listener) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      states: import("@artemis/protocol").ComputerPreviewState[],
    ) => listener(states);
    ipcRenderer.on(IPC.computerPreviews, handler);
    return () => ipcRenderer.removeListener(IPC.computerPreviews, handler);
  },
  onComputerPreviewExpand(listener) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      state: import("@artemis/protocol").ComputerPreviewState,
    ) => listener(state);
    ipcRenderer.on(IPC.computerPreviewExpand, handler);
    return () => ipcRenderer.removeListener(IPC.computerPreviewExpand, handler);
  },
  browserPreview: (threadId, contentsId, command) =>
    ipcRenderer.invoke(IPC.browserPreview, threadId, contentsId, command),
  registerComputerBrowser: (threadId, contentsId) =>
    ipcRenderer.invoke(IPC.computerRegisterBrowser, threadId, contentsId),
  getComputerState: () => ipcRenderer.invoke(IPC.computerState),
  controlComputer: (action, threadId) =>
    ipcRenderer.invoke(IPC.computerControl, action, threadId),
  computerRuntimeStatus: () => ipcRenderer.invoke(IPC.computerRuntimeStatus),
  checkComputerRuntimeUpdates: () =>
    ipcRenderer.invoke(IPC.computerRuntimeCheck),
  cancelComputerRuntimeDownload: () =>
    ipcRenderer.invoke(IPC.computerRuntimeCancel),
  getComputerPermissions: () => ipcRenderer.invoke(IPC.computerPermissions),
  revokeComputerPermission: (id) =>
    ipcRenderer.invoke(IPC.computerRevokePermission, id),
  onComputerState(listener) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      state: import("@artemis/protocol").ComputerControlState,
    ) => listener(state);
    ipcRenderer.on(IPC.computerState, handler);
    return () => ipcRenderer.removeListener(IPC.computerState, handler);
  },
  onComputerBrowserOpen(listener) {
    const handler = (_event: Electron.IpcRendererEvent, threadId: string) =>
      listener(threadId);
    ipcRenderer.on(IPC.computerBrowserOpen, handler);
    return () => ipcRenderer.removeListener(IPC.computerBrowserOpen, handler);
  },
};

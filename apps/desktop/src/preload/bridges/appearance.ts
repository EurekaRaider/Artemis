import { ipcRenderer } from "electron";

import { IPC } from "../../shared/ipc-channels.js";
import type { AppearanceApi } from "../../shared/api/appearance.js";
export const appearanceBridge: AppearanceApi = {
  getAppearanceState: () => ipcRenderer.invoke(IPC.appearanceGet),
  resolveSkin: (selection) =>
    ipcRenderer.invoke(IPC.appearanceResolve, selection),
  releaseSkinResources: (leaseId) =>
    ipcRenderer.invoke(IPC.appearanceRelease, leaseId),
  setSkinSelection: (selection) =>
    ipcRenderer.invoke(IPC.appearanceSelect, selection),
  onAppearanceStateChanged(listener) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      state: import("../../shared/appearance.js").AppearanceState,
    ) => listener(state);
    ipcRenderer.on(IPC.appearanceChanged, handler);
    return () => ipcRenderer.removeListener(IPC.appearanceChanged, handler);
  },
};

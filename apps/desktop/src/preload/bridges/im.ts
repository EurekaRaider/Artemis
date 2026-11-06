import { ipcRenderer } from "electron";

import { IPC } from "../../shared/ipc-channels.js";
import type { ImApi } from "../../shared/api/im.js";
export const imBridge: ImApi = {
  getImStatus: () => ipcRenderer.invoke(IPC.imStatus),
  saveImSettings: (settings) => ipcRenderer.invoke(IPC.imSave, settings),
  manageIm: (input) => ipcRenderer.invoke(IPC.imManage, input),
};

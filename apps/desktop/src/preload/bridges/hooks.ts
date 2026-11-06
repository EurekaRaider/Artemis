import { ipcRenderer } from "electron";

import { IPC } from "../../shared/ipc-channels.js";
import type { HooksApi } from "../../shared/api/hooks.js";
export const hooksBridge: HooksApi = {
  listHooks: (query) => ipcRenderer.invoke(IPC.hooksList, query),
  trustHooks: (query, reviewed, scope) =>
    ipcRenderer.invoke(IPC.hooksTrust, query, reviewed, scope),
  changeHook: (query, id, action) =>
    ipcRenderer.invoke(IPC.hooksChange, query, id, action),
  inspectHook: (query, id) => ipcRenderer.invoke(IPC.hooksInspect, query, id),
};

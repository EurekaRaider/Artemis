import { ipcRenderer } from "electron";

import { IPC } from "../../shared/ipc-channels.js";
import type { CustomAgentsApi } from "../../shared/api/custom-agents.js";
export const customAgentsBridge: CustomAgentsApi = {
  customAgentsGet: (id) => ipcRenderer.invoke(IPC.customAgentsGet, id),
  customAgentsCreate: (input) =>
    ipcRenderer.invoke(IPC.customAgentsCreate, input),
  customAgentsUpdate: (id, expectedRevision, input) =>
    ipcRenderer.invoke(IPC.customAgentsUpdate, id, expectedRevision, input),
  customAgentsDelete: (id) => ipcRenderer.invoke(IPC.customAgentsDelete, id),
  customAgentsPreviewCapabilities: (input, mode) =>
    ipcRenderer.invoke(IPC.customAgentsPreviewCapabilities, input, mode),
};

import { ipcRenderer } from "electron";

import { IPC } from "../../shared/ipc-channels.js";
import type { AutomationApi } from "../../shared/api/automation.js";
export const automationBridge: AutomationApi = {
  listAutomations: (projectId) =>
    ipcRenderer.invoke(IPC.automationList, projectId),
  listAutomationRuns: (automationId, limit) =>
    ipcRenderer.invoke(IPC.automationRunList, automationId, limit),
  saveAutomation: (input) => ipcRenderer.invoke(IPC.automationSave, input),
  setAutomationEnabled: (id, enabled) =>
    ipcRenderer.invoke(IPC.automationEnable, id, enabled),
  authorizeAutomation: (id) => ipcRenderer.invoke(IPC.automationAuthorize, id),
  deleteAutomation: (id) => ipcRenderer.invoke(IPC.automationDelete, id),
  runAutomationNow: (id) => ipcRenderer.invoke(IPC.automationRunNow, id),
};

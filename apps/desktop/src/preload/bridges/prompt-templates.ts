import { ipcRenderer } from "electron";
import { IPC } from "../../shared/ipc-channels.js";
import type { PromptTemplatesApi } from "../../shared/api/prompt-templates.js";
export const promptTemplatesBridge: PromptTemplatesApi = {
  listPromptTemplates: (projectId, threadId) =>
    ipcRenderer.invoke(IPC.promptTemplatesList, projectId, threadId),
};

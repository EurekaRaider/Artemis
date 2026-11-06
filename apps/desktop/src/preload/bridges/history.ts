import { ipcRenderer } from "electron";

import { IPC } from "../../shared/ipc-channels.js";
import type { HistoryApi } from "../../shared/api/history.js";
export const historyBridge: HistoryApi = {
  getSnapshot: () => ipcRenderer.invoke(IPC.snapshot),
  onWindowMaterialChanged(listener) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      material: import("../../shared/window-material.js").WindowMaterial,
    ) => listener(material);
    ipcRenderer.on(IPC.windowMaterialChanged, handler);
    return () => ipcRenderer.removeListener(IPC.windowMaterialChanged, handler);
  },
  getThreadHistory: (threadId, cursor) =>
    ipcRenderer.invoke(IPC.threadHistory, threadId, cursor),
  getThreadEvents: (threadId) => ipcRenderer.invoke(IPC.threadEvents, threadId),
  prepareConversationShare: (threadId, options) =>
    ipcRenderer.invoke(IPC.conversationShare, {
      type: "prepare",
      threadId,
      options,
    }),
  updateConversationShare: (previewId, options, excludedIds) =>
    ipcRenderer.invoke(IPC.conversationShare, {
      type: "update",
      previewId,
      options,
      excludedIds,
    }),
  uploadConversationShare: (previewId, destination) =>
    ipcRenderer.invoke(IPC.conversationShare, {
      type: "upload",
      previewId,
      destination,
    }),
  cancelConversationShare: (previewId) =>
    ipcRenderer.invoke(IPC.conversationShare, { type: "cancel", previewId }),
  exportConversationShare: (previewId) =>
    ipcRenderer.invoke(IPC.conversationShare, { type: "export", previewId }),
  listConversationShares: (threadId) =>
    ipcRenderer.invoke(IPC.conversationShare, { type: "list", threadId }),
  deleteConversationShare: (id) =>
    ipcRenderer.invoke(IPC.conversationShare, { type: "delete", id }),
  getThreadTaskSummary: (threadId) =>
    ipcRenderer.invoke(IPC.threadTaskSummary, threadId),
  getTokenUsageEvents: () => ipcRenderer.invoke(IPC.tokenUsageEvents),
  getPromptHistory: () => ipcRenderer.invoke(IPC.promptHistory),
  rendererReady: () =>
    ipcRenderer.send(IPC.rendererReady, {
      contextIsolated: process.contextIsolated === true,
      sandboxed: process.sandboxed === true,
    }),
};

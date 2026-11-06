import { ipcRenderer } from "electron";

import { IPC } from "../../shared/ipc-channels.js";
import type { WorkspacePreviewsApi } from "../../shared/api/workspace-previews.js";
export const workspacePreviewsBridge: WorkspacePreviewsApi = {
  openWorkspacePdf: (threadId, path) =>
    ipcRenderer.invoke(IPC.workspacePdfOpen, threadId, path),
  openWorkspaceVideo: (threadId, href) =>
    ipcRenderer.invoke(IPC.workspaceVideoOpen, threadId, href),
  releaseWorkspaceVideo: (threadId, url) =>
    ipcRenderer.invoke(IPC.workspaceVideoRelease, threadId, url),
  ensureDesignPanel: (threadId, panelId) =>
    ipcRenderer.invoke(IPC.designPanelEnsure, threadId, panelId),
  setDesignPanelBounds: (threadId, panelId, bounds) =>
    ipcRenderer.invoke(IPC.designPanelBounds, threadId, panelId, bounds),
  setDesignPanelVisible: (threadId, panelId, visible) =>
    ipcRenderer.invoke(IPC.designPanelVisible, threadId, panelId, visible),
  releaseDesignPanel: (threadId, panelId) =>
    ipcRenderer.invoke(IPC.designPanelRelease, threadId, panelId),
  acceptDesignPanelCandidate: (threadId, candidateText) =>
    ipcRenderer.invoke(IPC.designPanelCandidateAccept, threadId, candidateText),
  discardDesignPanelCandidate: (credential) =>
    ipcRenderer.invoke(IPC.designPanelCandidateDiscard, credential),
  consumeDesignPanelSend: (credential) =>
    ipcRenderer.invoke(IPC.designPanelSendConsume, credential),
  stageDesignPanelSend: (credential) =>
    ipcRenderer.invoke(IPC.designPanelSendStage, credential),
  reportDesignPanelSendOutcome: (submissionId, outcome) =>
    ipcRenderer.invoke(IPC.designPanelSendOutcome, submissionId, outcome),
  onDesignPanelCandidate: (listener) => {
    const handler = (
      _event: unknown,
      payload: Parameters<typeof listener>[0],
    ) => listener(payload);
    ipcRenderer.on(IPC.designPanelCandidate, handler as never);
    return () => {
      ipcRenderer.removeListener(IPC.designPanelCandidate, handler as never);
    };
  },
  onDesignPanelBinding: (listener) => {
    const handler = (
      _event: unknown,
      payload: Parameters<typeof listener>[0],
    ) => listener(payload);
    ipcRenderer.on(IPC.designPanelBinding, handler as never);
    return () => {
      ipcRenderer.removeListener(IPC.designPanelBinding, handler as never);
    };
  },
  showWorkspaceTabMenu: (input) =>
    ipcRenderer.invoke(IPC.workspaceTabMenuShow, input),
  closeWorkspaceTabMenu: () => ipcRenderer.invoke(IPC.workspaceTabMenuClose),
  onWorkspaceTabMenuSelect: (listener) => {
    const handler = (_event: unknown, kind: Parameters<typeof listener>[0]) =>
      listener(kind);
    ipcRenderer.on(IPC.workspaceTabMenuSelect, handler as never);
    return () => {
      ipcRenderer.removeListener(IPC.workspaceTabMenuSelect, handler as never);
    };
  },
  onWorkspaceTabMenuClosed: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(IPC.workspaceTabMenuClosed, handler as never);
    return () => {
      ipcRenderer.removeListener(IPC.workspaceTabMenuClosed, handler as never);
    };
  },
  openWorkspaceHtml: (threadId, href) =>
    ipcRenderer.invoke(IPC.workspaceHtmlOpen, threadId, href),
  releaseWorkspaceHtml: (threadId, url) =>
    ipcRenderer.invoke(IPC.workspaceHtmlRelease, threadId, url),
};

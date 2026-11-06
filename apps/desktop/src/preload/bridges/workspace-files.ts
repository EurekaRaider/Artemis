import { ipcRenderer } from "electron";

import { IPC } from "../../shared/ipc-channels.js";
import type { WorkspaceFilesApi } from "../../shared/api/workspace-files.js";
export const workspaceFilesBridge: WorkspaceFilesApi = {
  readWorkspaceTextFile: (threadId, path) =>
    ipcRenderer.invoke(IPC.workspaceTextFileRead, threadId, path),
  readWorkspaceImage: (threadId, markdownPath, href) =>
    ipcRenderer.invoke(IPC.workspaceImageRead, threadId, markdownPath, href),
  listWorkspaceDirectory: (threadId, path) =>
    ipcRenderer.invoke(IPC.workspaceDirectoryList, threadId, path),
  readWorkspaceFile: (threadId, path) =>
    ipcRenderer.invoke(IPC.workspaceFileRead, threadId, path),
  writeWorkspaceFile: (threadId, path, content) =>
    ipcRenderer.invoke(IPC.workspaceFileWrite, threadId, path, content),
  inspectWorkspaceFileLink: (threadId, href) =>
    ipcRenderer.invoke(IPC.workspaceFileLinkInspect, threadId, href),
  revealWorkspaceFile: (threadId, path) =>
    ipcRenderer.invoke(IPC.workspaceFileReveal, threadId, path),
  runWorkspaceFile: (threadId, path) =>
    ipcRenderer.invoke(IPC.workspaceFileRun, threadId, path),
};

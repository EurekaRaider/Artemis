import { ipcRenderer } from "electron";

import { IPC } from "../../shared/ipc-channels.js";
import type { ProjectsApi } from "../../shared/api/projects.js";
export const projectsBridge: ProjectsApi = {
  openProject: () => ipcRenderer.invoke(IPC.projectOpen),
  removeProject: (projectId) =>
    ipcRenderer.invoke(IPC.projectRemove, projectId),
  readProjectInstructions: (projectId) =>
    ipcRenderer.invoke(IPC.projectInstructionsRead, projectId),
  writeProjectInstructions: (projectId, content) =>
    ipcRenderer.invoke(IPC.projectInstructionsWrite, projectId, content),
  onThreadLinkOpen(listener) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      threadId: string | null,
    ) => listener(threadId);
    ipcRenderer.on(IPC.threadLinkOpen, handler);
    return () => ipcRenderer.removeListener(IPC.threadLinkOpen, handler);
  },
  getProjectGitInfo: (projectId, threadId) =>
    ipcRenderer.invoke(IPC.projectGitInfo, projectId, threadId),
  getProjectPullRequest: (projectId, threadId) =>
    ipcRenderer.invoke(IPC.projectPullRequest, projectId, threadId),
  switchProjectBranch: (projectId, branchName, threadId) =>
    ipcRenderer.invoke(
      IPC.projectGitBranchSwitch,
      projectId,
      branchName,
      threadId,
    ),
  createProjectBranch: (projectId, branchName, threadId) =>
    ipcRenderer.invoke(
      IPC.projectGitBranchCreate,
      projectId,
      branchName,
      threadId,
    ),
  commitProjectChanges: (projectId, message, includeUnstaged, threadId) =>
    ipcRenderer.invoke(
      IPC.projectGitCommit,
      projectId,
      message,
      includeUnstaged,
      threadId,
    ),
  pushProjectBranch: (projectId, threadId) =>
    ipcRenderer.invoke(IPC.projectGitPush, projectId, threadId),
};

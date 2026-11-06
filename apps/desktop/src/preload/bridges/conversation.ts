import { ipcRenderer } from "electron";

import { IPC } from "../../shared/ipc-channels.js";
import type { ConversationApi } from "../../shared/api/conversation.js";
export const conversationBridge: ConversationApi = {
  createThread: (input) => ipcRenderer.invoke(IPC.threadCreate, input),
  setThreadModelSelection: (threadId, selection) =>
    ipcRenderer.invoke(IPC.threadModelSet, threadId, selection),
  renameThread: (threadId, title) =>
    ipcRenderer.invoke(IPC.threadRename, threadId, title),
  setThreadGoal: (threadId, objective, tokenBudget) =>
    ipcRenderer.invoke(IPC.threadGoalSet, threadId, objective, tokenBudget),
  getThreadGoalObjective: (threadId) =>
    ipcRenderer.invoke(IPC.threadGoalObjectiveGet, threadId),
  updateThreadGoalObjective: (
    threadId,
    objective,
    expectedGoalId,
    expectedRevision,
  ) =>
    ipcRenderer.invoke(
      IPC.threadGoalObjectiveUpdate,
      threadId,
      objective,
      expectedGoalId,
      expectedRevision,
    ),
  pauseThreadGoal: (threadId) =>
    ipcRenderer.invoke(IPC.threadGoalPause, threadId),
  resumeThreadGoal: (threadId) =>
    ipcRenderer.invoke(IPC.threadGoalResume, threadId),
  clearThreadGoal: (threadId) =>
    ipcRenderer.invoke(IPC.threadGoalClear, threadId),
  archiveThread: (threadId, archived) =>
    ipcRenderer.invoke(IPC.threadArchive, threadId, archived),
  deleteThread: (threadId) => ipcRenderer.invoke(IPC.threadDelete, threadId),
  forkThread: (threadId, entryId) =>
    ipcRenderer.invoke(IPC.threadFork, threadId, entryId),
  compactThread: (threadId, instructions) =>
    ipcRenderer.invoke(IPC.threadCompact, threadId, instructions),
  prepareThread: (threadId) => ipcRenderer.invoke(IPC.threadPrepare, threadId),
  branchizeWorktree: (threadId, branchName) =>
    ipcRenderer.invoke(IPC.worktreeBranchize, threadId, branchName),
  listWorktreeCleanupCandidates: () =>
    ipcRenderer.invoke(IPC.worktreeListCleanup),
  cleanupWorktree: (threadId, force) =>
    ipcRenderer.invoke(IPC.worktreeCleanup, threadId, force),
  restoreWorktreeSnapshot: (worktreeId) =>
    ipcRenderer.invoke(IPC.worktreeRestoreSnapshot, worktreeId),
  handoffWorkspace: (threadId, destination) =>
    ipcRenderer.invoke(IPC.worktreeHandoff, threadId, destination),
  acceptPlan: (input) => ipcRenderer.invoke(IPC.planAccept, input),
  revisePlan: (input) => ipcRenderer.invoke(IPC.planRevise, input),
  startTurn: (input) => ipcRenderer.invoke(IPC.turnStart, input),
  reportTurnRendered: (turnId, renderedAt) =>
    ipcRenderer.send(IPC.turnRendered, turnId, renderedAt),
  steerTurn: (input) => ipcRenderer.invoke(IPC.turnSteer, input),
  followUpTurn: (input) => ipcRenderer.invoke(IPC.turnFollowUp, input),
  clearTurnQueue: (threadId) =>
    ipcRenderer.invoke(IPC.turnQueueClear, threadId),
  steerTurnQueue: (threadId) =>
    ipcRenderer.invoke(IPC.turnQueueSteer, threadId),
  steerQueuedTurn: (input) => ipcRenderer.invoke(IPC.turnQueueSteerItem, input),
  replaceTurnQueue: (input) => ipcRenderer.invoke(IPC.turnQueueReplace, input),
  cancelTurn: (threadId) => ipcRenderer.invoke(IPC.turnCancel, threadId),
  undoTurnChanges: (threadId, turnId) =>
    ipcRenderer.invoke(IPC.turnChangesUndo, threadId, turnId),
  controlChildAgent: (input) =>
    ipcRenderer.invoke(IPC.childAgentControl, input),
  controlAgentTeam: (input) => ipcRenderer.invoke(IPC.agentTeamControl, input),
  resolveApproval: (resolution) =>
    ipcRenderer.invoke(IPC.approvalResolve, resolution),
  resolveUserInput: (resolution) =>
    ipcRenderer.invoke(IPC.userInputResolve, resolution),
};

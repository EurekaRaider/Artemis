import { uiText } from "../../shared/i18n/ui-text.js";
import { randomUUID } from "node:crypto";
import { ensureProjectGitWatcher } from "../workspace/project-git-watcher.js";
import { dialog } from "electron";
import type { Project } from "@artemis/protocol";
import {
  commitProjectChanges,
  createGitBranch,
  inspectGitBranches,
  pushProjectBranch,
  switchGitBranch,
} from "../workspace/git-branches.js";
import { inspectProjectPullRequest } from "../workspace/github-pull-request.js";
import {
  IPC,
  type ProjectGitInfo,
  type ProjectGitCommitResult,
  type ProjectGitPushResult,
  type ProjectPullRequestLookup,
} from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "store"
  | "mainWindow"
  | "currentLocale"
  | "ipcMain"
  | "taskNotifications"
  | "activeTurns"
  | "workspaceForGitRequest"
  | "pathsEqual"
  | "agentProcess"
>;

export function registerProjectGitIpc(services: Dependencies): void {
  const {
    currentLocale,
    ipcMain,
    activeTurns,
    workspaceForGitRequest,
    pathsEqual,
  } = services;

  ipcMain.handle(IPC.projectOpen, async (): Promise<Project | undefined> => {
    if (!services.store || !services.mainWindow) {
      throw new Error("Application is not ready.");
    }
    const result = await dialog.showOpenDialog(services.mainWindow, {
      properties: ["openDirectory"],
      title: uiText(currentLocale(), "native.openProject"),
    });
    const path = result.filePaths[0];
    if (result.canceled || !path) {
      return undefined;
    }
    const now = new Date().toISOString();
    return services.store.upsertProject({
      id: randomUUID(),
      name: path.split(/[\\/]/).filter(Boolean).at(-1) ?? path,
      path,
      createdAt: now,
      updatedAt: now,
    });
  });

  ipcMain.handle(IPC.projectRemove, (_event, projectId: string): void => {
    if (!services.store) {
      throw new Error("Application store is not ready.");
    }
    services.store.removeProject(projectId);
    services.taskNotifications?.refresh();
  });

  const assertProjectGitMutationAllowed = (projectId: string): void => {
    const hasLiveLocalTurn = [...activeTurns.keys()].some((threadId) => {
      const thread = services.store?.getThread(threadId);
      return thread?.projectId === projectId && thread.target === "local";
    });
    if (services.store?.hasActiveLocalThread(projectId) || hasLiveLocalTurn) {
      throw new Error(
        "Stop active local tasks before changing the project repository.",
      );
    }
  };

  ipcMain.handle(
    IPC.projectGitInfo,
    async (
      event,
      projectId: string,
      threadId?: string,
    ): Promise<ProjectGitInfo> => {
      let context = await workspaceForGitRequest(projectId, threadId);
      let info: ProjectGitInfo;
      for (;;) {
        info = await inspectGitBranches(context.workspacePath);
        const current = await workspaceForGitRequest(projectId, threadId);
        if (pathsEqual(current.workspacePath, context.workspacePath)) break;
        context = current;
      }
      await ensureProjectGitWatcher(
        event.sender,
        context.project.id,
        context.threadId,
        context.workspacePath,
        info,
      );
      return info;
    },
  );

  ipcMain.handle(
    IPC.projectPullRequest,
    async (
      _event,
      projectId: string,
      threadId?: string,
    ): Promise<ProjectPullRequestLookup> => {
      const context = await workspaceForGitRequest(projectId, threadId);

      return inspectProjectPullRequest(context.workspacePath);
    },
  );

  ipcMain.handle(
    IPC.projectGitBranchSwitch,
    async (
      _event,
      projectId: string,
      branchName: string,
      threadId?: string,
    ): Promise<ProjectGitInfo> => {
      const context = await workspaceForGitRequest(projectId, threadId);
      assertProjectGitMutationAllowed(context.project.id);
      return switchGitBranch(context.workspacePath, String(branchName ?? ""));
    },
  );

  ipcMain.handle(
    IPC.projectGitBranchCreate,
    async (
      _event,
      projectId: string,
      branchName: string,
      threadId?: string,
    ): Promise<ProjectGitInfo> => {
      const context = await workspaceForGitRequest(projectId, threadId);
      assertProjectGitMutationAllowed(context.project.id);
      return createGitBranch(context.workspacePath, String(branchName ?? ""));
    },
  );

  ipcMain.handle(
    IPC.projectGitCommit,
    async (
      _event,
      projectId: string,
      message: string,
      includeUnstaged: boolean,
      threadId?: string,
    ): Promise<ProjectGitCommitResult> => {
      const context = await workspaceForGitRequest(projectId, threadId);
      assertProjectGitMutationAllowed(context.project.id);
      if (typeof includeUnstaged !== "boolean") {
        throw new Error("Include-unstaged selection is invalid.");
      }
      return commitProjectChanges(
        context.workspacePath,
        message,
        includeUnstaged,
        async (diff) => {
          if (!services.agentProcess)
            throw new Error("Agent process is not ready.");
          const selection = context.threadId
            ? services.store?.getThread(context.threadId)?.modelSelection
            : undefined;
          const generated = await services.agentProcess.request<string>(
            {
              type: "git.generate-commit-message",
              requestId: randomUUID(),
              diff,
              locale: currentLocale(),
              ...(selection ? { selection } : {}),
            },
            75_000,
          );
          assertProjectGitMutationAllowed(context.project.id);
          return generated;
        },
      );
    },
  );

  ipcMain.handle(
    IPC.projectGitPush,
    async (
      _event,
      projectId: string,
      threadId?: string,
    ): Promise<ProjectGitPushResult> => {
      const context = await workspaceForGitRequest(projectId, threadId);
      assertProjectGitMutationAllowed(context.project.id);
      return pushProjectBranch(context.workspacePath);
    },
  );
}

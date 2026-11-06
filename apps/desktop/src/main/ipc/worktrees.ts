import { randomUUID } from "node:crypto";
import type { TaskWorktree } from "@artemis/protocol";
import { worktreeCommandSchema } from "@artemis/protocol";
import {
  branchizeManagedWorktree,
  inspectWorktreeCleanup,
  restoreWorktreeSnapshot,
} from "../workspace/git-worktree.js";
import { conversationSupportsProjectFeatures } from "../conversation/temporary-conversation.js";
import {
  applyWorkspaceChangeBundle,
  createWorkspaceChangeBundle,
} from "../workspace/workspace-handoff.js";
import {
  IPC,
  type CleanupWorktreeResult,
  type HandoffWorkspaceResult,
  type RestoreWorktreeSnapshotResult,
} from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "store"
  | "activeTurns"
  | "resolveThreadWorkspace"
  | "managedWorktreeRoot"
  | "ipcMain"
  | "agentProcess"
  | "cleaningWorktreeThreads"
  | "openedThreads"
  | "terminalService"
  | "worktreeRecoveryRoot"
  | "removeManagedWorktree"
  | "createManagedTaskWorktree"
  | "handoffBundleRoot"
>;

export function registerWorktreesIpc(services: Dependencies): void {
  const {
    activeTurns,
    resolveThreadWorkspace,
    managedWorktreeRoot,
    ipcMain,
    cleaningWorktreeThreads,
    openedThreads,
    worktreeRecoveryRoot,
    removeManagedWorktree,
    createManagedTaskWorktree,
    handoffBundleRoot,
  } = services;

  ipcMain.handle(
    IPC.worktreeBranchize,
    async (
      _event,
      threadId: string,
      branchName: string,
    ): Promise<TaskWorktree> => {
      if (!services.store) {
        throw new Error("Application store is not ready.");
      }
      const command = worktreeCommandSchema.parse({
        type: "worktree.branchize",
        threadId,
        branchName,
      });
      if (command.type !== "worktree.branchize") {
        throw new Error("Invalid worktree command.");
      }
      const thread = services.store.getThread(command.threadId);
      if (!thread) {
        throw new Error(`Thread not found: ${command.threadId}`);
      }
      if (!conversationSupportsProjectFeatures(thread)) {
        throw new Error(
          "Temporary conversations do not support worktree branches.",
        );
      }
      if (
        thread.status === "running" ||
        thread.status === "waiting-approval" ||
        activeTurns.has(thread.id)
      ) {
        throw new Error("Stop the active turn before creating a branch.");
      }
      const context = await resolveThreadWorkspace(thread);
      if (!context.worktree || context.worktree.target !== "managed-worktree") {
        throw new Error("Task does not use a managed worktree.");
      }
      const branched = await branchizeManagedWorktree({
        repositoryPath: context.project.path,
        managedRoot: managedWorktreeRoot(context.project.id),
        worktreePath: context.worktree.path,
        branchName: command.branchName,
      });
      return services.store.updateWorktree(context.worktree.id, {
        head: branched.head,
        ...(branched.branch ? { branch: branched.branch } : {}),
      });
    },
  );

  ipcMain.handle(IPC.worktreeListCleanup, async () => {
    if (!services.store) throw new Error("Application is not ready.");
    const entries = services.store
      .listWorktrees()
      .filter(
        (item) =>
          item.target === "managed-worktree" && item.status === "active",
      );
    return Promise.all(
      entries.map(async (worktree) => {
        const thread = services.store!.getThread(worktree.threadId);
        const project = services.store!.getProject(worktree.projectId);
        const busy =
          !thread ||
          thread.status === "running" ||
          thread.status === "waiting-approval" ||
          activeTurns.has(worktree.threadId);
        const expired =
          Date.now() - Date.parse(thread?.updatedAt ?? worktree.updatedAt) >=
          30 * 24 * 60 * 60 * 1000;
        const inspection = await inspectWorktreeCleanup(worktree.path);
        return {
          worktree,
          title: thread?.title ?? worktree.threadId,
          projectName: project?.name ?? worktree.projectId,
          busy,
          expired,
          ...inspection,
          recommended:
            !busy && expired && inspection.clean && inspection.pushedToGitHub,
        };
      }),
    );
  });

  ipcMain.handle(
    IPC.worktreeCleanup,
    async (
      _event,
      threadId: string,
      force: boolean,
    ): Promise<CleanupWorktreeResult> => {
      if (!services.store || !services.agentProcess) {
        throw new Error("Application is not ready.");
      }
      const command = worktreeCommandSchema.parse({
        type: "worktree.cleanup",
        threadId,
        force,
      });
      if (command.type !== "worktree.cleanup") {
        throw new Error("Invalid worktree command.");
      }
      const thread = services.store.getThread(command.threadId);
      if (!thread) {
        throw new Error(`Thread not found: ${command.threadId}`);
      }
      if (
        thread.status === "running" ||
        thread.status === "waiting-approval" ||
        activeTurns.has(thread.id)
      ) {
        throw new Error("Stop the active turn before cleaning its worktree.");
      }
      if (cleaningWorktreeThreads.has(thread.id)) {
        throw new Error("Worktree cleanup is already in progress.");
      }
      cleaningWorktreeThreads.add(thread.id);
      try {
        const context = await resolveThreadWorkspace(thread);
        if (
          !context.worktree ||
          context.worktree.target !== "managed-worktree"
        ) {
          throw new Error("Task does not use a managed worktree.");
        }
        if (openedThreads.has(thread.id)) {
          await services.agentProcess.request({
            type: "thread.close",
            requestId: randomUUID(),
            threadId: thread.id,
          });
          openedThreads.delete(thread.id);
        }
        services.terminalService?.closeThread(thread.id);
        const removed = await removeManagedWorktree({
          repositoryPath: context.project.path,
          managedRoot: managedWorktreeRoot(context.project.id),
          worktreePath: context.worktree.path,
          recoveryRoot: worktreeRecoveryRoot(context.project.id),
          force: command.force,
        });
        return services.store.completeWorktreeCleanup(
          thread.id,
          context.worktree.id,
          removed.recoveryPath,
        );
      } finally {
        cleaningWorktreeThreads.delete(thread.id);
      }
    },
  );

  ipcMain.handle(
    IPC.worktreeRestoreSnapshot,
    async (
      _event,
      worktreeId: string,
    ): Promise<RestoreWorktreeSnapshotResult> => {
      if (!services.store) {
        throw new Error("Application is not ready.");
      }
      if (
        typeof worktreeId !== "string" ||
        !worktreeId.trim() ||
        worktreeId.length > 100
      ) {
        throw new Error("Worktree recovery ID is invalid.");
      }
      const worktree = services.store.getWorktree(worktreeId);
      if (
        !worktree ||
        worktree.status !== "removed" ||
        !worktree.recoveryPath
      ) {
        throw new Error("Recoverable Worktree snapshot was not found.");
      }
      const thread = services.store.getThread(worktree.threadId);
      const project = services.store.getProject(worktree.projectId);
      if (!thread || !project) {
        throw new Error("Snapshot task or project was not found.");
      }
      if (
        thread.status === "running" ||
        thread.status === "waiting-approval" ||
        activeTurns.has(thread.id)
      ) {
        throw new Error("Stop the active turn before restoring its snapshot.");
      }
      const restored = await restoreWorktreeSnapshot({
        recoveryRoot: worktreeRecoveryRoot(project.id),
        recoveryPath: worktree.recoveryPath,
        targetWorkspace: project.path,
      });
      return {
        worktree: services.store.clearWorktreeRecovery(worktree.id),
        restoredFiles: restored.restoredFiles,
      };
    },
  );

  ipcMain.handle(
    IPC.worktreeHandoff,
    async (
      _event,
      threadId: string,
      destination: "local" | "managed-worktree",
    ): Promise<HandoffWorkspaceResult> => {
      if (!services.store || !services.agentProcess) {
        throw new Error("Application is not ready.");
      }
      const command = worktreeCommandSchema.parse({
        type: "worktree.handoff",
        threadId,
        destination,
      });
      if (command.type !== "worktree.handoff") {
        throw new Error("Invalid worktree command.");
      }
      const thread = services.store.getThread(command.threadId);
      if (!thread) {
        throw new Error(`Thread not found: ${command.threadId}`);
      }
      if (!conversationSupportsProjectFeatures(thread)) {
        throw new Error(
          "Temporary conversations do not support workspace handoff.",
        );
      }
      if (
        thread.status === "running" ||
        thread.status === "waiting-approval" ||
        activeTurns.has(thread.id)
      ) {
        throw new Error(
          "Stop the active turn before handing off its workspace.",
        );
      }
      const currentDestination =
        thread.target === "local" ? "local" : "managed-worktree";
      if (currentDestination === command.destination) {
        throw new Error("Task already uses the requested workspace.");
      }
      const context = await resolveThreadWorkspace(thread);
      if (openedThreads.has(thread.id)) {
        await services.agentProcess.request({
          type: "thread.close",
          requestId: randomUUID(),
          threadId: thread.id,
        });
        openedThreads.delete(thread.id);
      }

      if (command.destination === "managed-worktree") {
        const worktree = await createManagedTaskWorktree(
          context.project,
          thread.id,
        );
        let bundlePath: string | undefined;
        try {
          const bundle = await createWorkspaceChangeBundle({
            sourceWorkspace: context.project.path,
            bundleRoot: handoffBundleRoot(context.project.id, thread.id),
            paths: services.store.getThreadChangedFiles(thread.id),
          });
          bundlePath = bundle.path;
          await applyWorkspaceChangeBundle({
            bundlePath: bundle.path,
            targetWorkspace: worktree.path,
          });
          const attached = services.store.attachWorktreeToThread(thread.id, {
            ...worktree,
            recoveryPath: bundle.path,
          });
          return {
            thread: attached.thread,
            worktree: attached.worktree,
            bundlePath: bundle.path,
          };
        } catch (error) {
          try {
            await removeManagedWorktree({
              repositoryPath: context.project.path,
              managedRoot: managedWorktreeRoot(context.project.id),
              worktreePath: worktree.path,
              recoveryRoot: worktreeRecoveryRoot(context.project.id),
              force: true,
            });
          } catch (cleanupError) {
            throw new AggregateError(
              [error, cleanupError],
              "Handoff failed and its temporary worktree could not be removed.",
            );
          }
          throw new Error(
            `${error instanceof Error ? error.message : String(error)}${
              bundlePath ? ` Recovery bundle: ${bundlePath}` : ""
            }`,
          );
        }
      }

      if (!context.worktree || context.worktree.target !== "managed-worktree") {
        throw new Error("Task does not use a managed worktree.");
      }
      const bundle = await createWorkspaceChangeBundle({
        sourceWorkspace: context.worktree.path,
        bundleRoot: handoffBundleRoot(context.project.id, thread.id),
      });
      await applyWorkspaceChangeBundle({
        bundlePath: bundle.path,
        targetWorkspace: context.project.path,
      });
      let removed: Awaited<ReturnType<typeof removeManagedWorktree>>;
      try {
        removed = await removeManagedWorktree({
          repositoryPath: context.project.path,
          managedRoot: managedWorktreeRoot(context.project.id),
          worktreePath: context.worktree.path,
          recoveryRoot: worktreeRecoveryRoot(context.project.id),
          force: true,
        });
      } catch (error) {
        throw new Error(
          `Changes were copied to Local, but the managed worktree could not be removed. The task still points to the worktree. ${
            error instanceof Error ? error.message : String(error)
          } Recovery bundle: ${bundle.path}`,
        );
      }
      const completed = services.store.completeWorktreeCleanup(
        thread.id,
        context.worktree.id,
        removed.recoveryPath ?? bundle.path,
      );
      return {
        thread: completed.thread,
        worktree: completed.worktree,
        bundlePath: bundle.path,
      };
    },
  );
}

import { randomUUID } from "node:crypto";
import { app } from "electron";
import type { Thread } from "@artemis/protocol";
import {
  deletePiSessionTranscript,
  piSessionsRoot,
} from "../conversation/pi-session-delete.js";
import { listGitWorktrees } from "../workspace/git-worktree.js";
import { mainText } from "../settings/i18n.js";
import {
  copyTemporaryConversationWorkspace,
  removeTemporaryConversationWorkspace,
} from "../conversation/temporary-conversation.js";
import { IPC, type ForkThreadResult } from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "store"
  | "agentProcess"
  | "parseThreadCommand"
  | "compactingThreads"
  | "endHookSession"
  | "openedThreads"
  | "pluginDispatch"
  | "designPanelHost"
  | "computerUseHost"
  | "browserSessionHost"
  | "taskNotifications"
  | "ipcMain"
  | "activeTurns"
  | "diagnosticBundleService"
  | "terminalService"
  | "turnChangeSetCompletionTails"
  | "turnChangeSetService"
  | "taskSourceImages"
  | "attachmentScope"
  | "attachmentStore"
  | "threadHistoryService"
  | "imService"
  | "cleanupGoalObjective"
  | "resolveThreadWorkspace"
  | "openAgentThread"
  | "currentLocale"
  | "pathsEqual"
  | "createManagedTaskWorktree"
  | "managedWorktreeRoot"
  | "worktreeRecoveryRoot"
  | "removeManagedWorktree"
  | "publishCompactionQueue"
  | "resumeCompactionFollowUps"
  | "recoverableTurnQueues"
  | "emitPayload"
  | "compactionFollowUps"
>;

export function registerThreadMaintenanceIpc(services: Dependencies): void {
  const {
    parseThreadCommand,
    compactingThreads,
    endHookSession,
    openedThreads,
    ipcMain,
    activeTurns,
    turnChangeSetCompletionTails,
    taskSourceImages,
    attachmentScope,
    attachmentStore,
    cleanupGoalObjective,
    resolveThreadWorkspace,
    openAgentThread,
    currentLocale,
    pathsEqual,
    createManagedTaskWorktree,
    managedWorktreeRoot,
    worktreeRecoveryRoot,
    removeManagedWorktree,
    publishCompactionQueue,
    resumeCompactionFollowUps,
    recoverableTurnQueues,
    emitPayload,
    compactionFollowUps,
  } = services;

  ipcMain.handle(
    IPC.threadArchive,
    async (_event, threadId: string, archived: boolean): Promise<Thread> => {
      if (!services.store || !services.agentProcess) {
        throw new Error("Application is not ready.");
      }
      const command = parseThreadCommand({
        type: "thread.archive",
        threadId,
        archived,
      });
      const thread = services.store.getThread(command.threadId);
      if (!thread) {
        throw new Error(`Thread not found: ${command.threadId}`);
      }
      if (
        command.archived &&
        (thread.status === "running" || thread.status === "waiting-approval")
      ) {
        throw new Error("Stop the active turn before archiving this task.");
      }
      if (command.archived && compactingThreads.has(thread.id)) {
        throw new Error(
          "Wait for context compaction before archiving this task.",
        );
      }
      if (command.archived && openedThreads.has(thread.id)) {
        await endHookSession(command.threadId);
        await services.agentProcess.request({
          type: "thread.close",
          requestId: randomUUID(),
          threadId: thread.id,
        });
        openedThreads.delete(thread.id);
      }
      const updated = services.store.updateThread(thread.id, {
        archived: command.archived,
      });
      if (command.archived) {
        // S2: archived threads stop hosting plugin runtimes; the next
        // unarchive + tool call lazily respawns a fresh worker.
        services.pluginDispatch?.closeThread(thread.id);
        services.designPanelHost?.releasePanel(thread.id, "workspace");
        services.computerUseHost?.clearTask(thread.id, "Task archived");
        services.browserSessionHost?.clearThread(thread.id);
      }
      services.taskNotifications?.refresh();
      return updated;
    },
  );

  ipcMain.handle(
    IPC.threadDelete,
    async (_event, threadId: string): Promise<void> => {
      if (!services.store) {
        throw new Error("Application is not ready.");
      }
      const command = parseThreadCommand({
        type: "thread.delete",
        threadId,
      });
      threadId = command.threadId;
      const thread = services.store.getThread(threadId);
      if (!thread) {
        throw new Error(`Thread not found: ${threadId}`);
      }
      if (activeTurns.has(threadId)) {
        throw new Error("Stop the active turn before deleting this task.");
      }
      if (compactingThreads.has(threadId)) {
        throw new Error(
          "Wait for context compaction before deleting this task.",
        );
      }
      if (openedThreads.has(threadId)) await endHookSession(threadId);
      if (!thread.projectId) {
        if (openedThreads.has(threadId)) {
          if (!services.agentProcess?.available) {
            throw new Error(
              "Agent Host is unavailable. Restart Artemis before deleting this temporary conversation.",
            );
          }
          try {
            await services.agentProcess.request(
              {
                type: "thread.close",
                requestId: randomUUID(),
                threadId,
              },
              15_000,
            );
            openedThreads.delete(threadId);
          } catch (error) {
            services.diagnosticBundleService?.record({
              source: "agent-host",
              severity: "error",
              message: `Agent Host cleanup blocked temporary thread deletion ${threadId}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            });
            throw new Error(
              "Temporary conversation processes could not be stopped. Try deleting the conversation again.",
              { cause: error },
            );
          }
        }
        services.terminalService?.closeThread(threadId);
        try {
          await removeTemporaryConversationWorkspace(
            app.getPath("userData"),
            thread.id,
          );
        } catch (error) {
          services.diagnosticBundleService?.record({
            source: "main",
            severity: "error",
            message: `Temporary workspace cleanup blocked thread deletion ${threadId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          });
          throw new Error(
            "Temporary conversation workspace could not be removed. Try deleting the conversation again.",
            { cause: error },
          );
        }
      }
      let transcriptDeleted = false;
      if (services.agentProcess?.available) {
        try {
          await services.agentProcess.request(
            {
              type: "thread.delete",
              requestId: randomUUID(),
              threadId,
              ...(thread.sessionFile
                ? { sessionFile: thread.sessionFile }
                : {}),
            },
            15_000,
          );
          transcriptDeleted = true;
        } catch (error) {
          services.diagnosticBundleService?.record({
            source: "agent-host",
            severity: "warning",
            message: `Agent host could not close deleted thread ${threadId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          });
        }
      }
      if (!transcriptDeleted && thread.sessionFile) {
        try {
          await deletePiSessionTranscript(
            thread.sessionFile,
            piSessionsRoot(process.env, app.getPath("home")),
          );
        } catch (error) {
          services.diagnosticBundleService?.record({
            source: "main",
            severity: "warning",
            message: `Pi transcript cleanup failed for deleted thread ${threadId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          });
        }
      }
      const goalObjective = services.store.getThreadGoal(threadId)?.objective;
      openedThreads.delete(threadId);
      await turnChangeSetCompletionTails.get(threadId);
      await services.turnChangeSetService?.deleteThread(threadId);
      await taskSourceImages().deleteThread(threadId);
      await attachmentStore().deleteThread(attachmentScope(threadId));
      // S2: the thread is gone; its plugin runtime trees must not outlive
      // it (SIGKILL via ThreadRuntimeManager.closeThread).
      services.pluginDispatch?.closeThread(threadId);
      services.designPanelHost?.releasePanel(threadId, "workspace");
      services.store.deleteThread(threadId);
      services.computerUseHost?.clearTask(threadId, "Task deleted");
      services.browserSessionHost?.clearThread(threadId);
      services.threadHistoryService?.discard(threadId);
      services.taskNotifications?.refresh();
      services.imService?.deleteThread(threadId);
      await cleanupGoalObjective(goalObjective);
    },
  );

  ipcMain.handle(
    IPC.threadFork,
    async (
      _event,
      threadId: string,
      entryId?: string,
    ): Promise<ForkThreadResult> => {
      if (!services.store || !services.agentProcess) {
        throw new Error("Application is not ready.");
      }
      const appStore = services.store;
      const command = parseThreadCommand({
        type: "thread.fork",
        threadId,
        ...(entryId ? { entryId } : {}),
      });
      const source = appStore.getThread(command.threadId);
      if (!source) {
        throw new Error(`Thread not found: ${command.threadId}`);
      }
      if (source.status === "running" || source.status === "waiting-approval") {
        throw new Error("Stop the active turn before forking this task.");
      }
      if (compactingThreads.has(source.id)) {
        throw new Error(
          "Wait for context compaction before forking this task.",
        );
      }
      const sourceContext = await resolveThreadWorkspace(source);
      await openAgentThread(source);
      const fork = await services.agentProcess.request<{ sessionFile: string }>(
        {
          type: "thread.fork",
          requestId: randomUUID(),
          threadId: source.id,
          ...(command.entryId ? { entryId: command.entryId } : {}),
        },
      );
      const now = new Date().toISOString();
      const forkedThread: Thread = {
        id: randomUUID(),
        ...(source.projectId ? { projectId: source.projectId } : {}),
        title: `${source.title}${mainText(currentLocale(), "forkSuffix")}`,
        mode: source.mode,
        target: source.target === "local" ? "local" : "managed-worktree",
        status: "idle",
        sessionFile: fork.sessionFile,
        ...(source.modelSelection
          ? { modelSelection: structuredClone(source.modelSelection) }
          : {}),
        ...(source.contextWindow
          ? { contextWindow: source.contextWindow }
          : {}),
        pinned: false,
        archived: false,
        createdAt: now,
        updatedAt: now,
      };
      const persistFork = async (
        create: () => ForkThreadResult,
      ): Promise<ForkThreadResult> => {
        await taskSourceImages().copyThread(source.id, forkedThread.id);
        await attachmentStore().copyThread(
          attachmentScope(source.id),
          forkedThread.id,
        );
        try {
          return create();
        } catch (error) {
          try {
            await taskSourceImages().deleteThread(forkedThread.id);
          } catch (cleanupError) {
            throw new AggregateError(
              [error, cleanupError],
              "Task fork failed and its copied source images could not be removed.",
            );
          }
          throw error;
        }
      };
      if (forkedThread.target === "local") {
        if (!source.projectId) {
          let workspaceCopied = false;
          try {
            await copyTemporaryConversationWorkspace(
              app.getPath("userData"),
              source.id,
              forkedThread.id,
            );
            workspaceCopied = true;
            return await persistFork(() =>
              appStore.createForkedThread(forkedThread, source.id),
            );
          } catch (error) {
            const cleanupErrors: unknown[] = [error];
            if (workspaceCopied) {
              try {
                await removeTemporaryConversationWorkspace(
                  app.getPath("userData"),
                  forkedThread.id,
                );
              } catch (cleanupError) {
                cleanupErrors.push(cleanupError);
              }
            }
            try {
              await deletePiSessionTranscript(
                fork.sessionFile,
                piSessionsRoot(process.env, app.getPath("home")),
              );
            } catch (cleanupError) {
              cleanupErrors.push(cleanupError);
            }
            if (cleanupErrors.length > 1) {
              throw new AggregateError(
                cleanupErrors,
                "Temporary conversation fork failed and one or more artifacts could not be removed.",
              );
            }
            throw error;
          }
        }
        return await persistFork(() =>
          appStore.createForkedThread(forkedThread, source.id),
        );
      }

      const sourceRegistration = (
        await listGitWorktrees(sourceContext.project.path)
      ).find((item) => pathsEqual(item.path, sourceContext.workspacePath));
      if (!sourceRegistration) {
        throw new Error("Source task worktree is not registered with Git.");
      }
      const worktree = await createManagedTaskWorktree(
        sourceContext.project,
        forkedThread.id,
        sourceRegistration.head,
      );
      try {
        return await persistFork(() =>
          appStore.createForkedThreadWithWorktree(
            forkedThread,
            worktree,
            source.id,
          ),
        );
      } catch (error) {
        try {
          await removeManagedWorktree({
            repositoryPath: sourceContext.project.path,
            managedRoot: managedWorktreeRoot(sourceContext.project.id),
            worktreePath: worktree.path,
            recoveryRoot: worktreeRecoveryRoot(sourceContext.project.id),
            force: false,
          });
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "Task fork failed and its clean worktree could not be removed.",
          );
        }
        throw error;
      }
    },
  );

  ipcMain.handle(
    IPC.threadCompact,
    async (_event, threadId: string, instructions?: string): Promise<void> => {
      if (!services.store || !services.agentProcess) {
        throw new Error("Application is not ready.");
      }
      const command = parseThreadCommand({
        type: "thread.compact",
        threadId,
        ...(instructions ? { instructions } : {}),
      });
      const thread = services.store.getThread(command.threadId);
      if (!thread) {
        throw new Error(`Thread not found: ${command.threadId}`);
      }
      if (thread.archived) {
        throw new Error("Archived tasks cannot compact context.");
      }
      if (
        thread.status === "running" ||
        thread.status === "waiting-approval" ||
        activeTurns.has(thread.id)
      ) {
        throw new Error("Stop the active turn before compacting context.");
      }
      if (compactingThreads.has(thread.id)) {
        throw new Error("Context compaction is already running.");
      }

      compactingThreads.add(thread.id);
      try {
        await openAgentThread(thread);
        await services.agentProcess.request({
          type: "thread.compact",
          mode: thread.mode,
          requestId: randomUUID(),
          threadId: thread.id,
          ...(command.instructions
            ? { instructions: command.instructions }
            : {}),
        });
        publishCompactionQueue(thread.id);
        await resumeCompactionFollowUps(thread);
      } catch (error) {
        const items = compactionFollowUps.recover(thread.id);
        if (items.length)
          emitPayload(thread.id, `compaction-queue:${thread.id}`, {
            type: "queue.recovered",
            messages: items.map((item) => item.text),
            items,
          });
        throw error;
      } finally {
        compactingThreads.delete(thread.id);
        // The Pi queue owns successfully dispatched messages from here on.
        emitPayload(thread.id, `compaction-queue:${thread.id}`, {
          type: "queue.updated",
          ...recoverableTurnQueues.snapshot(thread.id),
        });
      }
    },
  );
}

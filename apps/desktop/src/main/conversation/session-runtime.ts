import { designPluginRevisionsRoot } from "../design/design-plugin-thread-data.js";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { app, dialog } from "electron";
import type { TaskWorktree, Thread } from "@artemis/protocol";
import { mainText } from "../settings/i18n.js";
import {
  assertConversationTarget,
  ensureTemporaryConversationWorkspace,
  removeTemporaryConversationWorkspace,
} from "../conversation/temporary-conversation.js";
import { type CreateThreadInput } from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "openedThreads"
  | "openingThreads"
  | "optionalCapabilitiesReady"
  | "store"
  | "agentProcess"
  | "resolveThreadWorkspace"
  | "settingsStore"
  | "imService"
  | "parseThreadCommand"
  | "currentLocale"
  | "mainWindow"
  | "createPermanentTaskWorktree"
  | "createManagedTaskWorktree"
  | "managedWorktreeRoot"
  | "worktreeRecoveryRoot"
  | "removeManagedWorktree"
>;
export function createSessionRuntime(services: Dependencies) {
  const {
    openedThreads,
    openingThreads,
    resolveThreadWorkspace,
    parseThreadCommand,
    currentLocale,
    createPermanentTaskWorktree,
    createManagedTaskWorktree,
    managedWorktreeRoot,
    worktreeRecoveryRoot,
    removeManagedWorktree,
  } = services;
  async function openAgentThread(
    thread: Thread,
    resolvedWorkspacePath?: string,
  ): Promise<void> {
    if (openedThreads.has(thread.id)) {
      return;
    }
    const existing = openingThreads.get(thread.id);
    if (existing) {
      await existing;
      return;
    }
    const opening = (async () => {
      await services.optionalCapabilitiesReady;
      if (openedThreads.has(thread.id)) return;
      if (!services.store || !services.agentProcess) {
        throw new Error("Agent process is not ready.");
      }
      const workspacePath =
        resolvedWorkspacePath ??
        (await resolveThreadWorkspace(thread)).workspacePath;
      const defaultConfiguration =
        !thread.modelSelection || !thread.contextWindow
          ? await services.settingsStore?.runtimeConfiguration()
          : undefined;
      const selection =
        thread.modelSelection ?? defaultConfiguration?.selection;
      const contextWindow =
        thread.contextWindow ?? defaultConfiguration?.contextWindow;
      if (
        selection &&
        contextWindow &&
        (!thread.modelSelection || !thread.contextWindow)
      ) {
        thread = services.store.updateThread(thread.id, {
          modelSelection: selection,
          contextWindow,
        });
      }
      // S2: threads with a frozen typeBinding open plugin-restricted; the
      // declared tools are resolved from the published revision so the
      // agent-host injects them as broker-mediated customTools only for
      // execute-restricted sessions.
      let pluginTools:
        | Array<{
            name: string;
            description: string;
            effect: "artifact-write" | "state-read";
          }>
        | undefined;
      if (thread.typeBinding) {
        try {
          const manifestBytes = await readFile(
            join(
              designPluginRevisionsRoot(app.getPath("userData")),
              thread.typeBinding.installationId,
              thread.typeBinding.contentHash,
              "artemis.plugin.json",
            ),
            "utf8",
          );
          const manifest = JSON.parse(manifestBytes) as {
            tools: Array<{
              name: string;
              description: string;
              effect: "artifact-write" | "state-read";
            }>;
          };
          pluginTools = manifest.tools;
        } catch {
          // Missing revision: open without plugin tools. The dispatcher
          // refuses any tool call for this binding (revision-missing).
        }
      }
      const data = await services.agentProcess.request<{
        sessionFile?: string;
      }>({
        type: "thread.open",
        ...(services.imService?.profile(thread.id)
          ? { remoteExecution: services.imService.profile(thread.id)! }
          : {}),
        ...(services.imService?.hasGroupCollaboration(thread.id)
          ? { groupCollaboration: true }
          : {}),
        requestId: randomUUID(),
        threadId: thread.id,
        workspacePath,
        target: thread.target,
        ...(thread.sessionFile ? { sessionFile: thread.sessionFile } : {}),
        ...(selection ? { selection } : {}),
        ...(contextWindow ? { contextWindow } : {}),
        ...(thread.typeBinding ? { typeBinding: thread.typeBinding } : {}),
        ...(pluginTools ? { pluginTools } : {}),
      });
      if (thread.typeBinding) {
        console.log(
          `[design-panel] thread.open ${thread.id.slice(0, 8)} pluginTools=${pluginTools?.length ?? 0}`,
        );
      }
      if (data.sessionFile) {
        services.store.updateThread(thread.id, {
          sessionFile: data.sessionFile,
        });
      }
      openedThreads.add(thread.id);
    })();
    openingThreads.set(thread.id, opening);
    try {
      await opening;
    } finally {
      if (openingThreads.get(thread.id) === opening) {
        openingThreads.delete(thread.id);
      }
    }
  }

  async function createTaskThread(
    input: CreateThreadInput,
    title?: string,
    taskId?: string,
  ): Promise<Thread | undefined> {
    if (!services.store) {
      throw new Error("Application store is not ready.");
    }
    const command = parseThreadCommand({
      type: "thread.create",
      ...input,
    });
    assertConversationTarget(command.projectId, command.target);
    const project = command.projectId
      ? services.store.getProject(command.projectId)
      : undefined;
    if (command.projectId && !project) {
      throw new Error(`Project not found: ${command.projectId}`);
    }
    const defaults = await services.settingsStore?.runtimeConfiguration();
    const now = new Date().toISOString();
    const thread: Thread = {
      id: taskId ?? randomUUID(),
      ...(command.projectId ? { projectId: command.projectId } : {}),
      title: title ?? mainText(currentLocale(), "waitingForTask"),
      mode: command.mode,
      target: command.target,
      status: "idle",
      ...(defaults?.selection
        ? { modelSelection: structuredClone(defaults.selection) }
        : {}),
      ...(defaults?.contextWindow
        ? { contextWindow: defaults.contextWindow }
        : {}),
      pinned: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    if (command.target === "local") {
      if (!command.projectId) {
        await ensureTemporaryConversationWorkspace(
          app.getPath("userData"),
          thread.id,
        );
        try {
          return services.store.createThread(thread);
        } catch (error) {
          await removeTemporaryConversationWorkspace(
            app.getPath("userData"),
            thread.id,
          );
          throw error;
        }
      }
      return services.store.createThread(thread);
    }

    if (!project) throw new Error("Project not found.");

    let worktree: TaskWorktree;
    if (command.target === "permanent-worktree") {
      if (!services.mainWindow) {
        throw new Error("Application window is not ready.");
      }
      const selection = await dialog.showOpenDialog(services.mainWindow, {
        properties: ["openDirectory"],
        title: mainText(currentLocale(), "selectPermanentWorktree"),
      });
      const selectedPath = selection.filePaths[0];
      if (selection.canceled || !selectedPath) {
        return undefined;
      }
      worktree = await createPermanentTaskWorktree(
        project,
        thread.id,
        selectedPath,
      );
      return services.store.createThreadWithWorktree(thread, worktree).thread;
    }

    worktree = await createManagedTaskWorktree(project, thread.id);
    try {
      return services.store.createThreadWithWorktree(thread, worktree).thread;
    } catch (error) {
      try {
        await removeManagedWorktree({
          repositoryPath: project.path,
          managedRoot: managedWorktreeRoot(project.id),
          worktreePath: worktree.path,
          recoveryRoot: worktreeRecoveryRoot(project.id),
          force: false,
        });
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Task creation failed and its clean worktree could not be removed.",
        );
      }
      throw error;
    }
  }
  return { openAgentThread, createTaskThread };
}

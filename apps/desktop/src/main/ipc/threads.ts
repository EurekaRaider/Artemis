import {
  ConversationShareService,
  shareCommandSchema,
} from "../conversation/conversation-share-service.js";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, dialog } from "electron";
import type { ModelSelection, Thread } from "@artemis/protocol";
import { IPC, type CreateThreadInput } from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "createTaskThread"
  | "ipcMain"
  | "store"
  | "agentProcess"
  | "settingsStore"
  | "activeTurns"
  | "compactingThreads"
  | "resolveModelSelection"
  | "parseThreadCommand"
  | "openedThreads"
  | "resolveThreadWorkspace"
  | "openAgentThread"
  | "mainWindow"
  | "providerLoginService"
  | "conversationShareService"
  | "automaticTaskTitles"
>;

export function registerThreadsIpc(services: Dependencies): void {
  const {
    createTaskThread,
    ipcMain,
    activeTurns,
    compactingThreads,
    resolveModelSelection,
    parseThreadCommand,
    openedThreads,
    resolveThreadWorkspace,
    openAgentThread,
    automaticTaskTitles,
  } = services;

  ipcMain.handle(
    IPC.threadCreate,
    (_event, input: CreateThreadInput): Promise<Thread | undefined> =>
      createTaskThread(input),
  );

  ipcMain.handle(
    IPC.threadModelSet,
    async (
      _event,
      threadId: string,
      selection: ModelSelection,
    ): Promise<Thread> => {
      if (
        !services.store ||
        !services.agentProcess ||
        !services.settingsStore
      ) {
        throw new Error("Application is not ready.");
      }
      const thread = services.store.getThread(String(threadId ?? ""));
      if (!thread) throw new Error(`Thread not found: ${threadId}`);
      if (
        thread.status === "running" ||
        thread.status === "waiting-approval" ||
        activeTurns.has(thread.id) ||
        compactingThreads.has(thread.id)
      ) {
        throw new Error("Stop the active task before changing its model.");
      }
      const resolved = await resolveModelSelection(
        selection,
        thread.modelSelection,
      );
      const command = parseThreadCommand({
        type: "thread.model.set",
        threadId: thread.id,
        selection: resolved.selection,
        contextWindow: resolved.contextWindow,
      });
      if (openedThreads.has(thread.id)) {
        await services.agentProcess.request({
          type: "thread.model.set",
          requestId: randomUUID(),
          threadId: thread.id,
          selection: command.selection,
          contextWindow: command.contextWindow,
        });
      }
      // Remember manual choices for future conversations without reconfiguring other threads.
      await services.settingsStore.setModel(
        command.selection,
        command.contextWindow,
      );
      return services.store.updateThread(thread.id, {
        modelSelection: command.selection,
        contextWindow: command.contextWindow,
      });
    },
  );

  ipcMain.handle(IPC.threadPrepare, async (_event, threadId: string) => {
    if (!services.store) throw new Error("Application store is not ready.");
    const thread = services.store.getThread(String(threadId ?? ""));
    if (!thread || thread.archived) return;
    const context = await resolveThreadWorkspace(thread);
    await openAgentThread(thread, context.workspacePath);
  });

  ipcMain.handle(IPC.conversationShare, async (event, input: unknown) => {
    if (
      event.sender !== services.mainWindow?.webContents ||
      !services.store ||
      !services.settingsStore ||
      !services.providerLoginService
    )
      throw new Error(
        "Conversation sharing is only available to the desktop user.",
      );
    const command = shareCommandSchema.parse(input);
    services.conversationShareService ??= new ConversationShareService({
      directory: join(app.getPath("userData"), "conversation-shares"),
      getThread: (id) => services.store?.getThread(id),
      radiusConfigured: async () =>
        Boolean(
          (await services.settingsStore!.runtimeConfiguration()).credentials
            .radius,
        ),
      radiusAuth: (signal) =>
        services.providerLoginService!.radiusArtifactToken(signal),
    });
    const shares = services.conversationShareService;
    switch (command.type) {
      case "prepare":
        return shares.prepare(command.threadId, command.options);
      case "update":
        return shares.update(
          command.previewId,
          command.options,
          command.excludedIds,
        );
      case "upload":
        return shares.upload(command.previewId, command.destination);
      case "cancel":
        return shares.cancel(command.previewId);
      case "list":
        return shares.list(command.threadId);
      case "delete":
        return shares.delete(command.id);
      case "export": {
        const snapshot = shares.html(command.previewId);
        const selected = await dialog.showSaveDialog({
          defaultPath: `${snapshot.title.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 100) || "conversation"}.html`,
          filters: [{ name: "HTML", extensions: ["html"] }],
        });
        if (selected.canceled || !selected.filePath) return false;
        await writeFile(selected.filePath, snapshot.html, { mode: 0o600 });
        return true;
      }
    }
  });

  ipcMain.handle(
    IPC.threadRename,
    (_event, threadId: string, title: string): Thread => {
      if (!services.store) {
        throw new Error("Application store is not ready.");
      }
      const command = parseThreadCommand({
        type: "thread.rename",
        threadId,
        title,
      });
      if (!services.store.getThread(command.threadId)) {
        throw new Error(`Thread not found: ${command.threadId}`);
      }
      automaticTaskTitles.cancel(command.threadId);
      return services.store.updateThread(command.threadId, {
        title: command.title,
      });
    },
  );
}

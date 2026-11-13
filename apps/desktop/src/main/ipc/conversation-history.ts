import type { ThreadHistoryCursor } from "../../shared/thread-history.js";
import { randomUUID } from "node:crypto";
import { getPlatformContract } from "@artemis/platform";
import { defaultUserName } from "../settings/profile-name.js";
import { IPC } from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "shuttingDown"
  | "mainWindow"
  | "taskNotifications"
  | "store"
  | "computerPreviewWindow"
  | "emitPayload"
  | "ipcMain"
  | "agentProcess"
  | "currentLocale"
  | "settingsStore"
  | "currentPlatform"
  | "windowMaterial"
  | "threadHistoryService"
>;

export function registerConversationHistoryIpc(services: Dependencies): void {
  const { emitPayload, ipcMain, currentLocale, currentPlatform } = services;

  ipcMain.on(IPC.taskView, (event, input: unknown) => {
    if (
      services.shuttingDown ||
      event.sender !== services.mainWindow?.webContents ||
      event.senderFrame !== services.mainWindow.webContents.mainFrame ||
      !services.taskNotifications ||
      !services.store
    )
      return;
    if (!input || typeof input !== "object") return;
    const { threadId, seenSeq, dockOpen } = input as {
      threadId?: unknown;
      seenSeq?: unknown;
      dockOpen?: unknown;
    };
    if (dockOpen !== undefined && typeof dockOpen !== "boolean") return;
    if (
      threadId !== undefined &&
      (typeof threadId !== "string" || !services.store.getThread(threadId))
    )
      return;
    services.taskNotifications.viewedThreadId = threadId as string | undefined;
    services.computerPreviewWindow?.setThread(
      threadId as string | undefined,
      dockOpen === true,
    );
    if (
      typeof threadId === "string" &&
      services.taskNotifications.isViewing(threadId) &&
      typeof seenSeq === "number" &&
      Number.isSafeInteger(seenSeq)
    ) {
      const state = services.store.notifications.markRead(threadId, seenSeq);
      if (state)
        emitPayload(threadId, undefined, {
          type: "thread.notification.updated",
          state,
          threadStatus: services.store.getThread(threadId)!.status,
        });
    }
    services.taskNotifications.refresh();
  });
  const taskSummaries = new Map<string, Promise<string | undefined>>();
  ipcMain.handle(IPC.threadTaskSummary, async (_event, threadId: string) => {
    const thread = services.store?.getThread(String(threadId ?? ""));
    if (!thread || !services.agentProcess) return undefined;
    const locale = currentLocale();
    const selection =
      thread.modelSelection ??
      (await services.settingsStore?.runtimeConfiguration())?.selection;
    if (!selection) return undefined;
    const key = JSON.stringify([thread.id, thread.title, locale, selection]);
    const cached = taskSummaries.get(key);
    if (cached) return cached;
    if (taskSummaries.size >= 128)
      taskSummaries.delete(taskSummaries.keys().next().value!);
    const pending = services.agentProcess
      .request<string>(
        {
          type: "task.generate-summary",
          requestId: randomUUID(),
          title: thread.title,
          locale,
          selection,
        },
        25_000,
      )
      .catch(() => {
        taskSummaries.delete(key);
        return undefined;
      });
    taskSummaries.set(key, pending);
    return pending;
  });
  ipcMain.handle(IPC.snapshot, () => {
    if (!services.store) {
      throw new Error("Application store is not ready.");
    }
    const contract = getPlatformContract();
    const snapshot = services.store.snapshot(
      currentLocale(),
      currentPlatform(),
      {
        available: contract.sandbox.available,
        implementation: contract.sandbox.implementation,
      },
      {
        includeEvents: false,
      },
    );
    // A broken settings file must not block the first render.
    return Promise.resolve(services.settingsStore?.profileName())
      .catch(() => undefined)
      .then((profileName) => ({
        ...snapshot,
        userName: profileName ?? defaultUserName(),
        windowMaterial: services.windowMaterial,
      }));
  });
  ipcMain.handle(
    IPC.threadHistory,
    (_event, threadId: string, cursor?: ThreadHistoryCursor) => {
      if (
        !services.store?.getThread(String(threadId ?? "")) ||
        !services.threadHistoryService
      )
        throw new Error("Thread not found.");
      return services.threadHistoryService.read(threadId, cursor);
    },
  );
  ipcMain.handle(IPC.threadEvents, (_event, threadId: string) => {
    if (!services.store) {
      throw new Error("Application store is not ready.");
    }
    const thread = services.store.getThread(String(threadId ?? ""));
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }
    return services.store.getThreadEvents(thread.id);
  });
  ipcMain.handle(IPC.tokenUsageEvents, () => {
    if (!services.store) {
      throw new Error("Application store is not ready.");
    }
    return services.store.getTokenUsageEvents();
  });
  ipcMain.handle(IPC.promptHistory, () => {
    if (!services.store) {
      throw new Error("Application store is not ready.");
    }
    return services.store.listPromptHistory();
  });
}

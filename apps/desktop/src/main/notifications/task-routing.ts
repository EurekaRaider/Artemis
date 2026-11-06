import {
  dispatchThreadLink,
  parseThreadLink,
} from "../conversation/thread-links.js";
import type { AgentEvent } from "@artemis/protocol";
import { AppStore } from "../settings/store.js";
import { IPC } from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "store"
  | "taskNotifications"
  | "pendingApprovals"
  | "emitPayload"
  | "queuedThreadLink"
  | "threadLinksReady"
  | "pendingThreadLinkId"
  | "mainWindow"
  | "createMainWindow"
  | "notificationRendererReady"
  | "pendingNotificationThreadId"
>;
export function createTaskRouting(services: Dependencies) {
  const { pendingApprovals, emitPayload, createMainWindow } = services;
  function observeTaskNotification(
    event: AgentEvent,
    deferNative = false,
  ): ReturnType<AppStore["notifications"]["observe"]> {
    if (
      ![
        "turn.started",
        "turn.completed",
        "turn.failed",
        "approval.requested",
        "approval.resolved",
        "user-input.requested",
        "user-input.resolved",
      ].includes(event.payload.type)
    )
      return;
    if (!services.store || !services.taskNotifications) return;
    const thread = services.store.getThread(event.threadId);
    if (!thread) return;
    const result = services.store.notifications.observe(event, {
      viewed: services.taskNotifications.isViewing(thread.id),
      suppressCompletion: !!thread.goal && thread.goal.status !== "complete",
      approvalPending:
        event.payload.type === "approval.requested" &&
        pendingApprovals.hasWhere(
          (pending) =>
            pending.request.threadId === thread.id &&
            event.payload.type === "approval.requested" &&
            pending.request.approvalId === event.payload.approvalId,
        ),
    });
    if (!result) return;
    emitPayload(thread.id, undefined, {
      type: "thread.notification.updated",
      state: result.state,
      threadStatus: thread.status,
    });
    if (!deferNative) {
      services.taskNotifications.refresh();
      if (result.notice) services.taskNotifications.show(result.notice);
    }
    return result;
  }

  function openThreadLink(url: string): void {
    if (!parseThreadLink(url)) return;
    if (!services.threadLinksReady) {
      services.queuedThreadLink = url;
      return;
    }
    const show = (id: string | null) => {
      services.pendingThreadLinkId = id;
      if (!services.mainWindow || services.mainWindow.isDestroyed())
        services.mainWindow = createMainWindow();
      if (services.mainWindow.isMinimized()) services.mainWindow.restore();
      services.mainWindow.show();
      services.mainWindow.focus();
      if (services.notificationRendererReady) {
        services.mainWindow.webContents.send(IPC.threadLinkOpen, id);
        services.pendingThreadLinkId = undefined;
      }
    };
    dispatchThreadLink(url, {
      lookup: (id) => services.store?.getThread(id),
      open: show,
      missing: () => show(null),
    });
  }

  function registerThreadLinks(): void {
    services.threadLinksReady = true;
    if (services.queuedThreadLink) {
      const url = services.queuedThreadLink;
      services.queuedThreadLink = undefined;
      openThreadLink(url);
    }
  }

  function openTaskNotification(threadId: string): void {
    services.pendingNotificationThreadId = threadId;
    if (!services.mainWindow || services.mainWindow.isDestroyed()) {
      services.mainWindow = createMainWindow();
      return;
    }
    if (services.mainWindow.isMinimized()) services.mainWindow.restore();
    services.mainWindow.show();
    services.mainWindow.focus();
    if (services.notificationRendererReady) {
      services.mainWindow.webContents.send(IPC.automationThreadOpen, threadId);
      services.pendingNotificationThreadId = undefined;
    }
  }
  return {
    observeTaskNotification,
    openThreadLink,
    registerThreadLinks,
    openTaskNotification,
  };
}

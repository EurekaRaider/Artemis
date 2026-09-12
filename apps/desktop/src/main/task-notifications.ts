import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  app,
  nativeImage,
  Notification,
  shell,
  type BrowserWindow,
} from "electron";
import type { AppLocale } from "@artemis/protocol";
import { taskNotificationCopy } from "../shared/task-notification-copy.js";
import type { AppStore } from "./store.js";
import type { TaskNotice } from "./task-notification-store.js";

const APP_ID = "com.artemis.desktop";
const TOAST_ACTIVATOR_CLSID = "599875E9-0A6F-4FEF-9DCA-FE5E874327F6";

/** Portable Windows builds need the same notification identity as installed builds. */
export async function registerTaskNotifications(): Promise<void> {
  if (process.platform !== "win32") return;
  app.setAppUserModelId(APP_ID);
  app.setToastActivatorCLSID(TOAST_ACTIVATOR_CLSID);
  if (!app.isPackaged) return;
  const directory = join(
    app.getPath("appData"),
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
  );
  await mkdir(directory, { recursive: true });
  if (
    !shell.writeShortcutLink(join(directory, "Artemis.lnk"), "create", {
      target: process.execPath,
      appUserModelId: APP_ID,
      toastActivatorClsid: app.toastActivatorCLSID,
      description: "Artemis",
      icon: process.execPath,
      iconIndex: 0,
    })
  )
    throw new Error("Could not register the Artemis notification shortcut.");
}

// A small native Windows overlay, independent of renderer/theme lifetime.
function unreadOverlay() {
  const size = 16;
  const bitmap = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if ((x - 7.5) ** 2 + (y - 7.5) ** 2 > 49) continue;
      const offset = (y * size + x) * 4;
      bitmap[offset] = 255;
      bitmap[offset + 1] = 133;
      bitmap[offset + 2] = 10;
      bitmap[offset + 3] = 255;
    }
  return nativeImage.createFromBitmap(bitmap, { width: size, height: size });
}

export class TaskNotifications {
  viewedThreadId: string | undefined;
  private readonly delivered = new Map<
    string,
    { notice: TaskNotice; notification: Notification }
  >();
  private overlay: ReturnType<typeof unreadOverlay> | undefined;
  constructor(
    private readonly options: {
      store: AppStore;
      window: () => BrowserWindow | undefined;
      locale: () => AppLocale;
      open: (threadId: string) => void;
      report: (error: unknown) => void;
      disabled?: boolean;
    },
  ) {}

  isViewing(threadId: string): boolean {
    const window = this.options.window();
    return (
      this.viewedThreadId === threadId &&
      !!window &&
      !window.isDestroyed() &&
      window.isFocused() &&
      window.isVisible() &&
      !window.isMinimized()
    );
  }

  private closeNotification(notification: Notification): void {
    try {
      notification.close();
    } catch (error) {
      this.options.report(error);
    }
  }

  refresh(): void {
    for (const [key, entry] of this.delivered) {
      const thread = this.options.store.getThread(entry.notice.threadId);
      if (
        !thread ||
        thread.archived ||
        !this.options.store.notifications.isUnread(thread.id, entry.notice.key)
      ) {
        this.closeNotification(entry.notification);
        this.delivered.delete(key);
      }
    }
    if (this.options.disabled) return;
    const count = this.options.store.notifications.countUnread();
    try {
      if (process.platform === "darwin")
        app.dock?.setBadge(
          count === 0 ? "" : count > 99 ? "99+" : String(count),
        );
      const window = this.options.window();
      if (process.platform === "win32" && window && !window.isDestroyed()) {
        if (count && !this.overlay) this.overlay = unreadOverlay();
        window.setOverlayIcon(
          count ? this.overlay! : null,
          count
            ? `${count} · ${taskNotificationCopy(this.options.locale()).unread}`
            : "",
        );
      }
    } catch (error) {
      this.options.report(error);
    }
  }

  show(notice: TaskNotice): void {
    const thread = this.options.store.getThread(notice.threadId);
    if (
      this.options.disabled ||
      !thread ||
      thread.archived ||
      this.isViewing(thread.id) ||
      !this.options.store.notifications.isUnread(thread.id, notice.key) ||
      !Notification.isSupported()
    )
      return;
    const copy = taskNotificationCopy(this.options.locale());
    try {
      const notification = new Notification({
        title: notice.backgroundProcessesRunning
          ? copy.background
          : copy.titles[notice.kind],
        body: `${Array.from(thread.title).slice(0, 60).join("")} · ${copy.actions[notice.kind]}`,
      });
      const key = `${notice.threadId}\0${notice.key}`;
      // Keep only the latest native notification per task, without marking older updates read.
      for (const [oldKey, entry] of this.delivered)
        if (entry.notice.threadId === thread.id) {
          this.closeNotification(entry.notification);
          this.delivered.delete(oldKey);
        }
      this.delivered.set(key, { notice, notification });
      notification.on("click", () => this.options.open(thread.id));
      notification.on("failed", (_event, error) => {
        this.delivered.delete(key);
        this.options.report(error);
      });
      notification.show();
    } catch (error) {
      this.options.report(error);
    }
  }
}

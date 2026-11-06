import { createTaskRouting } from "../../../src/main/notifications/task-routing.js";
import { IPC } from "../../../src/shared/api.js";
import { describe, expect, it, vi } from "vitest";

describe("native notification navigation", () => {
  it.each([true, false])(
    "waits for the renderer subscription before opening a task (ready=%s)",
    (ready) => {
      const window = {
        isDestroyed: () => false,
        isMinimized: () => true,
        restore: vi.fn(),
        show: vi.fn(),
        focus: vi.fn(),
        webContents: { send: vi.fn() },
      };
      const services = {
        mainWindow: window,
        notificationRendererReady: ready,
        pendingNotificationThreadId: undefined as string | undefined,
        createMainWindow: vi.fn(),
      };
      const routing = createTaskRouting(services as never);
      const navigation = {
        open: routing.openTaskNotification,
        pending: () => services.pendingNotificationThreadId,
      };
      navigation.open("one");
      expect(window.restore).toHaveBeenCalledOnce();
      expect(window.focus).toHaveBeenCalledOnce();
      if (ready) {
        expect(window.webContents.send).toHaveBeenCalledWith(
          IPC.automationThreadOpen,
          "one",
        );
        expect(navigation.pending()).toBeUndefined();
      } else {
        expect(window.webContents.send).not.toHaveBeenCalled();
        expect(navigation.pending()).toBe("one");
      }
    },
  );
});

import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";

const main = readFileSync(
  new URL("../src/main/main.ts", import.meta.url),
  "utf8",
);
const start = main.indexOf("function openTaskNotification(");
const end = main.indexOf("function scheduleTurnChangeSetCompletion(", start);

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
      const load = new Function(
        "mainWindow",
        "notificationRendererReady",
        "createMainWindow",
        "IPC",
        `let pendingNotificationThreadId;
      ${transformSync(main.slice(start, end), { loader: "ts" }).code}
      return { open: openTaskNotification, pending: () => pendingNotificationThreadId };`,
      );
      const navigation = load(window, ready, vi.fn(), {
        automationThreadOpen: "open-task",
      });
      navigation.open("one");
      expect(window.restore).toHaveBeenCalledOnce();
      expect(window.focus).toHaveBeenCalledOnce();
      if (ready) {
        expect(window.webContents.send).toHaveBeenCalledWith(
          "open-task",
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

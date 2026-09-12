import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import { AppStore } from "../src/main/store.js";
import {
  TaskNotifications,
  registerTaskNotifications,
} from "../src/main/task-notifications.js";

const native = vi.hoisted(() => ({
  badge: vi.fn(),
  image: vi.fn(() => ({})),
  identity: vi.fn(),
  activator: vi.fn(),
  shortcut: vi.fn(() => true),
  instances: [] as Array<{
    options: { title: string; body: string };
    show: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    emit: (event: string) => boolean;
  }>,
  supported: true,
  appData: "",
}));
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    app: {
      dock: { setBadge: native.badge },
      setAppUserModelId: native.identity,
      setToastActivatorCLSID: native.activator,
      isPackaged: true,
      toastActivatorCLSID: "test-clsid",
      getPath: () => native.appData,
    },
    shell: { writeShortcutLink: native.shortcut },
    nativeImage: { createFromBitmap: native.image },
    Notification: class extends EventEmitter {
      static isSupported() {
        return native.supported;
      }
      show = vi.fn();
      close = vi.fn();
      constructor(public options: { title: string; body: string }) {
        super();
        native.instances.push(this);
      }
    },
  };
});

const originalPlatform = process.platform;
const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
  Object.defineProperty(process, "platform", { value: originalPlatform });
  native.instances.length = 0;
  native.supported = true;
  vi.clearAllMocks();
});

function fixture(platform: "darwin" | "win32") {
  Object.defineProperty(process, "platform", { value: platform });
  const directory = mkdtempSync(join(tmpdir(), "artemis-native-notice-"));
  native.appData = directory;
  const store = new AppStore(join(directory, "state.sqlite"));
  cleanups.push(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const now = new Date().toISOString();
  store.createThread({
    id: "task",
    title: "Research",
    mode: "execute",
    target: "local",
    status: "idle",
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  });
  let focused = false,
    minimized = false;
  let window = {
    isDestroyed: () => false,
    isFocused: () => focused,
    isVisible: () => true,
    isMinimized: () => minimized,
    setOverlayIcon: vi.fn(),
  };
  const open = vi.fn(),
    report = vi.fn();
  const manager = new TaskNotifications({
    store,
    window: () => window as unknown as BrowserWindow,
    locale: () => "zh-CN",
    open,
    report,
  });
  return {
    store,
    manager,
    open,
    report,
    window,
    focus: (value: boolean) => {
      focused = value;
    },
    minimize: (value: boolean) => {
      minimized = value;
    },
    replaceWindow: () => {
      window = { ...window, setOverlayIcon: vi.fn() };
      return window;
    },
    complete() {
      const event = store.appendEvent("completion", "task", "turn", {
        type: "turn.completed",
        reason: "completed",
      });
      return store.notifications.observe(event, {
        viewed: manager.isViewing("task"),
      })!.notice!;
    },
  };
}

describe("desktop notification adapter", () => {
  it("requires the visible focused conversation; focus alone does not suppress another task", () => {
    const f = fixture("darwin");
    f.focus(true);
    expect(f.manager.isViewing("task")).toBe(false);
    f.manager.viewedThreadId = "task";
    expect(f.manager.isViewing("task")).toBe(true);
    f.minimize(true);
    expect(f.manager.isViewing("task")).toBe(false);
    f.minimize(false);
    const notice = f.complete();
    f.manager.refresh();
    f.manager.show(notice);
    expect(native.badge).toHaveBeenLastCalledWith("");
    expect(native.instances).toHaveLength(0);
  });

  it("updates the Dock and opens the task on click without approving or reading it", () => {
    const f = fixture("darwin");
    const notice = f.complete();
    f.manager.refresh();
    f.manager.show(notice);
    expect(native.badge).toHaveBeenLastCalledWith("1");
    expect(native.instances[0]?.options.title).toBe("任务已完成");
    native.instances[0]!.emit("click");
    expect(f.open).toHaveBeenCalledWith("task");
    expect(f.store.notifications.countUnread()).toBe(1);
    f.store.notifications.markRead("task", notice.seq);
    f.manager.refresh();
    expect(native.badge).toHaveBeenLastCalledWith("");
    expect(native.instances[0]!.close).toHaveBeenCalled();
  });

  it("restores Windows overlays on window recreation and removes them at zero", () => {
    const f = fixture("win32");
    const notice = f.complete();
    f.manager.refresh();
    expect(f.window.setOverlayIcon).toHaveBeenCalledWith(
      expect.any(Object),
      expect.stringContaining("1"),
    );
    const replacement = f.replaceWindow();
    f.manager.refresh();
    expect(replacement.setOverlayIcon).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(String),
    );
    f.store.notifications.markRead("task", notice.seq);
    f.manager.refresh();
    expect(replacement.setOverlayIcon).toHaveBeenLastCalledWith(null, "");
  });

  it("keeps unread state when native notifications are unavailable or fail", () => {
    const f = fixture("darwin");
    const notice = f.complete();
    native.supported = false;
    f.manager.show(notice);
    expect(native.instances).toHaveLength(0);
    native.supported = true;
    f.manager.show(notice);
    native.instances[0]!.emit("failed");
    expect(f.report).toHaveBeenCalled();
    expect(f.store.notifications.countUnread()).toBe(1);
  });

  it("registers the packaged Windows identity and notification shortcut", async () => {
    fixture("win32");
    await registerTaskNotifications();
    expect(native.identity).toHaveBeenCalledWith("com.artemis.desktop");
    expect(native.shortcut).toHaveBeenCalledWith(
      expect.stringContaining("Artemis.lnk"),
      "create",
      expect.objectContaining({
        appUserModelId: "com.artemis.desktop",
        toastActivatorClsid: "test-clsid",
        target: process.execPath,
      }),
    );
  });
});

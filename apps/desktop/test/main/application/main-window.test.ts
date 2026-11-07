import { EventEmitter } from "node:events";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dialog } from "electron";
import { createApplicationWindow } from "../../../src/main/application/main-window.js";
import { configureApplicationHost } from "../../../src/main/application/application-host.js";
import type { ApplicationServices } from "../../../src/main/application/application-services.js";
import { IPC } from "../../../src/shared/api.js";

vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  class Window extends EventEmitter {
    constructor(public options: unknown) {
      super();
    }
    webContents = Object.assign(new EventEmitter(), {
      id: 1,
      isDestroyed: () => false,
      executeJavaScript: vi.fn(async () => undefined),
      send: vi.fn(),
    });
    loadURL = vi.fn(async () => undefined);
    loadFile = vi.fn(async () => undefined);
    close = vi.fn();
  }
  return {
    BrowserWindow: Window,
    nativeTheme: { shouldUseDarkColors: false },
    dialog: { showErrorBox: vi.fn() },
    clipboard: {},
    Menu: {},
    shell: {},
  };
});

function setup() {
  const services = {
    notificationRendererReady: true,
    pendingThreadLinkId: "thread-link",
    pendingNotificationThreadId: "notification",
    windowBackgroundColor: () => "#fff",
    syncMainWindowMaterial: vi.fn(),
    syncAppearanceMedia: vi.fn(),
    workspaceVideoPreview: { clear: vi.fn() },
    workspaceHtmlPreview: { clear: vi.fn() },
    currentLocale: () => "en",
    isEmbeddedBrowserNavigationAllowed: (url: string) =>
      url.startsWith("https://"),
    markStartupStage: vi.fn(),
    scheduleGoalContinuation: vi.fn(),
    store: {
      listThreads: () => [
        { id: "goal-thread", goal: { status: "active", goalId: "goal" } },
      ],
    },
    ipcMain: new EventEmitter(),
    hookSessionsEnded: false,
  };
  const window = createApplicationWindow(
    services as unknown as ApplicationServices,
  );
  return { services, window };
}

afterEach(() => {
  configureApplicationHost({});
  vi.clearAllMocks();
});

describe("main window lifecycle and boundaries", () => {
  it("loads only after the renderer-ready listener is installed and keeps native security defaults", () => {
    let listenersAtLoad = 0;
    configureApplicationHost({
      windowCreated: (window) => {
        listenersAtLoad = window.webContents.listenerCount(
          "will-attach-webview",
        );
      },
    });
    const { window, services } = setup();
    expect(listenersAtLoad).toBe(1);
    expect(services.ipcMain.listenerCount(IPC.rendererReady)).toBe(1);
    expect((window as unknown as { options: unknown }).options).toMatchObject({
      width: 1420,
      height: 920,
      show: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: true,
        backgroundThrottling: true,
      },
    });
    expect(window.loadFile).toHaveBeenCalledWith(
      expect.stringContaining(join("dist-renderer", "index.html")),
    );
  });
  it("flushes edits once before closing and blocks repeated close requests during the flush", async () => {
    const { window } = setup();
    const flush = Promise.withResolvers<void>();
    vi.mocked(window.webContents.executeJavaScript).mockReturnValue(
      flush.promise,
    );
    const event = { preventDefault: vi.fn() };
    window.emit("close", event);
    window.emit("close", event);
    expect(event.preventDefault).toHaveBeenCalledTimes(2);
    expect(window.webContents.executeJavaScript).toHaveBeenCalledOnce();
    expect(window.close).not.toHaveBeenCalled();
    flush.resolve();
    await vi.waitFor(() => expect(window.close).toHaveBeenCalledOnce());
    event.preventDefault.mockClear();
    window.emit("close", event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
  it("keeps the window open on a save failure and permits a retry", async () => {
    const { window } = setup();
    vi.mocked(window.webContents.executeJavaScript).mockRejectedValueOnce(
      new Error("disk full"),
    );
    window.emit("close", { preventDefault: vi.fn() });
    await vi.waitFor(() =>
      expect(dialog.showErrorBox).toHaveBeenCalledWith(
        "Document save failed",
        "Error: disk full",
      ),
    );
    expect(window.close).not.toHaveBeenCalled();
    window.emit("close", { preventDefault: vi.fn() });
    await vi.waitFor(() => expect(window.close).toHaveBeenCalledOnce());
  });
  it("hardens attached webviews before deciding whether navigation is allowed", () => {
    const { window } = setup();
    const preferences = {
      preload: "/untrusted.cjs",
      nodeIntegration: true,
      sandbox: false,
    };
    const event = { preventDefault: vi.fn() };
    window.webContents.emit("will-attach-webview", event, preferences, {
      src: "file:///secret",
    });
    expect(preferences).toMatchObject({
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    });
    expect(preferences).not.toHaveProperty("preload");
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });
  it("delivers pending links and resumes active goals on renderer readiness", () => {
    const { window, services } = setup();
    services.ipcMain.emit(IPC.rendererReady, { sender: window.webContents });
    expect(services.notificationRendererReady).toBe(true);
    expect(window.webContents.send).toHaveBeenCalledWith(
      IPC.threadLinkOpen,
      "thread-link",
    );
    expect(window.webContents.send).toHaveBeenCalledWith(
      IPC.automationThreadOpen,
      "notification",
    );
    expect(services.pendingThreadLinkId).toBeUndefined();
    expect(services.scheduleGoalContinuation).toHaveBeenCalledExactlyOnceWith(
      "goal-thread",
      "goal",
    );
  });
});

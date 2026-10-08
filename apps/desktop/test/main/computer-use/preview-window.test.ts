import { EventEmitter } from "node:events";
import type { BrowserWindow, WebContents } from "electron";
import type { ComputerPreviewHost } from "../../../src/main/computer-use/preview-host.js";
import type { ComputerPreviewState } from "@artemis/protocol";
import { beforeEach, expect, it, vi } from "vitest";
import { ComputerPreviewWindow } from "../../../src/main/computer-use/preview-window.js";
import { IPC } from "../../../src/shared/api.js";

const native = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => void>(),
  windows: [] as any[],
}));
vi.mock("electron", () => ({
  ipcMain: {
    on: (name: string, handler: (...args: any[]) => void) =>
      native.handlers.set(name, handler),
  },
  screen: {
    getDisplayMatching: () => ({
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    }),
  },
  BrowserWindow: class extends EventEmitter {
    visible = false;
    destroyed = false;
    webContents = Object.assign(new EventEmitter(), {
      mainFrame: {},
      send: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    });
    showInactive = vi.fn(() => {
      this.visible = true;
    });
    hide = vi.fn(() => {
      this.visible = false;
    });
    loadURL = vi.fn(async () => {});
    constructor(readonly options: unknown) {
      super();
      native.windows.push(this);
    }
    isDestroyed() {
      return this.destroyed;
    }
    isVisible() {
      return this.visible;
    }
    destroy() {
      this.emit("close");
      this.destroyed = true;
      this.emit("closed");
    }
  },
}));
beforeEach(() => {
  native.windows.length = 0;
  native.handlers.clear();
});

it("uses a frameless readonly window and follows foreground state without stealing focus", () => {
  let focused = true;
  const main = Object.assign(new EventEmitter(), {
    isFocused: () => focused,
    isDestroyed: () => false,
    getBounds: () => ({ x: 0, y: 0, width: 1000, height: 800 }),
  });
  const command = vi.fn(),
    removeContents = vi.fn(),
    control = vi.fn();
  const floating = new ComputerPreviewWindow({
    main: () => main as unknown as BrowserWindow,
    host: () => ({ command, removeContents }) as unknown as ComputerPreviewHost,
    locale: () => "zh-CN",
    control,
  });
  const state: ComputerPreviewState = {
    version: 1,
    sessionId: "session",
    threadId: "task",
    target: { id: "browser:1", kind: "browser", name: "Browser" },
    state: "live",
    timestamp: 0,
    sequence: 0,
    actualFps: 60,
  };
  floating.setThread("task");
  floating.update([state]);
  expect(native.windows).toHaveLength(0);
  focused = false;
  main.emit("blur");
  const window = native.windows[0]!;
  expect(window.options).toMatchObject({
    frame: false,
    focusable: false,
    resizable: true,
    alwaysOnTop: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  const handler = native.handlers.get(IPC.computerPreviewFloating)!;
  const event = {
    sender: window.webContents,
    senderFrame: window.webContents.mainFrame,
  };
  handler(event, { action: "ready" });
  expect(window.showInactive).toHaveBeenCalledOnce();
  floating.update([state]);
  expect(window.showInactive).toHaveBeenCalledOnce();
  floating.setThread("other-task");
  expect(window.isVisible()).toBe(false);
  expect(command).toHaveBeenLastCalledWith(
    expect.objectContaining({ action: "unsubscribe" }),
    window.webContents,
  );
  handler(event, { action: "stop", sessionId: "session" });
  expect(control).not.toHaveBeenCalled();
  floating.setThread("task");
  expect(window.isVisible()).toBe(true);
  expect(window.showInactive).toHaveBeenCalledTimes(2);
  handler(event, { action: "hide", sessionId: "session" });
  expect(command).toHaveBeenLastCalledWith(
    { action: "hide", sessionId: "session" },
    window.webContents,
  );
  expect(control).not.toHaveBeenCalled();
  handler(
    { ...event, senderFrame: {} },
    { action: "stop", sessionId: "session" },
  );
  handler(event, { action: "stop", sessionId: "old-session" });
  expect(control).not.toHaveBeenCalled();
  handler(event, { action: "stop", sessionId: "session" });
  expect(control).toHaveBeenCalledWith("stop", "task");
  focused = true;
  main.emit("focus");
  expect(command).toHaveBeenLastCalledWith(
    expect.objectContaining({ action: "unsubscribe" }),
    window.webContents,
  );
  expect(window.hide).toHaveBeenCalled();
  floating.dispose();
  expect(removeContents).toHaveBeenCalledWith(
    window.webContents as WebContents,
  );
});

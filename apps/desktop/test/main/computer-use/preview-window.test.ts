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
    getBounds = vi.fn(() => ({ x: 100, y: 100, width: 392, height: 236 }));
    getPosition = vi.fn(() => [100, 100]);
    setPosition = vi.fn();
    setSize = vi.fn();
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

it("shows the floating preview only while the main window is unfocused without stealing focus", () => {
  let focused = true;
  const main = Object.assign(new EventEmitter(), {
    isFocused: () => focused,
    isDestroyed: () => false,
    getBounds: () => ({ x: 0, y: 0, width: 1000, height: 800 }),
    webContents: { getZoomFactor: () => 1 },
  });
  const command = vi.fn(),
    removeContents = vi.fn();
  const floating = new ComputerPreviewWindow({
    main: () => main as unknown as BrowserWindow,
    host: () => ({ command, removeContents }) as unknown as ComputerPreviewHost,
    locale: () => "zh-CN",
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
  expect(native.windows).toHaveLength(1);
  const window = native.windows[0]!;
  // The panel extends left from the environment trigger, before the dock toggle.
  const environmentLeft = 1000 - 50 - 280;
  expect(window.options.x + window.options.width).toBeLessThanOrEqual(
    environmentLeft - 24,
  );
  expect(window.options.y).toBeGreaterThanOrEqual(48);
  expect(window.options).toMatchObject({
    frame: false,
    transparent: true,
    hasShadow: false,
    focusable: false,
    resizable: false,
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
  expect(command.mock.calls.every(([input]) => input.action !== "stop")).toBe(
    true,
  );
  floating.setThread("task");
  expect(window.isVisible()).toBe(true);
  expect(window.showInactive).toHaveBeenCalledTimes(2);
  handler(event, { action: "hide", sessionId: "session" });
  expect(command).toHaveBeenLastCalledWith(
    { action: "hide", sessionId: "session" },
    window.webContents,
  );
  handler(
    { ...event, senderFrame: {} },
    { action: "stop", sessionId: "session" },
  );
  handler(event, { action: "stop", sessionId: "old-session" });
  handler(event, { action: "stop", sessionId: "session" });
  expect(command.mock.calls.every(([input]) => input.action !== "stop")).toBe(
    true,
  );
  handler(event, {
    action: "resize",
    sessionId: "old-session",
    width: 500,
    height: 300,
  });
  handler(
    { ...event, senderFrame: {} },
    { action: "resize", sessionId: "session", width: 500, height: 300 },
  );
  handler(event, {
    action: "resize",
    sessionId: "session",
    width: NaN,
    height: 300,
  });
  expect(window.setSize).not.toHaveBeenCalled();
  handler(event, {
    action: "resize",
    sessionId: "session",
    width: 500,
    height: 300,
  });
  expect(window.setSize).toHaveBeenLastCalledWith(500, 300);
  handler(event, {
    action: "resize",
    sessionId: "session",
    width: 10000,
    height: -1,
  });
  expect(window.setSize).toHaveBeenLastCalledWith(1920, 168);
  handler(event, { action: "move", sessionId: "old-session", x: 100, y: 100 });
  handler(event, { action: "move", sessionId: "session", x: NaN, y: 100 });
  expect(window.setPosition).not.toHaveBeenCalled();
  handler(event, { action: "move", sessionId: "session", x: -100, y: 2000 });
  expect(window.setPosition).toHaveBeenLastCalledWith(0, 844);
  focused = false;
  main.emit("blur");
  expect(window.isVisible()).toBe(true);
  focused = true;
  main.emit("focus");
  expect(window.isVisible()).toBe(false);
  expect(command).toHaveBeenLastCalledWith(
    expect.objectContaining({ action: "unsubscribe" }),
    window.webContents,
  );
  floating.update([state]);
  expect(window.isVisible()).toBe(false);
  focused = false;
  main.emit("minimize");
  expect(window.isVisible()).toBe(true);
  for (const status of ["hidden", "ended"] as const) {
    floating.update([{ ...state, state: status }]);
    expect(window.isVisible()).toBe(false);
    floating.update([state]);
    expect(window.isVisible()).toBe(true);
  }
  floating.update([]);
  expect(window.isVisible()).toBe(false);
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

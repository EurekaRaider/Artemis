import type { WebContents } from "electron";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BrowserSessionHost } from "../../../src/main/workspace/browser-session-host.js";
import { IPC } from "../../../src/shared/api.js";

const native = vi.hoisted(() => ({
  windows: [] as { options: unknown }[],
  nextId: 0,
  views: [] as any[],
  owners: new Map<number, any>(),
  displayFrequency: 60,
  ownerBounds: { x: 1920, y: 0, width: 1180, height: 850 },
  displayMatching: vi.fn(),
}));
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  const contents = () => {
    let destroyed = false,
      url = "about:blank";
    const value = Object.assign(new EventEmitter(), {
      id: ++native.nextId,
      isDestroyed: () => destroyed,
      getURL: () => url,
      getTitle: () => "Test",
      navigationHistory: { canGoBack: () => false, canGoForward: () => false },
      isLoading: () => false,
      loadURL: vi.fn(async (next: string) => {
        url = next;
      }),
      close: vi.fn(() => {
        destroyed = true;
        value.emit("destroyed");
      }),
      setFrameRate: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      startPainting: vi.fn(),
      stopPainting: vi.fn(),
      invalidate: vi.fn(),
      setBackgroundThrottling: vi.fn(),
      getMediaSourceId: vi.fn((sender: WebContents) => `capture-${sender.id}`),
    });
    return value;
  };
  const contentView = () => {
    const children = new Set<unknown>();
    return {
      children,
      addChildView: vi.fn((view: unknown) => children.add(view)),
      removeChildView: vi.fn((view: unknown) => children.delete(view)),
    };
  };
  class BaseWindow extends EventEmitter {
    options: unknown;
    destroyed = false;
    size = [1280, 720];
    contentView = contentView();
    constructor(options: unknown) {
      super();
      this.options = options;
      native.windows.push(this);
    }
    isDestroyed() {
      return this.destroyed;
    }
    getContentSize() {
      return this.size;
    }
    setContentSize(width: number, height: number) {
      this.size = [width, height];
    }
    setPosition = vi.fn();
    destroy() {
      this.destroyed = true;
      this.emit("closed");
    }
  }
  return {
    sharedTexture: {},
    screen: { getDisplayMatching: native.displayMatching },
    BaseWindow,
    WebContentsView: class {
      webContents = contents();
      setBounds = vi.fn();
      setVisible = vi.fn();
      constructor(readonly options: unknown) {
        native.views.push(this);
      }
    },
    BrowserWindow: class extends BaseWindow {
      webContents = contents();
      static fromWebContents(sender: WebContents) {
        if (!native.owners.has(sender.id))
          native.owners.set(
            sender.id,
            Object.assign(new EventEmitter(), {
              webContents: sender,
              getBounds: () => native.ownerBounds,
              getContentSize: () => [
                native.ownerBounds.width,
                native.ownerBounds.height,
              ],
              isDestroyed: () => false,
              contentView: contentView(),
            }),
          );
        return native.owners.get(sender.id);
      }
      override destroy() {
        this.webContents.close();
        super.destroy();
      }
    },
  };
});
const owner = (id: number) =>
  ({
    id,
    isDestroyed: () => false,
    send: vi.fn(),
    getZoomFactor: () => 1,
  }) as unknown as WebContents;
function fixture() {
  const register = vi.fn(),
    input = vi.fn(async () => {}),
    changed = vi.fn(),
    closed = vi.fn();
  const releaseDocument = vi.fn(),
    workspaceDocument = vi.fn(
      async (_thread: string, path: string) => `artemis-preview://${path}`,
    );
  const host = new BrowserSessionHost({
    navigationAllowed: (url) =>
      /^(https?:|about:blank|artemis-preview:)/u.test(url),
    register,
    input,
    changed,
    closed,
    workspaceDocument,
    releaseDocument,
  });
  return {
    host,
    register,
    input,
    changed,
    closed,
    workspaceDocument,
    releaseDocument,
  };
}
beforeEach(() => {
  vi.stubGlobal("process", { ...process, platform: "win32" });
  native.windows.length = 0;
  native.views.length = 0;
  native.owners.clear();
  native.displayFrequency = 60;
  native.displayMatching.mockReset().mockImplementation(() => ({
    displayFrequency: native.displayFrequency,
  }));
});
afterEach(() => vi.unstubAllGlobals());

it("uses display-clocked tab capture on macOS without changing browser isolation", async () => {
  vi.stubGlobal("process", { ...process, platform: "darwin" });
  native.displayFrequency = 120.0006;
  const f = fixture(),
    sender = owner(1),
    tab = await f.host.open("one", "browser", "https://example.test");
  expect(native.windows[0]!.options).toMatchObject({
    show: false,
    useContentSize: true,
    enableLargerThanScreen: true,
  });
  expect(native.views[0]!.options).toMatchObject({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
    },
  });
  expect(tab.window.webContents.setFrameRate).not.toHaveBeenCalled();
  expect(
    tab.window.webContents.setBackgroundThrottling,
  ).toHaveBeenLastCalledWith(true);
  const base = { threadId: "one", tabId: "browser", token: "surface" };
  await f.host.command(
    { ...base, action: "subscribe", width: 800, height: 600 },
    sender,
  );
  expect(
    tab.window.webContents.getMediaSourceId,
  ).toHaveBeenCalledExactlyOnceWith(sender);
  expect(sender.send).toHaveBeenCalledWith(
    IPC.computerPreviewMedia,
    "surface",
    {
      id: "capture-1",
      frameRate: 120,
    },
  );
  expect((native.windows[0] as any).setPosition).toHaveBeenCalledWith(
    native.ownerBounds.x,
    native.ownerBounds.y,
  );
  expect(
    tab.window.webContents.setBackgroundThrottling,
  ).toHaveBeenLastCalledWith(false);
  await f.host.command({ ...base, action: "unsubscribe" }, sender);
  expect(
    tab.window.webContents.setBackgroundThrottling,
  ).toHaveBeenLastCalledWith(true);
  expect(sender.send).toHaveBeenLastCalledWith(
    IPC.computerPreviewMedia,
    "surface",
    null,
  );
  expect(tab.window.webContents.startPainting).not.toHaveBeenCalled();
  expect(await f.host.open("one", "browser")).toBe(tab);
  f.host.dispose();
});

it("accepts media failure reports only from the current surface owner", async () => {
  vi.stubGlobal("process", { ...process, platform: "darwin" });
  const f = fixture(),
    sender = owner(1),
    tab = await f.host.open("one", "browser");
  await f.host.command(
    {
      threadId: "one",
      tabId: "browser",
      token: "surface",
      action: "subscribe",
      width: 800,
      height: 600,
    },
    sender,
  );
  f.host.previewFailed(owner(2), "surface", "forged failure");
  expect(tab.stream.stopped()).toBe(false);
  f.host.previewFailed(sender, "surface", "Capture ended");
  expect(tab.stream.stopped()).toBe(true);
  expect(f.host.snapshot(tab).error).toBe("Capture ended");
  expect(sender.send).toHaveBeenLastCalledWith(
    IPC.computerPreviewMedia,
    "surface",
    null,
  );
  f.host.dispose();
});

it.each([59.94, 120.0006, 144, 0, NaN])(
  "matches the visible browser's display frequency (%s Hz), with a safe unknown-rate fallback",
  async (frequency) => {
    const f = fixture(),
      sender = owner(1),
      tab = await f.host.open("one", "browser");
    native.displayFrequency = frequency;
    await f.host.command(
      {
        threadId: "one",
        tabId: "browser",
        token: "surface",
        action: "subscribe",
        width: 800,
        height: 600,
      },
      sender,
    );
    expect(native.displayMatching).toHaveBeenCalledWith(native.ownerBounds);
    expect(tab.window.webContents.setFrameRate).toHaveBeenLastCalledWith(
      frequency > 0 ? Math.round(frequency) : 60,
    );
    f.host.dispose();
  },
);

it("keeps the original browser instance through remounts and isolates other tasks", async () => {
  const f = fixture(),
    tab = await f.host.open("one", "browser", "https://example.test");
  expect(await f.host.open("one", "browser")).toBe(tab);
  const other = await f.host.open("two", "browser");
  expect(f.host.owned("two", tab.window.webContents.id)).toBeUndefined();
  expect(other.window.webContents.id).not.toBe(tab.window.webContents.id);
  expect(native.windows[0]!.options).toMatchObject({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      plugins: true,
      offscreen: { useSharedTexture: true },
    },
  });
  expect(f.register).toHaveBeenCalledWith(tab.window.webContents, "one");
  expect(tab.window.webContents.setFrameRate).toHaveBeenCalledWith(60);
  f.host.clearThread("one");
  expect(tab.window.isDestroyed()).toBe(true);
  expect(other.window.isDestroyed()).toBe(false);
  f.host.dispose();
});

it("rejects foreign tokens before resizing and cancels queued input when its surface disappears", async () => {
  const f = fixture(),
    sender = owner(1),
    tab = await f.host.open("one", "browser");
  const base = { threadId: "one", tabId: "browser", token: "surface" };
  await f.host.command(
    { ...base, action: "subscribe", width: 800, height: 600 },
    sender,
  );
  await expect(
    f.host.command(
      { ...base, action: "subscribe", width: 1900, height: 1000 },
      owner(2),
    ),
  ).rejects.toThrow("ownership");
  expect(tab.window.getContentSize()).toEqual([800, 600]);
  await expect(
    f.host.command(
      {
        ...base,
        token: "foreign",
        action: "input",
        input: { type: "text", text: "unsafe" },
      },
      sender,
    ),
  ).rejects.toThrow("owned surface");
  await expect(
    f.host.command(
      {
        ...base,
        action: "input",
        input: {
          type: "mouse",
          event: "mouseDown",
          x: 800,
          y: 1,
          button: "left",
        },
      },
      sender,
    ),
  ).rejects.toThrow("outside");
  let complete!: () => void;
  f.input.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const first = f.host.command(
    { ...base, action: "input", input: { type: "text", text: "first" } },
    sender,
  );
  await vi.waitFor(() => expect(f.input).toHaveBeenCalledOnce());
  const second = f.host.command(
    { ...base, action: "input", input: { type: "text", text: "second" } },
    sender,
  );
  const cancelled = expect(second).rejects.toThrow("no longer active");
  f.host.removeContents(sender);
  complete();
  await first;
  await cancelled;
  expect(f.input).toHaveBeenCalledOnce();
  expect(tab.window.webContents.stopPainting).toHaveBeenCalled();
  f.host.dispose();
});

it("retains local document leases for back navigation and releases them when the tab closes", async () => {
  const f = fixture(),
    sender = owner(1),
    base = { threadId: "one", tabId: "browser", action: "open" as const };
  await f.host.command({ ...base, path: "first.html" }, sender);
  await f.host.command({ ...base, path: "first.html" }, sender);
  await f.host.command({ ...base, path: "second.html" }, sender);
  expect(f.workspaceDocument).toHaveBeenCalledTimes(2);
  expect(f.releaseDocument).not.toHaveBeenCalled();
  await f.host.command(
    { threadId: "one", tabId: "browser", action: "close" },
    sender,
  );
  expect(f.releaseDocument.mock.calls).toEqual([
    ["one", "artemis-preview://first.html"],
    ["one", "artemis-preview://second.html"],
  ]);
  expect(f.closed).toHaveBeenCalledOnce();
});

it("reopens a crashed renderer instead of returning its closed stream", async () => {
  const f = fixture(),
    tab = await f.host.open("one", "browser");
  tab.window.webContents.emit("render-process-gone");
  expect(f.changed).toHaveBeenLastCalledWith(
    expect.objectContaining({ error: expect.stringContaining("Reopen") }),
  );
  const reopened = await f.host.open("one", "browser");
  expect(reopened.window.webContents.id).not.toBe(tab.window.webContents.id);
  expect(tab.window.isDestroyed()).toBe(true);
  f.host.dispose();
});

it("presents native browser content without capture, parks covered pages for screenshots, and retains tabs after their owner closes", async () => {
  vi.stubGlobal("process", { ...process, platform: "darwin" });
  const f = fixture(),
    sender = owner(1);
  const tab = await f.host.open("one", "browser");
  const base = { threadId: "one", tabId: "browser", token: "surface" };
  const bounds = { x: 100, y: 80, width: 800, height: 600 };
  const present = {
    ...base,
    action: "subscribe" as const,
    width: 800,
    height: 600,
    nativeBounds: bounds,
  };
  await f.host.command(present, sender);
  const view = native.views[0],
    parent = native.owners.get(1);
  expect(f.host.snapshot(tab).nativeView).toBe(true);
  expect(parent.contentView.children.has(view)).toBe(true);
  expect(view.setBounds).toHaveBeenLastCalledWith(bounds);
  expect(view.setVisible).toHaveBeenLastCalledWith(true);
  expect(sender.send).not.toHaveBeenCalled();
  expect(tab.window.webContents.getMediaSourceId).not.toHaveBeenCalled();
  await expect(
    f.host.command({ ...present, width: 1900 }, owner(2)),
  ).rejects.toThrow("ownership");
  expect(tab.window.getContentSize()).toEqual([800, 600]);
  expect(view.setBounds).toHaveBeenLastCalledWith(bounds);
  await f.host.command({ ...present, nativeBounds: null }, sender);
  expect(parent.contentView.children.has(view)).toBe(false);
  expect(view.setVisible).toHaveBeenLastCalledWith(true);
  expect(view.setBounds).toHaveBeenLastCalledWith({
    x: 0,
    y: 0,
    width: 800,
    height: 600,
  });
  await f.host.command(present, sender);
  expect(parent.contentView.children.has(view)).toBe(true);
  f.host.removeContents(sender);
  expect(parent.contentView.children.has(view)).toBe(false);
  expect(tab.window.webContents.isDestroyed()).toBe(false);
  expect(await f.host.open("one", "browser")).toBe(tab);
  await f.host.command(present, sender);
  parent.emit("closed");
  expect(parent.contentView.children.has(view)).toBe(false);
  expect(tab.window.webContents.isDestroyed()).toBe(false);
  f.host.clearThread("one");
  expect(tab.window.webContents.close).toHaveBeenCalledExactlyOnceWith({
    waitForBeforeUnload: false,
  });
});

it("maps native bounds through host zoom and keeps parked pages at the same physical size", async () => {
  vi.stubGlobal("process", { ...process, platform: "darwin" });
  const f = fixture(),
    sender = owner(1);
  sender.getZoomFactor = () => 2;
  const tab = await f.host.open("one", "browser");
  const present = {
    threadId: "one",
    tabId: "browser",
    token: "zoomed",
    action: "subscribe" as const,
    width: 400,
    height: 300,
    nativeBounds: { x: 100, y: 80, width: 400, height: 300 },
  };
  await f.host.command(present, sender);
  const view = native.views[0];
  expect(view.setBounds).toHaveBeenLastCalledWith({
    x: 200,
    y: 160,
    width: 800,
    height: 600,
  });
  expect(tab.window.getContentSize()).toEqual([400, 300]);
  await f.host.command({ ...present, nativeBounds: null }, sender);
  expect(view.setBounds).toHaveBeenLastCalledWith({
    x: 0,
    y: 0,
    width: 800,
    height: 600,
  });
  f.host.dispose();
});

it("clips native surfaces to their owner window and does not let a stale unsubscribe park a replacement surface", async () => {
  vi.stubGlobal("process", { ...process, platform: "darwin" });
  const f = fixture(),
    sender = owner(1);
  const tab = await f.host.open("one", "browser");
  const base = {
    threadId: "one",
    tabId: "browser",
    action: "subscribe" as const,
    width: 800,
    height: 600,
  };
  await f.host.command(
    {
      ...base,
      token: "old",
      nativeBounds: { x: 1100, y: 800, width: 800, height: 600 },
    },
    sender,
  );
  const view = native.views[0];
  expect(view.setBounds).toHaveBeenLastCalledWith({
    x: 1100,
    y: 800,
    width: 80,
    height: 50,
  });
  await f.host.command(
    {
      ...base,
      token: "new",
      nativeBounds: { x: 100, y: 80, width: 800, height: 600 },
    },
    sender,
  );
  await f.host.command(
    { threadId: "one", tabId: "browser", action: "unsubscribe", token: "old" },
    sender,
  );
  expect(native.owners.get(1).contentView.children.has(view)).toBe(true);
  expect(tab.stream.visible()).toBe(true);
  f.host.dispose();
});

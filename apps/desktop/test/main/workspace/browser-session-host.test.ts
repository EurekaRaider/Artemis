import { EventEmitter } from "node:events";
import type { WebContents } from "electron";
import { beforeEach, expect, it, vi } from "vitest";
import { BrowserSessionHost } from "../../../src/main/workspace/browser-session-host.js";

const native = vi.hoisted(() => ({
  windows: [] as { options: unknown }[],
  nextId: 0,
}));
vi.mock("electron", () => ({
  sharedTexture: {},
  BrowserWindow: class extends EventEmitter {
    options: unknown;
    destroyed = false;
    size = [1280, 720];
    url = "about:blank";
    webContents = Object.assign(new EventEmitter(), {
      id: ++native.nextId,
      isDestroyed: () => this.destroyed,
      getURL: () => this.url,
      getTitle: () => "Test",
      navigationHistory: { canGoBack: () => false, canGoForward: () => false },
      isLoading: () => false,
      loadURL: vi.fn(async (url: string) => {
        this.url = url;
      }),
      setFrameRate: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      startPainting: vi.fn(),
      stopPainting: vi.fn(),
      invalidate: vi.fn(),
    });
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
    destroy() {
      this.destroyed = true;
      this.webContents.emit("destroyed");
      this.emit("closed");
    }
  },
}));
const owner = (id: number) =>
  ({ id, isDestroyed: () => false }) as unknown as WebContents;
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
  native.windows.length = 0;
});

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

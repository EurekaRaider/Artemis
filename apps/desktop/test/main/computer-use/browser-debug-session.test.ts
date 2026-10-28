import { EventEmitter } from "node:events";
import type { WebContents } from "electron";
import { expect, it, vi } from "vitest";
import {
  BrowserDebugSession,
  diagnosticText,
} from "../../../src/main/computer-use/browser-debug-session.js";

vi.mock("electron", () => ({
  nativeImage: {
    createFromBuffer: () => ({
      resize: () => ({ toJPEG: () => Buffer.from("image") }),
    }),
  },
}));

it("serializes overlapping overlay and annotation screenshots before restoring emulation", async () => {
  const f = fixture();
  let complete!: (value: { data: string }) => void;
  let captures = 0;
  f.debug.sendCommand.mockImplementation(async (method: string) => {
    if (method === "Page.getLayoutMetrics")
      return {
        cssLayoutViewport: {
          pageX: 0,
          pageY: 0,
          clientWidth: 390,
          clientHeight: 844,
        },
      };
    if (method === "Page.captureScreenshot") {
      captures++;
      if (captures === 1)
        return new Promise((resolve) => {
          complete = resolve;
        });
      return { data: "aW1hZ2U=" };
    }
    return {};
  });
  const first = f.command({ action: "screenshot" });
  await vi.waitFor(() => expect(captures).toBe(1));
  const viewport = f.command({
    action: "viewport",
    viewport: { width: 390, height: 844, scale: 0.5 },
  });
  const presentation = f.session.setPresentation({
    width: 500,
    height: 400,
    scale: 2,
  });
  const second = f.command({ action: "screenshot" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(captures).toBe(1);
  expect(f.page.enableDeviceEmulation).not.toHaveBeenCalled();
  complete({ data: "aW1hZ2U=" });
  await Promise.all([first, viewport, presentation, second]);
  expect(captures).toBe(2);
  f.session.dispose();
});

it("scales native presentation without changing responsive layout or saved preview zoom", async () => {
  const f = fixture();
  await f.session.setPresentation({ width: 600, height: 400, scale: 2 });
  expect(f.page.enableDeviceEmulation).toHaveBeenLastCalledWith(
    expect.objectContaining({
      viewSize: { width: 600, height: 400 },
      scale: 2,
    }),
  );
  expect(f.session.snapshot().viewport).toBeNull();
  const viewport = { width: 390, height: 844, scale: 0.5 };
  await f.command({ action: "viewport", viewport });
  expect(f.page.enableDeviceEmulation).toHaveBeenLastCalledWith(
    expect.objectContaining({
      viewSize: { width: 390, height: 844 },
      scale: 1,
    }),
  );
  expect(f.session.snapshot().viewport).toEqual(viewport);
  await f.session.setPresentation({ width: 600, height: 400, scale: 1 });
  expect(f.page.enableDeviceEmulation).toHaveBeenLastCalledWith(
    expect.objectContaining({
      viewSize: { width: 390, height: 844 },
      scale: 0.5,
    }),
  );
  await f.command({ action: "viewport", viewport: null });
  expect(f.page.disableDeviceEmulation).toHaveBeenCalled();
  f.session.dispose();
});

function fixture() {
  let attached = false;
  const debug = Object.assign(new EventEmitter(), {
    isAttached: () => attached,
    attach: vi.fn(() => {
      attached = true;
    }),
    detach: vi.fn(() => {
      attached = false;
      debug.emit("detach");
    }),
    sendCommand: vi.fn(async () => ({})),
  });
  const page = Object.assign(new EventEmitter(), {
    id: 1,
    debugger: debug,
    isDestroyed: () => false,
    getURL: () => "https://example.test/page?token=secret#private",
    isDevToolsOpened: vi.fn(() => false),
    openDevTools: vi.fn(),
    enableDeviceEmulation: vi.fn(),
    disableDeviceEmulation: vi.fn(),
    reload: vi.fn(),
  });
  const pause = vi.fn();
  const session = new BrowserDebugSession(
    page as unknown as WebContents,
    pause,
  );
  const command = (input: Parameters<typeof session.execute>[0]) =>
    session.execute(input, new AbortController().signal);
  return { session, page, debug, pause, command };
}

it("allows only fixed human IME composition on local documents without expanding AI inspection", async () => {
  const f = fixture();
  f.page.getURL = () => "artemis-pdf://document/test.pdf";
  await f.session.humanComposition("你好", 0, 2, new AbortController().signal);
  expect(f.debug.sendCommand).toHaveBeenCalledWith("Input.imeSetComposition", {
    text: "你好",
    selectionStart: 0,
    selectionEnd: 2,
  });
  await expect(f.session.connect()).rejects.toThrow(
    "Unsupported browser document",
  );
  f.session.dispose();
});

it("bounds and redacts diagnostics without retaining request bodies or headers", async () => {
  const f = fixture();
  await f.command({ action: "snapshot" });
  for (let i = 0; i < 205; i++)
    f.debug.emit("message", {}, "Runtime.consoleAPICalled", {
      type: "error",
      args: [
        {
          type: "string",
          value:
            "token=secret https://user:password@example.test/page?key=hidden#fragment",
        },
      ],
    });
  f.debug.emit("message", {}, "Network.requestWillBeSent", {
    requestId: "one",
    timestamp: 1,
    request: {
      url: "https://example.test/404?token=hidden",
      method: "GET",
      headers: { Authorization: "SECRET" },
      postData: "BODY",
    },
  });
  f.debug.emit("message", {}, "Network.responseReceived", {
    requestId: "one",
    response: { status: 404 },
  });
  f.debug.emit("message", {}, "Network.loadingFinished", {
    requestId: "one",
    timestamp: 1.125,
  });
  const snapshot = f.session.snapshot();
  expect(snapshot.entries).toHaveLength(200);
  expect(snapshot.entries.at(-1)).toMatchObject({
    source: "network",
    status: 404,
    durationMs: 125,
    level: "error",
  });
  expect(JSON.stringify(snapshot)).not.toMatch(
    /hidden|secret|password|fragment|SECRET|BODY/,
  );
  expect(diagnosticText("Authorization: Bearer abc")).not.toContain("abc");
  await f.command({ action: "clear" });
  expect(f.session.snapshot().entries).toEqual([]);
  f.session.dispose();
  expect(f.debug.listenerCount("message")).toBe(0);
});

it("keeps virtual layout dimensions independent from display scale", async () => {
  const f = fixture();
  await f.command({
    action: "viewport",
    viewport: { width: 1440, height: 1100, scale: 0.25 },
  });
  expect(f.page.enableDeviceEmulation).toHaveBeenCalledWith(
    expect.objectContaining({
      viewSize: { width: 1440, height: 1100 },
      scale: 0.25,
    }),
  );
  await expect(
    f.command({ action: "inspect", x: 5, y: 5, navigationId: 0 }),
  ).rejects.toThrow(/Page changed/);
  await f.command({ action: "viewport", viewport: null });
  expect(f.page.disableDeviceEmulation).toHaveBeenCalled();
  await expect(
    f.command({
      action: "viewport",
      viewport: { width: 100000, height: 800, scale: 1 },
    }),
  ).rejects.toThrow();
  f.session.dispose();
});

it("pauses shared CDP control for DevTools and never replays actions on reconnection", async () => {
  const f = fixture();
  await f.command({ action: "snapshot" });
  await f.command({
    action: "viewport",
    viewport: { width: 390, height: 844, scale: 0.5 },
  });
  f.page.enableDeviceEmulation.mockClear();
  await f.command({ action: "devtools" });
  expect(f.pause).toHaveBeenCalled();
  await expect(f.command({ action: "reload" })).rejects.toThrow(/DevTools/);
  f.page.emit("devtools-closed");
  await f.command({ action: "snapshot" });
  expect(f.page.reload).not.toHaveBeenCalled();
  expect(f.page.enableDeviceEmulation).toHaveBeenCalledWith(
    expect.objectContaining({
      viewSize: { width: 390, height: 844 },
      scale: 0.5,
    }),
  );
  f.page.emit(
    "did-start-navigation",
    {},
    "https://example.test/other",
    false,
    true,
  );
  await expect(
    f.command({ action: "inspect", x: 5, y: 5, navigationId: 0 }),
  ).rejects.toThrow(/Page changed/);
  f.session.dispose();
});

it("cleans up after the native WebContents getter becomes unavailable", () => {
  const f = fixture();
  f.page.isDestroyed = () => true;
  Object.defineProperty(f.page, "debugger", {
    get() {
      throw new TypeError("Object has been destroyed");
    },
  });
  expect(() => f.page.emit("destroyed")).not.toThrow();
  expect(f.debug.listenerCount("message")).toBe(0);
  expect(f.debug.listenerCount("detach")).toBe(0);
  expect(() => f.session.dispose()).not.toThrow();
});

it("renders console formatting without CSS arguments and preserves warnings", () => {
  const f = fixture();
  const emit = (values: string[], type = "warning") =>
    f.debug.emit("message", {}, "Runtime.consoleAPICalled", {
      type,
      args: values.map((value) => ({ type: "string", value })),
    });
  emit([
    "%cElectron Security Warning (Insecure Content-Security-Policy)",
    "font-weight: bold;",
    "unsafe-eval",
  ]);
  emit(["%cHello %s%c!", "color:red", "world", "color:blue"]);
  emit(["literal %%c", "keep this"]);
  expect(f.session.snapshot().entries.map((entry) => entry.text)).toEqual([
    "Electron Security Warning (Insecure Content-Security-Policy) unsafe-eval",
    "Hello world!",
    "literal %c keep this",
  ]);
  expect(f.session.snapshot().entries[0]?.level).toBe("warning");
  f.session.dispose();
});

it("bounds an unresponsive browser command and pauses by detaching its debugger", async () => {
  vi.useFakeTimers();
  try {
    const f = fixture();
    f.debug.sendCommand.mockImplementation(async (method: string) =>
      method === "Page.captureScreenshot" ? new Promise(() => {}) : {},
    );
    const controller = new AbortController();
    const pending = f.session.command(
      "Page.captureScreenshot",
      {},
      controller.signal,
    );
    const rejected = expect(pending).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(5000);
    await rejected;
    expect(f.debug.detach).toHaveBeenCalledOnce();
    expect(f.pause).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});
it("cancels a blocked connection before it can dispatch later input", async () => {
  const f = fixture();
  let complete!: () => void;
  f.debug.sendCommand.mockImplementation(async (method: string) =>
    method === "Runtime.enable"
      ? new Promise<void>((resolve) => {
          complete = resolve;
        })
      : {},
  );
  const controller = new AbortController();
  const pending = f.session.command(
    "Input.dispatchKeyEvent",
    { type: "keyDown", key: "Enter" },
    controller.signal,
  );
  await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
  controller.abort(new Error("User stopped control"));
  await expect(pending).rejects.toThrow("User stopped control");
  complete();
  await Promise.resolve();
  expect(f.debug.sendCommand).not.toHaveBeenCalledWith(
    "Input.dispatchKeyEvent",
    expect.anything(),
  );
});

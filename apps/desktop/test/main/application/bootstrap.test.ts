import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app, protocol } from "electron";
import { ensureWindowsPackageAccess } from "../../../src/main/updates/windows-package-access.js";
import { bootstrapDesktop } from "../../../src/main/application/bootstrap-application.js";

vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    app: Object.assign(new EventEmitter(), {
      isPackaged: false,
      getVersion: () => "1.0.0",
      getPath: () => "test-user-data",
      requestSingleInstanceLock: vi.fn(() => true),
      quit: vi.fn(),
      exit: vi.fn(),
      whenReady: vi.fn(async () => undefined),
      setAsDefaultProtocolClient: vi.fn(),
    }),
    protocol: { registerSchemesAsPrivileged: vi.fn() },
    BrowserWindow: { getAllWindows: () => [] },
    dialog: { showErrorBox: vi.fn() },
  };
});
vi.mock("../../../src/main/updates/windows-package-access.js", () => ({
  ensureWindowsPackageAccess: vi.fn(async () => undefined),
}));
vi.mock("../../../src/main/platform/stdio-guard.js", () => ({
  guardStdio: vi.fn(),
}));
afterEach(() => {
  app.removeAllListeners();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  Object.assign(app, { isPackaged: false });
});

describe("desktop bootstrap", () => {
  it("waits for readiness, starts once and then delivers a buffered deep link", async () => {
    const ready = Promise.withResolvers<void>();
    vi.mocked(app.whenReady).mockReturnValueOnce(ready.promise);
    const trace: string[] = [];
    const target = {
      startDesktopApplication: vi.fn(() => {
        trace.push("start");
      }),
      openThreadLink: vi.fn(() => {
        trace.push("link");
      }),
    };
    const load = vi.fn(async () => target);
    bootstrapDesktop(load);
    const url = "artemis://thread/00000000-0000-0000-0000-000000000001";
    app.emit("open-url", { preventDefault: vi.fn() }, url);
    expect(load).not.toHaveBeenCalled();
    ready.resolve();
    await vi.waitFor(() =>
      expect(target.openThreadLink).toHaveBeenCalledExactlyOnceWith(url),
    );
    expect(trace).toEqual(["start", "link"]);
    expect(target.startDesktopApplication).toHaveBeenCalledOnce();
    expect(protocol.registerSchemesAsPrivileged).toHaveBeenCalledOnce();
  });
  it("does not load the application when another instance owns the lock", () => {
    vi.mocked(app.requestSingleInstanceLock).mockReturnValueOnce(false);
    const load = vi.fn();
    bootstrapDesktop(load);
    expect(app.quit).toHaveBeenCalledOnce();
    expect(load).not.toHaveBeenCalled();
  });
  it("strips development selectors before a packaged application is loaded", async () => {
    Object.assign(app, { isPackaged: true });
    vi.stubEnv("ARTEMIS_SMOKE_SCREENSHOT", "/untrusted.png");
    vi.stubEnv("ARTEMIS_DEV_SERVER_URL", "http://untrusted");
    const selectorsAtLoad = vi.fn();
    const load = vi.fn(async () => {
      selectorsAtLoad(
        process.env.ARTEMIS_SMOKE_SCREENSHOT,
        process.env.ARTEMIS_DEV_SERVER_URL,
      );
      return { startDesktopApplication: vi.fn(), openThreadLink: vi.fn() };
    });
    bootstrapDesktop(load);
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    expect(selectorsAtLoad).toHaveBeenCalledExactlyOnceWith(
      undefined,
      undefined,
    );
    if (process.platform === "win32")
      expect(ensureWindowsPackageAccess).toHaveBeenCalledOnce();
  });
});

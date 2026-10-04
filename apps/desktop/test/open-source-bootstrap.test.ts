import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  ready: Promise.resolve(),
  locked: true,
  events: new Map<string, () => void>(),
  enter: vi.fn(),
  schemes: vi.fn(),
  quit: vi.fn(),
  exit: vi.fn(),
}));
vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    requestSingleInstanceLock: () => state.locked,
    whenReady: () => state.ready,
    on: (name: string, fn: () => void) => state.events.set(name, fn),
    quit: state.quit,
    exit: state.exit,
    disableHardwareAcceleration: vi.fn(),
  },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: { showErrorBox: vi.fn() },
  protocol: { registerSchemesAsPrivileged: state.schemes },
}));
vi.mock("../src/main/main.js", () => {
  state.enter();
  return {};
});
vi.mock("../src/main/windows-package-access.js", () => ({
  ensureWindowsPackageAccess: vi.fn(),
}));
vi.mock("../src/main/workspace-pdf-preview.js", () => ({
  WORKSPACE_PDF_SCHEME: "artemis-pdf",
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  state.events.clear();
  state.locked = true;
});
it("registers protocols and starts without a device, license storage or activation IPC", async () => {
  await import("../src/main/bootstrap.js");
  await vi.waitFor(() => expect(state.enter).toHaveBeenCalledOnce());
  expect(state.schemes).toHaveBeenCalledOnce();
  expect(state.events.has("second-instance")).toBe(true);
  expect(state.events.has("resume")).toBe(false);
  expect(state.exit).not.toHaveBeenCalled();
});
it("does not initialize a second application instance", async () => {
  state.locked = false;
  await import("../src/main/bootstrap.js");
  expect(state.quit).toHaveBeenCalledOnce();
  expect(state.enter).not.toHaveBeenCalled();
});

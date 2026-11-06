import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { IPC } from "../../../src/shared/api.js";
import channels from "../../fixtures/ipc/channels.json";
import { registerIpc } from "../../../src/main/ipc/register-ipc.js";
import type { ApplicationServices } from "../../../src/main/application/application-services.js";
const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("../../../src/main/workspace/project-instructions.js", () => ({
  ProjectInstructions: class {
    read = mocks.read;
    write = mocks.write;
  },
}));
vi.mock("electron", () => ({
  app: {
    getPath: () => "/isolated-profile",
    getAppPath: () => "/app",
    getVersion: () => "2.0.3",
  },
  BrowserWindow: {},
  dialog: {},
  nativeTheme: {},
  shell: {},
  clipboard: {},
  session: {},
}));
vi.mock("../../../src/main/design/design-pack-runtime.js", () => ({
  createDesignPackRuntime: () => ({
    syncActiveRevision: async () => undefined,
  }),
}));
vi.mock("../../../src/main/workspace/workspace-tab-menu-window.js", () => ({
  setWorkspaceTabMenuHandlers: vi.fn(),
  showWorkspaceTabMenu: vi.fn(),
  closeWorkspaceTabMenu: vi.fn(),
  workspaceTabMenuParent: vi.fn(),
}));

async function setup() {
  const handlers = new Map<string, (...args: any[]) => any>();
  const listeners = new Map<string, (...args: any[]) => any>();
  const register =
    (map: typeof handlers) =>
    (channel: string, handler: (...args: any[]) => any) => {
      if (map.has(channel)) throw new Error(`Duplicate IPC: ${channel}`);
      map.set(channel, handler);
    };
  const instructions = mocks;
  mocks.read.mockClear();
  mocks.write.mockClear();
  const frame = {};
  const sender = { id: 41, mainFrame: frame };
  const dependencies = {
    IPC,
    join,
    installOfficeSuite: vi.fn(),
    getOfficeWorkbench: vi.fn(async () => ({})),
    createDesignPackRuntime: () => ({
      syncActiveRevision: async () => undefined,
    }),
    designPluginRevisionsRoot: () => "/isolated-profile/revisions",
    process: { env: {} },
    ipcMain: { handle: register(handlers), on: register(listeners) },
    ProjectInstructions: class {
      read = instructions.read;
      write = instructions.write;
    },
    app: {
      getPath: () => "/isolated-profile",
      getAppPath: () => "/app",
      getVersion: () => "2.0.3",
    },
    readStartupFile: () => {
      throw new Error("No preferences");
    },
    setWorkspaceTabMenuHandlers: vi.fn(),
    designPanelHost: undefined,
    mainWindow: { webContents: sender },
    store: undefined,
    releaseUpdateManager: undefined,
    browserSessionHost: undefined,
    computerPreviewHost: undefined,
    computerUseHost: undefined,
    shuttingDown: false,
    taskNotifications: undefined,
    settingsStore: undefined,
    providerLoginService: undefined,
  };
  registerIpc(dependencies as unknown as ApplicationServices);
  return {
    dependencies,
    handlers,
    listeners,
    instructions,
    event: { sender, senderFrame: frame },
  };
}

describe("desktop IPC registration and behavior", () => {
  it("registers the complete existing invoke/event contract exactly once", async () => {
    const f = await setup();
    expect([...f.handlers.keys()].sort()).toEqual(
      channels
        .filter((x) => x.kind === "handle")
        .map((x) => IPC[x.key as keyof typeof IPC])
        .sort(),
    );
    expect([...f.listeners.keys()].sort()).toEqual(
      channels
        .filter((x) => x.kind === "on")
        .map((x) => IPC[x.key as keyof typeof IPC])
        .sort(),
    );
  });
  it("rejects another window and subframes before accessing project instructions", async () => {
    const f = await setup();
    const write = f.handlers.get(IPC.projectInstructionsWrite)!;
    expect(() =>
      write({ ...f.event, sender: { id: 9 } }, "p", "content"),
    ).toThrow("Artemis main window");
    expect(() =>
      write({ ...f.event, senderFrame: {} }, "p", "content"),
    ).toThrow("Artemis main window");
    expect(f.instructions.write).not.toHaveBeenCalled();
    write(f.event, "p", "content");
    expect(f.instructions.write).toHaveBeenCalledExactlyOnceWith(
      "p",
      "content",
    );
  });
  it("keeps project instruction arity checks ahead of reads and writes", async () => {
    const f = await setup();
    expect(() =>
      f.handlers.get(IPC.projectInstructionsRead)!(f.event, "p", "extra"),
    ).toThrow("identity only");
    expect(() =>
      f.handlers.get(IPC.projectInstructionsWrite)!(f.event, "p"),
    ).toThrow("identity and content");
    expect(f.instructions.read).not.toHaveBeenCalled();
    expect(f.instructions.write).not.toHaveBeenCalled();
  });
  it("keeps not-ready errors and harmless preview defaults", async () => {
    const f = await setup();
    expect(() => f.handlers.get(IPC.snapshot)!()).toThrow(
      "Application store is not ready",
    );
    await expect(f.handlers.get(IPC.updateInstall)!()).rejects.toThrow(
      "Update service is not ready",
    );
    expect(f.handlers.get(IPC.computerPreviews)!(f.event)).toEqual([]);
    expect(f.handlers.get(IPC.computerState)!(f.event)).toEqual({
      version: 1,
      state: "idle",
    });
  });
  it("ignores task view events until the notification service is available", async () => {
    const f = await setup();
    expect(() =>
      f.listeners.get(IPC.taskView)!(f.event, {
        threadId: "missing",
        seenSeq: 1,
      }),
    ).not.toThrow();
  });
  it("uses the current main window after IPC registration", async () => {
    const f = await setup();
    const frame = {};
    const sender = { id: 42, mainFrame: frame };
    f.dependencies.mainWindow = { webContents: sender };
    const write = f.handlers.get(IPC.projectInstructionsWrite)!;
    expect(() => write(f.event, "p", "old")).toThrow("Artemis main window");
    write({ sender, senderFrame: frame }, "p", "new");
    expect(f.instructions.write).toHaveBeenCalledExactlyOnceWith("p", "new");
  });
});

import { describe, expect, it, vi } from "vitest";
import { app, dialog } from "electron";
import { installApplicationLifecycle } from "../../../src/main/application/lifecycle.js";
import type { ApplicationServices } from "../../../src/main/application/application-services.js";
vi.mock("electron", () => ({
  app: { on: vi.fn(), quit: vi.fn() },
  dialog: { showErrorBox: vi.fn() },
  shell: { openExternal: vi.fn() },
}));
function mainListener(event: string, context: object) {
  installApplicationLifecycle(context as ApplicationServices);
  return vi
    .mocked(app.on)
    .mock.calls.findLast((call) => call[0] === event)![1] as (
    ...args: any[]
  ) => void;
}

function dependencies() {
  const trace: string[] = [];
  vi.mocked(app.on).mockClear();
  vi.mocked(app.quit)
    .mockReset()
    .mockImplementation(() => {
      trace.push("quit");
    });
  vi.mocked(dialog.showErrorBox).mockReset();
  const dispose = (name: string) => ({
    dispose: vi.fn(() => trace.push(name)),
  });
  const context = {
    app,
    dialog,
    providerLoginService: { cancel: vi.fn() },
    conversationShareService: dispose("share"),
    computerUseHost: dispose("computer"),
    computerPreviewHost: dispose("preview"),
    computerPreviewWindow: dispose("preview-window"),
    browserSessionHost: dispose("browser"),
    mainWindow: undefined,
    officeWorkbench: undefined,
    openedThreads: new Set(),
    activeTurns: new Map(),
    pendingUserInputs: { cancelWhere: () => [] },
    pendingMultiUserInputs: { cancelWhere: () => [] },
    automationScheduler: { stop: vi.fn(() => trace.push("scheduler")) },
    pluginDispatch: dispose("plugin"),
    designPanelHost: { disposeAll: vi.fn(() => trace.push("panels")) },
    hooksService: dispose("hooks"),
    mcpClientManager: dispose("mcp"),
    imService: {
      quiesce: vi.fn(async () => {
        trace.push("im-quiesce");
      }),
      stop: vi.fn(() => trace.push("im-stop")),
    },
    cancelTaskTurn: vi.fn(async () => {
      trace.push("cancel-turn");
    }),
    endHookSession: vi.fn(async () => {
      trace.push("end-hook");
    }),
    endingHookSessions: false,
    hookSessionsEnded: false,
    shuttingDown: false,
    releaseUpdateManager: { stopAutomaticChecks: vi.fn() },
    sleepPrevention: dispose("sleep"),
    stopAgentCapacityMonitoring: vi.fn(),
    terminalService: dispose("terminal"),
    trustedExtensionManager: dispose("extensions"),
    packagedNodePtyRuntimeReady: undefined,
    agentProcess: dispose("agent"),
    appearanceService: dispose("appearance"),
    threadHistoryService: { close: vi.fn(() => trace.push("history")) },
    store: { close: vi.fn(() => trace.push("store")) },
  };
  return { context, trace };
}

describe("desktop lifecycle shutdown order", () => {
  it("keeps the database open during before-quit and closes it after history at will-quit", async () => {
    const f = dependencies();
    const before = await mainListener("before-quit", f.context);
    const event = { preventDefault: vi.fn() };
    before(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(f.context.agentProcess.dispose).toHaveBeenCalledOnce();
    expect(f.context.store.close).not.toHaveBeenCalled();
    (await mainListener("will-quit", f.context))();
    expect(f.trace.slice(-4)).toEqual([
      "appearance",
      "im-stop",
      "history",
      "store",
    ]);
  });
  it("flushes editors before cancelling turns and ending sessions", async () => {
    const f = dependencies();
    const flush = vi.fn(async () => {
      f.trace.push("flush");
    });
    const context = {
      ...f.context,
      mainWindow: {
        webContents: { isDestroyed: () => false, executeJavaScript: flush },
      },
      openedThreads: new Set(["thread"]),
      activeTurns: new Map([["thread", "turn"]]),
    };
    const listener = await mainListener("before-quit", context);
    const event = { preventDefault: vi.fn() };
    listener(event);
    listener(event);
    await vi.waitFor(() => expect(context.app.quit).toHaveBeenCalledOnce());
    expect(flush).toHaveBeenCalledOnce();
    expect(context.cancelTaskTurn).toHaveBeenCalledOnce();
    expect(context.cancelTaskTurn.mock.calls[0]?.[0]).toBe("thread");
    expect(context.endHookSession).toHaveBeenCalledExactlyOnceWith("thread");
    expect(f.trace.indexOf("flush")).toBeLessThan(
      f.trace.indexOf("cancel-turn"),
    );
    expect(f.trace.indexOf("cancel-turn")).toBeLessThan(
      f.trace.indexOf("end-hook"),
    );
    expect(context.store.close).not.toHaveBeenCalled();
  });
  it("keeps the app open and reports a failed editor flush without cancelling work", async () => {
    const f = dependencies();
    const context = {
      ...f.context,
      mainWindow: {
        webContents: {
          isDestroyed: () => false,
          executeJavaScript: vi.fn(async () => {
            throw new Error("disk full");
          }),
        },
      },
    };
    const listener = await mainListener("before-quit", context);
    listener({ preventDefault: vi.fn() });
    await vi.waitFor(() =>
      expect(context.dialog.showErrorBox).toHaveBeenCalledWith(
        "Document save failed",
        "Error: disk full",
      ),
    );
    expect(context.app.quit).not.toHaveBeenCalled();
    expect(context.cancelTaskTurn).not.toHaveBeenCalled();
    expect(context.store.close).not.toHaveBeenCalled();
  });
});

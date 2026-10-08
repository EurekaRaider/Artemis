import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";

const main = readFileSync(
  new URL("../../../src/main/main.ts", import.meta.url),
  "utf8",
);

describe("task notification shutdown", () => {
  it("binds floating preview only to validated current-session messages", () => {
    const start = main.indexOf("  ipcMain.on(IPC.taskView,");
    const end = main.indexOf("  const taskSummaries", start);
    let handler: (event: unknown, input: unknown) => void;
    const sender = { mainFrame: {} };
    const setThread = vi.fn();
    const notifications = { refresh: vi.fn(), isViewing: () => false };
    new Function(
      "ipcMain",
      "IPC",
      "mainWindow",
      "taskNotifications",
      "store",
      "shuttingDown",
      "emitPayload",
      "computerPreviewWindow",
      transformSync(main.slice(start, end), { loader: "ts" }).code,
    )(
      {
        on: (_channel: string, callback: typeof handler) => {
          handler = callback;
        },
      },
      { taskView: "task-view" },
      { webContents: sender },
      notifications,
      {
        getThread: (id: string) =>
          ["one", "two"].includes(id) ? { id } : undefined,
      },
      false,
      vi.fn(),
      { setThread },
    );
    const event = { sender, senderFrame: sender.mainFrame };
    handler!({ ...event, sender: {} }, { threadId: "one" });
    handler!({ ...event, senderFrame: {} }, { threadId: "one" });
    handler!(event, { threadId: "missing" });
    expect(setThread).not.toHaveBeenCalled();
    handler!(event, { threadId: "one" });
    handler!(event, { threadId: "two" });
    handler!(event, {});
    expect(setThread.mock.calls).toEqual([["one"], ["two"], [undefined]]);
  });

  it("ignores late task-view messages before touching a closing store", () => {
    const start = main.indexOf("  ipcMain.on(IPC.taskView,");
    const end = main.indexOf("  const taskSummaries", start);
    let handler: (event: unknown, input: unknown) => void;
    const sender = { mainFrame: {} };
    const store = {
      getThread: vi.fn(() => {
        throw new Error("database is not open");
      }),
    };
    const refresh = vi.fn();
    new Function(
      "ipcMain",
      "IPC",
      "mainWindow",
      "taskNotifications",
      "store",
      "shuttingDown",
      "emitPayload",
      transformSync(main.slice(start, end), { loader: "ts" }).code,
    )(
      {
        on: (_channel: string, callback: typeof handler) => {
          handler = callback;
        },
      },
      { taskView: "task-view" },
      { webContents: sender },
      { refresh },
      store,
      true,
      vi.fn(),
    );
    expect(() =>
      handler!(
        { sender, senderFrame: sender.mainFrame },
        { threadId: "one", seenSeq: 4 },
      ),
    ).not.toThrow();
    expect(store.getThread).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("keeps the database open until will-quit, after windows finish closing", () => {
    const handlers = new Map<string, () => void>();
    const close = vi.fn();
    new Function(
      "app",
      "store",
      `
      let shuttingDown = false;
      const hookSessionsEnded = true, hooksService = undefined;
      const imService = undefined, automationScheduler = undefined, terminalService = undefined;
      const packagedNodePtyRuntimeReady = undefined, packagedNodePtyRuntime = undefined;
      const mcpClientManager = undefined, agentProcess = undefined, computerUseHost = undefined;
      const computerPreviewHost = undefined, computerPreviewWindow = undefined, browserSessionHost = undefined;
      const trustedExtensionManager = undefined, providerLoginService = undefined;
      const appearanceService = undefined;
      const pluginDispatch = undefined, designPanelHost = undefined;
      const threadHistoryService = undefined, releaseUpdateManager = undefined;
      const sleepPrevention = { dispose: () => {} };
      const pendingUserInputs = { cancelWhere: () => [] };
      const pendingMultiUserInputs = { cancelWhere: () => [] };
      const stopAgentCapacityMonitoring = () => {};
      ${transformSync(main.slice(main.indexOf('app.on("before-quit",')), { loader: "ts" }).code}
    `,
    )(
      {
        on: (event: string, callback: () => void) =>
          handlers.set(event, callback),
      },
      { close },
    );
    handlers.get("before-quit")!();
    expect(close).not.toHaveBeenCalled();
    handlers.get("will-quit")!();
    expect(close).toHaveBeenCalledOnce();
  });
});

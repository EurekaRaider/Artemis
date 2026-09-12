import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";

const main = readFileSync(
  new URL("../src/main/main.ts", import.meta.url),
  "utf8",
);

describe("task notification shutdown", () => {
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
    const stopPreview = vi.fn();
    new Function(
      "app",
      "store",
      "designs",
      `
      let shuttingDown = false;
      const imService = undefined, automationScheduler = undefined, terminalService = undefined;
      const packagedNodePtyRuntimeReady = undefined, packagedNodePtyRuntime = undefined;
      const mcpClientManager = undefined, agentProcess = undefined;
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
      { hasDrafts: () => false, preview: { stop: stopPreview } },
    );
    handlers.get("before-quit")!();
    expect(stopPreview).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    handlers.get("will-quit")!();
    expect(close).toHaveBeenCalledOnce();
  });
});

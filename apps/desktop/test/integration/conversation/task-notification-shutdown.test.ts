import { app } from "electron";
import { describe, expect, it, vi } from "vitest";
import { registerConversationHistoryIpc } from "../../../src/main/ipc/conversation-history.js";
import { installApplicationLifecycle } from "../../../src/main/application/lifecycle.js";
import type { ApplicationServices } from "../../../src/main/application/application-services.js";
import { IPC } from "../../../src/shared/api.js";

vi.mock("electron", () => ({
  app: { on: vi.fn(), quit: vi.fn() },
  dialog: {},
  shell: {},
}));
function taskView(services: object) {
  const listeners = new Map<string, (...args: any[]) => void>();
  registerConversationHistoryIpc({
    ...services,
    ipcMain: {
      handle: vi.fn(),
      on: (channel: string, handler: (...args: any[]) => void) =>
        listeners.set(channel, handler),
    },
  } as unknown as ApplicationServices);
  return listeners.get(IPC.taskView)!;
}
describe("task notification shutdown", () => {
  it("binds floating preview only to validated current-session messages", () => {
    const sender = { mainFrame: {} };
    const setThread = vi.fn();
    const notifications = { refresh: vi.fn(), isViewing: () => false };
    const handler = taskView({
      mainWindow: { webContents: sender },
      taskNotifications: notifications,
      store: {
        getThread: (id: string) =>
          ["one", "two"].includes(id) ? { id } : undefined,
      },
      shuttingDown: false,
      emitPayload: vi.fn(),
      computerPreviewWindow: { setThread },
    });
    const event = { sender, senderFrame: sender.mainFrame };
    handler({ ...event, sender: {} }, { threadId: "one" });
    handler({ ...event, senderFrame: {} }, { threadId: "one" });
    handler(event, { threadId: "missing" });
    handler(event, { threadId: "one", dockOpen: "true" });
    expect(setThread).not.toHaveBeenCalled();
    handler(event, { threadId: "one" });
    handler(event, { threadId: "two", dockOpen: true });
    handler(event, {});
    expect(setThread.mock.calls).toEqual([
      ["one", false],
      ["two", true],
      [undefined, false],
    ]);
  });
  it("ignores late task-view messages before touching a closing store", () => {
    const sender = { mainFrame: {} };
    const store = {
      getThread: vi.fn(() => {
        throw new Error("database is not open");
      }),
    };
    const refresh = vi.fn();
    const handler = taskView({
      mainWindow: { webContents: sender },
      taskNotifications: { refresh },
      store,
      shuttingDown: true,
      emitPayload: vi.fn(),
    });
    expect(() =>
      handler(
        { sender, senderFrame: sender.mainFrame },
        { threadId: "one", seenSeq: 4 },
      ),
    ).not.toThrow();
    expect(store.getThread).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
  it("keeps the database open until will-quit, after windows finish closing", () => {
    const close = vi.fn();
    const stopIm = vi.fn();
    const disposeShares = vi.fn();
    vi.mocked(app.on).mockClear();
    installApplicationLifecycle({
      store: { close },
      imService: { stop: stopIm },
      hookSessionsEnded: true,
      conversationShareService: { dispose: disposeShares },
      sleepPrevention: { dispose: vi.fn() },
      pendingUserInputs: { cancelWhere: () => [] },
      pendingMultiUserInputs: { cancelWhere: () => [] },
      stopAgentCapacityMonitoring: vi.fn(),
    } as unknown as ApplicationServices);
    const handlers = new Map(vi.mocked(app.on).mock.calls);
    handlers.get("before-quit")!({ preventDefault: vi.fn() });
    expect(disposeShares).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    expect(stopIm).not.toHaveBeenCalled();
    handlers.get("will-quit")!();
    expect(close).toHaveBeenCalledOnce();
    expect(stopIm).toHaveBeenCalledOnce();
  });
});

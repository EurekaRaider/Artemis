import { describe, expect, it, vi } from "vitest";
import { threadCommandSchema } from "@artemis/protocol";
import { registerThreadMaintenanceIpc } from "../../../src/main/ipc/thread-maintenance.js";
import { IPC } from "../../../src/shared/api.js";
const mocks = vi.hoisted(() => ({
  deleteTranscript: vi.fn(async () => {}),
  worktrees: vi.fn(async () => []),
}));
vi.mock("electron", () => ({ app: { getPath: () => "/test" } }));
vi.mock("../../../src/main/conversation/pi-session-delete.js", () => ({
  deletePiSessionTranscript: mocks.deleteTranscript,
  piSessionsRoot: () => "/sessions",
}));
vi.mock("../../../src/main/workspace/git-worktree.js", () => ({
  listGitWorktrees: mocks.worktrees,
}));

describe("fork failure cleanup", () => {
  it.each([
    "image-copy",
    "attachment-copy",
    "database",
    "worktree-registration",
  ])("removes only fork artifacts on %s failure", async (failure) => {
    mocks.deleteTranscript.mockClear();
    const handlers = new Map<string, (...args: any[]) => Promise<unknown>>();
    const images = {
      copyThread: vi.fn(async () => {
        if (failure === "image-copy") throw new Error(failure);
      }),
      deleteThread: vi.fn(async () => {}),
    };
    const attachments = {
      copyThread: vi.fn(async () => {
        if (failure === "attachment-copy") throw new Error(failure);
      }),
      deleteThread: vi.fn(async () => {}),
    };
    const create = vi.fn(() => {
      throw new Error(failure);
    });
    registerThreadMaintenanceIpc({
      ipcMain: {
        handle: (
          channel: string,
          handler: (...args: any[]) => Promise<unknown>,
        ) => handlers.set(channel, handler),
      },
      parseThreadCommand: (command: unknown) =>
        threadCommandSchema.parse(command),
      compactingThreads: new Set(),
      store: {
        getThread: () => ({
          id: "source",
          projectId: "project",
          target:
            failure === "worktree-registration" ? "managed-worktree" : "local",
          mode: "work",
          status: "idle",
          title: "Source",
        }),
        createForkedThread: create,
      },
      agentProcess: {
        request: async () => ({ sessionFile: "/sessions/new.jsonl" }),
      },
      resolveThreadWorkspace: async () => ({
        project: { path: "/project" },
        workspacePath: "/project",
      }),
      openAgentThread: async () => {},
      currentLocale: () => "en",
      taskSourceImages: () => images,
      attachmentStore: () => attachments,
      attachmentScope: (id: string) => id,
    } as unknown as Parameters<typeof registerThreadMaintenanceIpc>[0]);
    await expect(
      handlers.get(IPC.threadFork)!(undefined, "source"),
    ).rejects.toThrow(
      failure === "worktree-registration" ? "not registered" : failure,
    );
    expect(mocks.deleteTranscript).toHaveBeenCalledExactlyOnceWith(
      "/sessions/new.jsonl",
      "/sessions",
    );
    if (failure !== "worktree-registration") {
      const target = images.copyThread.mock.calls[0]![1];
      expect(target).not.toBe("source");
      expect(images.deleteThread).toHaveBeenCalledExactlyOnceWith(target);
      expect(attachments.deleteThread).toHaveBeenCalledExactlyOnceWith(target);
    }
    if (failure !== "database") expect(create).not.toHaveBeenCalled();
  });
});

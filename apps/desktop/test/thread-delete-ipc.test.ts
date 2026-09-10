import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";
import { threadCommandSchema } from "@artemis/protocol";

const main = readFileSync(
  new URL("../src/main/main.ts", import.meta.url),
  "utf8",
);
const start = main.indexOf("  ipcMain.handle(\n    IPC.threadDelete,");
const end = main.indexOf("  ipcMain.handle(\n    IPC.threadFork,", start);
function fixture(temporary = false) {
  let handler: (_event: unknown, threadId: string) => Promise<void>;
  const record = {
    id: "thread",
    ...(temporary ? {} : { projectId: "project" }),
    sessionFile: "/tmp/pi-session.jsonl",
  };
  let thread: typeof record | undefined = record;
  const deleted = vi.fn(() => {
    thread = undefined;
  });
  const agentProcess = {
    available: true,
    request: vi.fn(async () => {
      throw new Error("Agent host request timed out");
    }),
  };
  const removeWorkspace = vi.fn();
  const scope = {
    attachmentStore: () => ({ deleteThread: vi.fn() }),
    attachmentScope: (id: string) => id,
    ipcMain: {
      handle: (_name: string, value: typeof handler) => {
        handler = value;
      },
    },
    IPC: { threadDelete: "delete" },
    store: {
      getThread: () => thread,
      getThreadGoal: () => undefined,
      deleteThread: deleted,
    },
    parseThreadCommand: (command: unknown) =>
      threadCommandSchema.parse(command),
    activeTurns: new Map(),
    compactingThreads: new Set(),
    openedThreads: new Set(["thread"]),
    agentProcess,
    randomUUID: () => "request",
    diagnosticBundleService: { record: vi.fn() },
    terminalService: { closeThread: vi.fn() },
    app: { getPath: () => "/tmp/artemis" },
    removeTemporaryConversationWorkspace: removeWorkspace,
    deletePiSessionTranscript: vi.fn(),
    piSessionsRoot: () => "/tmp/pi",
    process: { env: {} },
    turnChangeSetCompletionTails: new Map(),
    turnChangeSetService: { deleteThread: vi.fn() },
    taskSourceImages: () => ({ deleteThread: vi.fn() }),
    imService: { deleteThread: vi.fn() },
    cleanupGoalObjective: vi.fn(),
  };
  new Function(
    ...Object.keys(scope),
    transformSync(main.slice(start, end), { loader: "ts" }).code,
  )(...Object.values(scope));
  return {
    run: () => handler(undefined, "thread"),
    scope,
    deleted,
    agentProcess,
    removeWorkspace,
  };
}

describe("thread deletion IPC with an unresponsive Agent Host", () => {
  it("bounds cleanup and removes a project task after transcript fallback", async () => {
    const f = fixture();
    await f.run();
    expect(f.agentProcess.request).toHaveBeenCalledWith(
      expect.objectContaining({ type: "thread.delete" }),
      15_000,
    );
    expect(f.scope.deletePiSessionTranscript).toHaveBeenCalled();
    expect(f.deleted).toHaveBeenCalledWith("thread");
    expect(f.scope.store.getThread()).toBeUndefined();
  });
  it("reports temporary-task shutdown failure without deleting a live workspace", async () => {
    const f = fixture(true);
    await expect(f.run()).rejects.toThrow("could not be stopped");
    expect(f.agentProcess.request).toHaveBeenCalledWith(
      expect.objectContaining({ type: "thread.close" }),
      15_000,
    );
    expect(f.removeWorkspace).not.toHaveBeenCalled();
    expect(f.deleted).not.toHaveBeenCalled();
  });
});

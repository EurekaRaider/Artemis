import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";
import { RecoverableTurnQueues } from "../src/main/recoverable-turn-queue.js";
import { threadCommandSchema } from "@artemis/protocol";

const source = readFileSync(
  new URL("../src/main/main.ts", import.meta.url),
  "utf8",
);
const section = source.slice(
  source.indexOf("function publishCompactionQueue("),
  source.indexOf("async function steerQueuedTurn("),
);
function fixture() {
  const thread = { id: "a", mode: "execute", status: "idle" };
  const other = { id: "b", mode: "execute", status: "running" };
  const compactingThreads = new Set(["a"]);
  const compactionFollowUps = new RecoverableTurnQueues();
  const recoverableTurnQueues = new RecoverableTurnQueues();
  const activeTurns = new Map([["b", "turn-b"]]);
  const events: any[] = [];
  const agentProcess = { request: vi.fn(async () => undefined) };
  const startTaskTurn = vi.fn(async () => {
    thread.status = "running";
    activeTurns.set("a", "turn-a");
  });
  let compactThread: (_event: unknown, threadId: string) => Promise<void>;
  const scope = {
    routesToDesignQueue: vi.fn(() => false),
    enqueueDesignTurn: vi.fn(async () => undefined),
    pumpDesignRequests: vi.fn(async () => undefined),
    attachmentStore: () => ({
      bind: async (_thread: string, items: unknown[]) => items,
    }),
    attachmentScope: (id: string) => id,
    IPC: { threadCompact: "compact" },
    ipcMain: {
      handle: (_name: string, handler: typeof compactThread) => {
        compactThread = handler;
      },
    },
    openAgentThread: vi.fn(async () => undefined),
    compactingThreads,
    compactionFollowUps,
    recoverableTurnQueues,
    activeTurns,
    openedThreads: new Set(["a", "b"]),
    agentProcess,
    startTaskTurn,
    store: {
      getThread: (id: string) =>
        id === "a" ? thread : id === "b" ? other : undefined,
    },
    parseThreadCommand: (command: unknown) =>
      threadCommandSchema.parse(command),
    randomUUID: () => "test-id",
    appendPromptFiles: (text: string) => text,
    emitPayload: (threadId: string, turnId: string, payload: unknown) =>
      events.push({ threadId, turnId, payload }),
  };
  const code = transformSync(
    section +
      source.slice(
        source.indexOf("  ipcMain.handle(\n    IPC.threadCompact,"),
        source.indexOf("  ipcMain.handle(\n    IPC.worktreeBranchize,"),
      ),
    { loader: "ts", target: "es2022" },
  ).code;
  const handlers = new Function(
    ...Object.keys(scope),
    `${code}; return {queueTurn, controlTurnQueue, replaceTurnQueue, resumeCompactionFollowUps};`,
  )(...Object.values(scope));
  return {
    ...scope,
    ...handlers,
    thread,
    events,
    compactThread: (id: string) => compactThread(undefined, id),
  };
}
const image = { name: "test.png", mimeType: "image/png", data: "aW1hZ2U=" };

describe("manual compaction IPC queue", () => {
  it("accepts messages before the compacting session opens while another task runs independently", async () => {
    const f = fixture();
    f.openedThreads.delete("a");
    await f.queueTurn("turn.follow-up", {
      threadId: "a",
      text: "first",
      attachments: [image],
    });
    expect(f.agentProcess.request).not.toHaveBeenCalled();
    await f.queueTurn("turn.follow-up", { threadId: "b", text: "independent" });
    expect(f.agentProcess.request).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "b", text: "independent" }),
    );
    expect(f.compactionFollowUps.recover("a")).toEqual([
      { text: "first", attachments: [image] },
    ]);
  });

  it("hands off FIFO messages with attachments and accepts messages arriving during handoff", async () => {
    const f = fixture();
    await f.queueTurn("turn.follow-up", {
      threadId: "a",
      text: "first",
      attachments: [image],
    });
    await f.queueTurn("turn.follow-up", { threadId: "a", text: "second" });
    f.startTaskTurn.mockImplementationOnce(async () => {
      f.thread.status = "running";
      f.activeTurns.set("a", "turn-a");
      await f.queueTurn("turn.follow-up", { threadId: "a", text: "third" });
    });
    await f.resumeCompactionFollowUps(f.thread);
    expect(f.startTaskTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "first",
        attachments: [image],
        mode: "execute",
      }),
      { origin: "desktop", afterCompaction: true },
    );
    expect(
      f.agentProcess.request.mock.calls.map(([command]: any[]) => command.text),
    ).toEqual(["second", "third"]);
    expect(f.compactionFollowUps.snapshot("a").followUp).toEqual([]);
  });

  it("preserves queue edits, removal and attachment ownership during compaction", async () => {
    const f = fixture();
    await f.queueTurn("turn.follow-up", { threadId: "a", text: "first" });
    await f.queueTurn("turn.follow-up", {
      threadId: "a",
      text: "second",
      attachments: [image],
    });
    await f.replaceTurnQueue({
      threadId: "a",
      expectedFollowUp: ["first", "second"],
      followUp: [{ sourceIndex: 1, text: "edited" }],
    });
    await f.resumeCompactionFollowUps(f.thread);
    expect(f.startTaskTurn).toHaveBeenCalledWith(
      expect.objectContaining({ text: "edited", attachments: [image] }),
      expect.anything(),
    );
    expect(f.agentProcess.request).not.toHaveBeenCalled();
  });

  it("recovers unaccepted messages with attachments when dispatch fails", async () => {
    const f = fixture();
    await f.queueTurn("turn.follow-up", {
      threadId: "a",
      text: "first",
      attachments: [image],
    });
    await f.queueTurn("turn.follow-up", { threadId: "a", text: "second" });
    f.startTaskTurn.mockRejectedValueOnce(new Error("Host unavailable"));
    await expect(f.resumeCompactionFollowUps(f.thread)).rejects.toThrow(
      "Host unavailable",
    );
    expect(f.events.at(-1).payload).toEqual({
      type: "queue.recovered",
      messages: ["first", "second"],
      items: [{ text: "first", attachments: [image] }, { text: "second" }],
    });
    expect(f.agentProcess.request).not.toHaveBeenCalled();
  });

  it("restores queued drafts and releases only the compacting task when compaction fails", async () => {
    const f = fixture();
    f.compactingThreads.clear();
    let failCompaction!: (reason: Error) => void;
    f.agentProcess.request.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          failCompaction = reject;
        }),
    );
    const compact = f.compactThread("a");
    const failed = expect(compact).rejects.toThrow("Compaction failed");
    await vi.waitFor(() => expect(f.agentProcess.request).toHaveBeenCalled());
    await f.queueTurn("turn.follow-up", {
      threadId: "a",
      text: "draft",
      attachments: [image],
    });
    failCompaction(new Error("Compaction failed"));
    await failed;
    expect(f.compactingThreads.has("a")).toBe(false);
    expect(
      f.events.find((event: any) => event.payload.type === "queue.recovered")
        .payload.items,
    ).toEqual([{ text: "draft", attachments: [image] }]);
    expect(f.events.at(-1).payload).toEqual({
      type: "queue.updated",
      steering: [],
      followUp: [],
    });
    expect(f.activeTurns.get("b")).toBe("turn-b");
    expect(f.startTaskTurn).not.toHaveBeenCalled();
  });

  it("clears the pending queue and rejects steering without an active turn", async () => {
    const f = fixture();
    await f.queueTurn("turn.follow-up", { threadId: "a", text: "first" });
    await expect(
      f.queueTurn("turn.steer", { threadId: "a", text: "interrupt" }),
    ).rejects.toThrow("compaction");
    expect(await f.controlTurnQueue("turn.queue.clear", "a")).toEqual({
      steering: [],
      followUp: ["first"],
    });
    await f.resumeCompactionFollowUps(f.thread);
    expect(f.startTaskTurn).not.toHaveBeenCalled();
  });
});

it("routes Design follow-ups to the durable queue without steering the Pi session", async () => {
  const f = fixture();
  f.routesToDesignQueue.mockReturnValue(true);
  await f.queueTurn("turn.steer", {
    threadId: "b",
    text: "/design explore",
    attachments: [image],
  });
  expect(f.enqueueDesignTurn).toHaveBeenCalledWith({
    threadId: "b",
    text: "/design explore",
    mode: "execute",
    attachments: [image],
  });
  expect(f.agentProcess.request).not.toHaveBeenCalled();
  expect(f.compactionFollowUps.snapshot("b").followUp).toEqual([]);
});

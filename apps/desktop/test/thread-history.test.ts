import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  reduceAgentEventBatch,
  reduceAgentEvents,
  type AgentPayload,
} from "@artemis/protocol";
import { AppStore } from "../src/main/store.js";
import { ThreadHistoryReader } from "../src/main/thread-history-reader.js";
import { mergeHistoryPage } from "../src/shared/thread-history.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
function fixture(turns = 65) {
  const directory = mkdtempSync(join(tmpdir(), "artemis-history-test-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "state.sqlite");
  const store = new AppStore(path);
  cleanups.push(() => store.close());
  const now = "2026-09-17T00:00:00.000Z";
  store.createThread({
    id: "thread",
    title: "Synthetic history",
    mode: "execute",
    target: "local",
    status: "idle",
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  });
  let seq = 0;
  const add = (turn: string, payload: AgentPayload) =>
    store.appendEvent(`event-${++seq}`, "thread", turn, payload);
  for (let turn = 0; turn < turns; turn++) {
    add(`t${turn}`, {
      type: "user.message",
      messageId: `u${turn}`,
      text: `Question ${turn}`,
    });
    add(`t${turn}`, { type: "turn.started", mode: "execute" });
    for (let delta = 0; delta < 3; delta++)
      add(`t${turn}`, {
        type: "message.part.delta",
        partId: `p${turn}`,
        partType: "text",
        delta: "answer ",
      });
    add(`t${turn}`, {
      type: "turn.completed",
      reason: "completed",
      finalPartId: `p${turn}`,
    });
  }
  const reader = new ThreadHistoryReader(path);
  cleanups.push(() => reader.close());
  return { store, reader, path, add };
}

describe("paged history projections", () => {
  it("returns recent complete turns and reconstructs the full timeline without changing raw history", () => {
    const { store, reader } = fixture();
    const original = store.getThreadEvents("thread");
    let page = reader.read("thread");
    expect(page.state.turnOrder).toHaveLength(30);
    expect(page.state.turnOrder[0]).toBe("t35");
    expect(Object.keys(page.state.messageParts)).toHaveLength(30);
    expect(page.events.length).toBeLessThan(10);
    while (page.cursor)
      page = mergeHistoryPage(page, reader.read("thread", page.cursor));
    const expected = reduceAgentEvents("thread", original);
    expect(page.state).toEqual({ ...expected, seenEventIds: {} });
    expect(store.getThreadEvents("thread")).toEqual(original);
  });

  it("preserves context, pending approvals and queue while older pages load and live events arrive", () => {
    const { store, reader, add } = fixture();
    add("t65", { type: "turn.started", mode: "execute" });
    add("t65", {
      type: "context.usage",
      tokens: 61000,
      contextWindow: 258000,
      compacting: false,
    });
    add("t65", {
      type: "queue.updated",
      steering: ["steer"],
      followUp: ["follow"],
    });
    add("t65", {
      type: "approval.requested",
      approvalId: "a",
      nonce: "history-nonce-0001",
      summary: "Write",
      paths: ["a.txt"],
      network: [],
      risk: "medium",
      allowedScopes: ["once"],
    });
    const page = reader.read("thread");
    expect(page.state.status).toBe("waiting-approval");
    const live = [
      add("t65", {
        type: "context.usage",
        tokens: 62000,
        contextWindow: 258000,
        compacting: true,
      }),
      add("t65", {
        type: "approval.resolved",
        approvalId: "a",
        nonce: "history-nonce-0001",
        approved: true,
        scope: "once",
      }),
    ];
    const earlier = reader.read("thread", page.cursor!);
    const merged = mergeHistoryPage(page, earlier);
    const state = reduceAgentEventBatch(merged.state, live);
    const full = reduceAgentEvents("thread", store.getThreadEvents("thread"));
    expect(state.contextUsage).toEqual(full.contextUsage);
    expect(state.queue).toEqual(full.queue);
    expect(state.approvals).toEqual(full.approvals);
    expect(state.status).toBe(full.status);
    expect(reduceAgentEventBatch(state, live)).toBe(state);
  });

  it("keeps old pending questions reachable and preserves order across page merges", () => {
    const { store, reader, add } = fixture();
    add("t0", {
      type: "user-input.requested",
      requestId: "old-question",
      nonce: "history-nonce-0001",
      header: "Decision",
      question: "Continue?",
      options: [
        { label: "Yes", description: "Continue work", recommended: true },
        { label: "No", description: "Stop work", recommended: false },
      ],
      expiresAt: "2999-01-01T00:00:00.000Z",
    });
    let page = reader.read("thread");
    expect(page.state.turnOrder[0]).toBe("t0");
    expect(page.state.order).toContain("input:old-question");
    while (page.cursor)
      page = mergeHistoryPage(page, reader.read("thread", page.cursor));
    expect(page.state).toEqual({
      ...reduceAgentEvents("thread", store.getThreadEvents("thread")),
      seenEventIds: {},
    });
  });

  it("updates a persisted projection from only the new suffix and rebuilds incompatible caches", () => {
    const { reader, add, path, store } = fixture(2);
    reader.read("thread");
    add("t2", { type: "turn.started", mode: "execute" });
    add("t2", {
      type: "message.part.delta",
      partId: "p2",
      partType: "text",
      delta: "new",
    });
    const updated = reader.read("thread");
    expect(updated.state.messageParts.p2?.text).toBe("new");
    const db = new DatabaseSync(`${path}.history-cache`);
    db.prepare("UPDATE thread_history_snapshots SET body = ?").run(
      '{"version":0}',
    );
    db.close();
    expect(reader.read("thread").state).toEqual({
      ...reduceAgentEvents("thread", store.getThreadEvents("thread")),
      seenEventIds: {},
    });
  });

  it("deletes cached history with the thread and rejects invalid cursors", () => {
    const { store, reader, path } = fixture(1);
    reader.read("thread");
    expect(() =>
      reader.read("thread", { snapshotSeq: 999, beforeTurn: 0 }),
    ).toThrow("Invalid history cursor");
    store.deleteThread("thread");
    reader.discard("thread");
    const db = new DatabaseSync(`${path}.history-cache`);
    expect(db.prepare("SELECT * FROM thread_history_snapshots").all()).toEqual(
      [],
    );
    db.close();
    expect(() => reader.read("thread")).toThrow("Thread not found");
  });
});

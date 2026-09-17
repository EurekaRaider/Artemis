import { DatabaseSync } from "node:sqlite";
import {
  createThreadViewState,
  reduceAgentEventBatch,
  agentEventSchema,
  PROTOCOL_VERSION,
  type AgentEvent,
  type RunMode,
  type ThreadViewState,
} from "@artemis/protocol";
import type {
  ThreadHistoryCursor,
  ThreadHistoryPage,
} from "../shared/thread-history.js";

const PAGE_TURNS = 30;
// Bump when the projection shape or reducer semantics change.
const SNAPSHOT_VERSION = 1;
interface Snapshot {
  version: number;
  state: ThreadViewState;
  events: AgentEvent[];
}

// This reader runs exclusively in the history worker, including SQLite, parsing
// and replay. Cache writes use a separate database so they cannot block event persistence.
export class ThreadHistoryReader {
  private readonly database: DatabaseSync;
  private readonly cache: DatabaseSync;
  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath, { readOnly: true });
    this.cache = new DatabaseSync(`${databasePath}.history-cache`);
    this.cache.exec(
      "CREATE TABLE IF NOT EXISTS thread_history_snapshots (thread_id TEXT PRIMARY KEY, seq INTEGER NOT NULL, body TEXT NOT NULL)",
    );
    // Clean up after a crash or a deletion while the history worker was stopped.
    for (const row of this.cache
      .prepare("SELECT thread_id FROM thread_history_snapshots")
      .all()) {
      if (
        !this.database
          .prepare("SELECT id FROM threads WHERE id = ?")
          .get(row.thread_id!)
      )
        this.discard(row.thread_id as string);
    }
  }

  read(threadId: string, cursor?: ThreadHistoryCursor): ThreadHistoryPage {
    const thread = this.database
      .prepare("SELECT mode FROM threads WHERE id = ?")
      .get(threadId) as { mode: RunMode } | undefined;
    if (!thread) {
      this.discard(threadId);
      throw new Error("Thread not found.");
    }
    const latest = this.database
      .prepare("SELECT MAX(seq) AS seq FROM events WHERE thread_id = ?")
      .get(threadId) as { seq: number | null };
    const endSeq = cursor?.snapshotSeq ?? latest.seq ?? 0;
    if (
      !Number.isSafeInteger(endSeq) ||
      endSeq < 0 ||
      endSeq > (latest.seq ?? 0) ||
      (cursor &&
        (!Number.isSafeInteger(cursor.beforeTurn) || cursor.beforeTurn < 0))
    )
      throw new Error("Invalid history cursor.");
    let snapshot: Snapshot = {
      version: SNAPSHOT_VERSION,
      state: createThreadViewState(threadId, thread.mode),
      events: [],
    };
    const cached = this.cache
      .prepare(
        "SELECT body FROM thread_history_snapshots WHERE thread_id = ? AND seq <= ?",
      )
      .get(threadId, endSeq) as { body: string } | undefined;
    if (cached) {
      try {
        const parsed = JSON.parse(cached.body) as Snapshot;
        if (
          parsed.version === SNAPSHOT_VERSION &&
          parsed.state.threadId === threadId &&
          parsed.state.lastSeq <= endSeq
        )
          snapshot = parsed;
      } catch {
        /* A disposable projection can always be rebuilt. */
      }
    }
    const rows = this.database
      .prepare(
        "SELECT body FROM events WHERE thread_id = ? AND seq > ? AND seq <= ? ORDER BY seq",
      )
      .iterate(threadId, snapshot.state.lastSeq, endSeq);
    let batch: AgentEvent[] = [];
    for (const row of rows) {
      const event = agentEventSchema.parse({
        ...JSON.parse(row.body as string),
        protocolVersion: PROTOCOL_VERSION,
      });
      batch.push(event);
      rememberPresentationEvent(snapshot.events, event);
      if (batch.length === 4_096) {
        snapshot.state = reduceAgentEventBatch(snapshot.state, batch);
        snapshot.state.seenEventIds = {};
        batch = [];
      }
    }
    snapshot.state = reduceAgentEventBatch(snapshot.state, batch);
    snapshot.state.seenEventIds = {};
    if (!cursor)
      this.cache
        .prepare(
          "INSERT OR REPLACE INTO thread_history_snapshots VALUES (?, ?, ?)",
        )
        .run(threadId, endSeq, JSON.stringify(snapshot));
    const end = Math.min(
      cursor?.beforeTurn ?? snapshot.state.turnOrder.length,
      snapshot.state.turnOrder.length,
    );
    const start = Math.max(0, end - PAGE_TURNS);
    const state = historyWindow(snapshot.state, start, end, !cursor);
    const entries = new Set(state.order);
    const turns = new Set(state.turnOrder);
    return {
      version: 1,
      state,
      turnPositions: Object.fromEntries(
        snapshot.state.turnOrder.flatMap((id, index) =>
          turns.has(id) ? [[id, index]] : [],
        ),
      ),
      entryPositions: Object.fromEntries(
        snapshot.state.order.flatMap((id, index) =>
          entries.has(id) ? [[id, index]] : [],
        ),
      ),
      events: snapshot.events,
      ...(start > 0
        ? { cursor: { snapshotSeq: endSeq, beforeTurn: start } }
        : {}),
    };
  }

  discard(threadId: string): void {
    this.cache
      .prepare("DELETE FROM thread_history_snapshots WHERE thread_id = ?")
      .run(threadId);
  }

  close(): void {
    this.cache.close();
    this.database.close();
  }
}

function rememberPresentationEvent(
  events: AgentEvent[],
  event: AgentEvent,
): void {
  const payload = event.payload;
  if (payload.type === "turn.started") {
    const files = events.filter((item) => item.payload.type === "file.changed");
    events.splice(0, events.length, ...files, event);
  } else if (payload.type === "file.changed") {
    const kind = /\.html?$/iu.test(payload.path)
      ? "html"
      : /\.(md|markdown)$/iu.test(payload.path)
        ? "markdown"
        : "other";
    const previous = events.findIndex(
      (item) =>
        item.payload.type === "file.changed" &&
        (/\.html?$/iu.test(item.payload.path)
          ? "html"
          : /\.(md|markdown)$/iu.test(item.payload.path)
            ? "markdown"
            : "other") === kind,
    );
    if (previous >= 0) events.splice(previous, 1);
    events.push(event);
  } else if (
    payload.type === "turn.completed" ||
    payload.type === "turn.failed" ||
    (payload.type === "tool.started" && payload.toolName === "update_plan")
  ) {
    events.push(event);
  } else if (
    payload.type === "tool.completed" &&
    events.some(
      (item) =>
        item.payload.type === "tool.started" &&
        item.payload.toolCallId === payload.toolCallId,
    )
  ) {
    events.push({ ...event, payload: { ...payload, output: "" } });
  }
}

export function historyWindow(
  state: ThreadViewState,
  start: number,
  end: number,
  includeRuntime: boolean,
): ThreadViewState {
  const selected = new Set(state.turnOrder.slice(start, end));
  if (includeRuntime) {
    for (const id of state.turnOrder) {
      if (state.turns[id]?.status === "running") selected.add(id);
    }
    // Pending interactions can outlive a completed turn. Keep them reachable.
    for (const [id, approval] of Object.entries(state.approvals)) {
      if (approval.status === "pending")
        selected.add(state.entryTurnIds[`approval:${id}`] ?? "");
    }
    for (const [id, input] of Object.entries(state.userInputs)) {
      if (input.status === "pending")
        selected.add(state.entryTurnIds[`input:${id}`] ?? "");
    }
  }
  const turnOrder = state.turnOrder.filter((id) => selected.has(id));
  const turns = Object.fromEntries(
    turnOrder.map((id) => [id, state.turns[id]!]),
  );
  const order = state.order.filter(
    (entry) =>
      turns[state.entryTurnIds[entry] ?? ""] ||
      (includeRuntime && !state.entryTurnIds[entry]),
  );
  const ids = new Set(order);
  const pick = <T>(values: Record<string, T>, kind: string) =>
    Object.fromEntries(
      Object.entries(values).filter(([id]) => ids.has(`${kind}:${id}`)),
    );
  return {
    ...state,
    order,
    turnOrder,
    turns,
    entryTurnIds: Object.fromEntries(
      order.flatMap((entry) =>
        state.entryTurnIds[entry] ? [[entry, state.entryTurnIds[entry]!]] : [],
      ),
    ),
    userMessages: pick(state.userMessages, "user"),
    messageParts: pick(state.messageParts, "part"),
    tools: pick(state.tools, "tool"),
    seenEventIds: {},
  };
}

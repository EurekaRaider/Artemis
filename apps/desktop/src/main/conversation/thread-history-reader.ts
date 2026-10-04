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
} from "../../shared/thread-history.js";

const PAGE_TURNS = 30;
// Bump when the projection shape or reducer semantics change.
const SNAPSHOT_VERSION = 3;
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
    this.cache.exec(
      "CREATE TABLE IF NOT EXISTS thread_history_pages (thread_id TEXT NOT NULL, seq INTEGER NOT NULL, before_turn INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(thread_id, seq, before_turn))",
    );
    const cacheVersion = this.cache.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    if (cacheVersion.user_version !== SNAPSHOT_VERSION) {
      this.cache.exec(
        `DELETE FROM thread_history_pages; DELETE FROM thread_history_snapshots; PRAGMA user_version = ${SNAPSHOT_VERSION}`,
      );
    }
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
    const pageKey = cursor?.beforeTurn ?? -1;
    const savedPage = this.cache
      .prepare(
        "SELECT body FROM thread_history_pages WHERE thread_id = ? AND seq = ? AND before_turn = ?",
      )
      .get(threadId, endSeq, pageKey) as { body: string } | undefined;
    if (savedPage) {
      try {
        const page = JSON.parse(savedPage.body) as ThreadHistoryPage;
        if (
          page.version !== 1 ||
          page.state.threadId !== threadId ||
          page.state.mode !== thread.mode ||
          page.state.lastSeq !== endSeq ||
          !Array.isArray(page.state.turnOrder)
        )
          throw new Error("Stale history projection");
        return page;
      } catch {
        this.cache
          .prepare("DELETE FROM thread_history_pages WHERE thread_id = ?")
          .run(threadId);
      }
    }
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
          parsed.state.mode === thread.mode &&
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
    const positions = {
      turns: new Map(snapshot.state.turnOrder.map((id, index) => [id, index])),
      entries: new Map(snapshot.state.order.map((id, index) => [id, index])),
    };
    const page = this.page(snapshot, endSeq, end, !cursor, positions);
    if (!cursor) {
      // Materialize page-sized projections once, so cursor reads never parse
      // the full snapshot. These tables are disposable, not user data.
      this.cache.exec("BEGIN");
      try {
        this.cache
          .prepare("DELETE FROM thread_history_pages WHERE thread_id = ?")
          .run(threadId);
        const insert = this.cache.prepare(
          "INSERT INTO thread_history_pages VALUES (?, ?, ?, ?)",
        );
        insert.run(threadId, endSeq, -1, JSON.stringify(page));
        for (let before = end - PAGE_TURNS; before > 0; before -= PAGE_TURNS) {
          insert.run(
            threadId,
            endSeq,
            before,
            JSON.stringify(
              this.page(snapshot, endSeq, before, false, positions),
            ),
          );
        }
        this.cache.exec("COMMIT");
      } catch (error) {
        this.cache.exec("ROLLBACK");
        throw error;
      }
    }
    return page;
  }

  private page(
    snapshot: Snapshot,
    endSeq: number,
    end: number,
    includeRuntime: boolean,
    positions: { turns: Map<string, number>; entries: Map<string, number> },
  ): ThreadHistoryPage {
    const start = Math.max(0, end - PAGE_TURNS);
    const state = historyWindow(
      snapshot.state,
      start,
      end,
      includeRuntime,
      positions.entries,
    );
    return {
      version: 1,
      state,
      turnPositions: Object.fromEntries(
        state.turnOrder.map((id) => [id, positions.turns.get(id)!]),
      ),
      entryPositions: Object.fromEntries(
        state.order.map((id) => [id, positions.entries.get(id)!]),
      ),
      events: snapshot.events,
      ...(start > 0
        ? { cursor: { snapshotSeq: endSeq, beforeTurn: start } }
        : {}),
    };
  }

  discard(threadId: string): void {
    this.cache
      .prepare("DELETE FROM thread_history_pages WHERE thread_id = ?")
      .run(threadId);
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
    const files = events.filter(
      (item) =>
        item.payload.type === "file.changed" ||
        item.payload.type.startsWith("plan.") ||
        ((item.payload.type === "turn.completed" ||
          item.payload.type === "turn.failed") &&
          events.some(
            (p) =>
              p.payload.type === "plan.proposed" &&
              p.payload.sourceTurnId === item.turnId,
          )),
    );
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
    payload.type.startsWith("plan.") ||
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
  entryPositions?: Map<string, number>,
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
  const turnOrder = includeRuntime
    ? state.turnOrder.filter((id) => selected.has(id))
    : state.turnOrder.slice(start, end);
  const turns = Object.fromEntries(
    turnOrder.map((id) => [id, state.turns[id]!]),
  );
  const order =
    includeRuntime || !entryPositions
      ? state.order.filter(
          (entry) =>
            turns[state.entryTurnIds[entry] ?? ""] ||
            (includeRuntime && !state.entryTurnIds[entry]),
        )
      : turnOrder
          .flatMap((id) => state.turns[id]?.order ?? [])
          .sort((a, b) => entryPositions.get(a)! - entryPositions.get(b)!);
  const pick = <T>(values: Record<string, T>, kind: string) =>
    Object.fromEntries(
      order
        .filter((entry) => entry.startsWith(`${kind}:`))
        .map((entry) => {
          const id = entry.slice(kind.length + 1);
          return [id, values[id]!];
        }),
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

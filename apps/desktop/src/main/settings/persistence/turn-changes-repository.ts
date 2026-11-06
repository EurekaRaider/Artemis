import { turnChangeSetFromRow } from "../store-row-codecs.js";

import {
  type TurnChangeSetRow,
  type TurnChangeSetRecord,
} from "../store-types.js";

import type { StoreDependencies } from "./store-dependencies.js";
export function createTurnChangesRepository(
  services: Pick<
    StoreDependencies,
    "getThreadEvents" | "database" | "getTurnChangeSet"
  >,
) {
  function getLastTurnChangedFiles(threadId: string): string[] {
    const events = services.getThreadEvents(threadId);
    const lastTurnStart = events.findLastIndex(
      (event) => event.payload.type === "turn.started",
    );
    if (lastTurnStart < 0) return [];
    return [
      ...new Set(
        events
          .slice(lastTurnStart)
          .filter((event) => event.payload.type === "file.changed")
          .map((event) => {
            if (event.payload.type !== "file.changed") {
              throw new Error("Unreachable event type.");
            }
            return event.payload.path;
          }),
      ),
    ];
  }

  function upsertTurnChangeSet(
    record: TurnChangeSetRecord,
  ): TurnChangeSetRecord {
    services.database
      .prepare(
        `INSERT INTO turn_change_sets (
           thread_id, turn_id, status, files_json, additions, deletions,
           undo_available, message, diff_text, snapshot_path, workspace_path,
           start_head, start_index, end_head, end_index, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(thread_id, turn_id) DO UPDATE SET
           status = excluded.status,
           files_json = excluded.files_json,
           additions = excluded.additions,
           deletions = excluded.deletions,
           undo_available = excluded.undo_available,
           message = excluded.message,
           diff_text = excluded.diff_text,
           snapshot_path = excluded.snapshot_path,
           workspace_path = excluded.workspace_path,
           start_head = excluded.start_head,
           start_index = excluded.start_index,
           end_head = excluded.end_head,
           end_index = excluded.end_index,
           updated_at = excluded.updated_at`,
      )
      .run(
        record.threadId,
        record.turnId,
        record.status,
        JSON.stringify(record.files),
        record.additions,
        record.deletions,
        record.undoAvailable ? 1 : 0,
        record.message ?? null,
        record.diffText,
        record.snapshotPath ?? null,
        record.workspacePath,
        record.startHead,
        record.startIndex,
        record.endHead,
        record.endIndex,
        record.createdAt,
        record.updatedAt,
      );
    return services.getTurnChangeSet(record.threadId, record.turnId)!;
  }

  function getTurnChangeSet(
    threadId: string,
    turnId: string,
  ): TurnChangeSetRecord | undefined {
    const row = services.database
      .prepare(
        "SELECT * FROM turn_change_sets WHERE thread_id = ? AND turn_id = ?",
      )
      .get(threadId, turnId) as TurnChangeSetRow | undefined;
    return row ? turnChangeSetFromRow(row) : undefined;
  }

  function getLatestTurnChangeSet(
    threadId: string,
  ): TurnChangeSetRecord | undefined {
    const row = services.database
      .prepare(
        `SELECT * FROM turn_change_sets
         WHERE thread_id = ?
         ORDER BY created_at DESC, rowid DESC
         LIMIT 1`,
      )
      .get(threadId) as TurnChangeSetRow | undefined;
    return row ? turnChangeSetFromRow(row) : undefined;
  }

  function releaseOlderTurnChangeSetUndo(
    threadId: string,
    currentTurnId: string,
  ): string[] {
    const rows = services.database
      .prepare(
        `SELECT snapshot_path FROM turn_change_sets
         WHERE thread_id = ? AND turn_id != ? AND snapshot_path IS NOT NULL`,
      )
      .all(threadId, currentTurnId) as unknown as Array<{
      snapshot_path: string;
    }>;
    services.database
      .prepare(
        `UPDATE turn_change_sets
         SET undo_available = 0, snapshot_path = NULL
         WHERE thread_id = ? AND turn_id != ?`,
      )
      .run(threadId, currentTurnId);
    return rows.map((row) => row.snapshot_path);
  }

  function listTurnChangeSetSnapshotPaths(threadId: string): string[] {
    return (
      services.database
        .prepare(
          `SELECT snapshot_path FROM turn_change_sets
           WHERE thread_id = ? AND snapshot_path IS NOT NULL`,
        )
        .all(threadId) as unknown as Array<{ snapshot_path: string }>
    ).map((row) => row.snapshot_path);
  }

  function getThreadChangedFiles(threadId: string): string[] {
    return [
      ...new Set(
        services
          .getThreadEvents(threadId)
          .filter((event) => event.payload.type === "file.changed")
          .map((event) => {
            if (event.payload.type !== "file.changed") {
              throw new Error("Unreachable event type.");
            }
            return event.payload.path;
          }),
      ),
    ];
  }
  const handlers = {
    getLastTurnChangedFiles,
    upsertTurnChangeSet,
    getTurnChangeSet,
    getLatestTurnChangeSet,
    releaseOlderTurnChangeSetUndo,
    listTurnChangeSetSnapshotPaths,
    getThreadChangedFiles,
  };
  return handlers;
}

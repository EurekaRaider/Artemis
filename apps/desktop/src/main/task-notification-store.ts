import type { DatabaseSync } from "node:sqlite";
import type { AgentEvent, TaskNotificationState } from "@artemis/protocol";

export type TaskNoticeKind = NonNullable<TaskNotificationState["kind"]>;
export interface TaskNotice {
  key: string;
  kind: TaskNoticeKind;
  seq: number;
  threadId: string;
  backgroundProcessesRunning?: boolean;
}
interface NoticeRow {
  notice_key: string;
  thread_id: string;
  kind: TaskNoticeKind;
  seq: number;
  unread: number;
  pending_json: string;
}

/** Local UI metadata. Old event logs are deliberately not replayed into notices. */
export class TaskNotificationStore {
  constructor(private readonly database: DatabaseSync) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS task_notification_revisions (
        thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS task_notifications (
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        notice_key TEXT NOT NULL,
        turn_id TEXT,
        seq INTEGER NOT NULL,
        kind TEXT NOT NULL,
        unread INTEGER NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        pending_json TEXT NOT NULL DEFAULT '[]',
        PRIMARY KEY(thread_id, notice_key)
      );
    `);
  }

  state(threadId: string): TaskNotificationState | undefined {
    const revision = this.database
      .prepare(
        "SELECT revision FROM task_notification_revisions WHERE thread_id = ?",
      )
      .get(threadId) as { revision: number } | undefined;
    if (!revision) return undefined;
    const row = this.database
      .prepare(
        "SELECT * FROM task_notifications WHERE thread_id = ? AND active = 1 ORDER BY unread DESC, seq DESC LIMIT 1",
      )
      .get(threadId) as NoticeRow | undefined;
    return {
      revision: revision.revision,
      seq: row?.seq ?? -1,
      unread: row?.unread === 1,
      ...(row ? { kind: row.kind } : {}),
    };
  }

  private changed(threadId: string): TaskNotificationState {
    this.database
      .prepare(
        `INSERT INTO task_notification_revisions(thread_id, revision) VALUES (?, 1)
      ON CONFLICT(thread_id) DO UPDATE SET revision = revision + 1`,
      )
      .run(threadId);
    return this.state(threadId)!;
  }

  countUnread(): number {
    const row = this.database
      .prepare(
        `SELECT COUNT(DISTINCT n.thread_id) AS count FROM task_notifications n
      JOIN threads t ON t.id = n.thread_id LEFT JOIN projects p ON p.id = t.project_id
      WHERE n.active = 1 AND n.unread = 1 AND t.archived = 0 AND COALESCE(p.hidden, 0) = 0`,
      )
      .get() as { count: number };
    return row.count;
  }

  isUnread(threadId: string, key: string): boolean {
    return !!this.database
      .prepare(
        "SELECT 1 FROM task_notifications WHERE thread_id = ? AND notice_key = ? AND active = 1 AND unread = 1",
      )
      .get(threadId, key);
  }

  markRead(
    threadId: string,
    seenSeq: number,
  ): TaskNotificationState | undefined {
    if (!Number.isSafeInteger(seenSeq) || seenSeq < 0) return undefined;
    // The caller must acknowledge a snapshot it actually rendered, never a future cursor.
    const latest = this.database
      .prepare(
        "SELECT MAX(seq) AS seq FROM task_notifications WHERE thread_id = ?",
      )
      .get(threadId) as { seq: number | null };
    if (latest.seq === null || seenSeq > latest.seq) return undefined;
    const result = this.database
      .prepare(
        "UPDATE task_notifications SET unread = 0 WHERE thread_id = ? AND seq <= ? AND unread = 1",
      )
      .run(threadId, seenSeq);
    return result.changes ? this.changed(threadId) : undefined;
  }

  observe(
    event: AgentEvent,
    options: {
      viewed?: boolean;
      suppressCompletion?: boolean;
      approvalPending?: boolean;
    },
  ): { state: TaskNotificationState; notice?: TaskNotice } | undefined {
    const p = event.payload;
    if (
      ![
        "turn.started",
        "turn.completed",
        "turn.failed",
        "approval.requested",
        "approval.resolved",
        "user-input.requested",
        "user-input.resolved",
      ].includes(p.type)
    )
      return undefined;
    this.database.exec("SAVEPOINT task_notice");
    try {
      let changes = 0;
      let key: string | undefined;
      let kind: TaskNoticeKind | undefined;
      let pending: Array<{ id: string; expiresAt: string }> = [];
      if (
        p.type === "turn.started" ||
        p.type === "turn.completed" ||
        p.type === "turn.failed"
      ) {
        changes += Number(
          this.database
            .prepare(
              `UPDATE task_notifications SET active = 0 WHERE thread_id = ? AND active = 1
          AND kind IN ('input-required', 'approval-required') AND (? = 'turn.started' OR turn_id = ?)`,
            )
            .run(event.threadId, p.type, event.turnId ?? "").changes,
        );
      }
      if (p.type === "approval.resolved" || p.type === "user-input.resolved") {
        const requestKey =
          p.type === "approval.resolved"
            ? `approval:${p.approvalId}`
            : `input:${p.requestId}`;
        const row = this.database
          .prepare(
            "SELECT * FROM task_notifications WHERE thread_id = ? AND notice_key = ? AND active = 1",
          )
          .get(event.threadId, requestKey) as NoticeRow | undefined;
        if (row) {
          const remaining =
            p.type === "user-input.resolved" && p.kind === "multi-question"
              ? (JSON.parse(row.pending_json) as typeof pending).filter(
                  (item) => item.id !== p.questionId,
                )
              : [];
          const encoded = JSON.stringify(remaining);
          if (encoded !== row.pending_json || remaining.length === 0) {
            changes += Number(
              this.database
                .prepare(
                  "UPDATE task_notifications SET active = ?, pending_json = ? WHERE thread_id = ? AND notice_key = ?",
                )
                .run(
                  remaining.length > 0 ? 1 : 0,
                  encoded,
                  event.threadId,
                  requestKey,
                ).changes,
            );
          }
        }
      }
      if (
        p.type === "turn.completed" &&
        p.reason === "completed" &&
        !options.suppressCompletion
      ) {
        key = `completed:${event.turnId ?? event.eventId}`;
        kind = "completed";
      } else if (p.type === "turn.failed") {
        key = `failed:${event.turnId ?? event.eventId}`;
        kind = "failed";
      } else if (p.type === "approval.requested" && options.approvalPending) {
        key = `approval:${p.approvalId}`;
        kind = "approval-required";
      } else if (p.type === "user-input.requested") {
        pending =
          p.kind === "multi-question"
            ? p.questions.map((q) => ({
                id: q.questionId,
                expiresAt: q.expiresAt,
              }))
            : [{ id: p.requestId, expiresAt: p.expiresAt }];
        if (pending.some((q) => Date.parse(q.expiresAt) > Date.now())) {
          key = `input:${p.requestId}`;
          kind = "input-required";
        }
      }
      let notice: TaskNotice | undefined;
      if (key && kind) {
        const inserted = this.database
          .prepare(
            `INSERT OR IGNORE INTO task_notifications
          (thread_id, notice_key, turn_id, seq, kind, unread, pending_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            event.threadId,
            key,
            event.turnId ?? null,
            event.seq,
            kind,
            options.viewed ? 0 : 1,
            JSON.stringify(pending),
          );
        if (inserted.changes) {
          changes++;
          notice = {
            key,
            kind,
            seq: event.seq,
            threadId: event.threadId,
            ...(p.type === "turn.completed" && p.backgroundProcessesRunning
              ? { backgroundProcessesRunning: true }
              : {}),
          };
        }
      }
      const result = changes
        ? { state: this.changed(event.threadId), ...(notice ? { notice } : {}) }
        : undefined;
      this.database.exec("RELEASE task_notice");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK TO task_notice; RELEASE task_notice");
      throw error;
    }
  }
}

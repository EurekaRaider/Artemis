// S0 design-plugin prototype: persisted prompt-submission ledger.
//
// Decision slice of proposal §9.3. The ledger lives in its own SQLite table so
// the S0 prototype can validate crash-window behavior without entangling the
// production AppStore migrations (those are S1 scope). The API deliberately
// mirrors the proposal state machine:
//
//   prepared -> accepted -> queued -> dispatching -> running -> completed
//                              |          |             |
//                           cancelled   unknown       failed/cancelled
//
// Key invariants under test:
//   - accept() is idempotent by submissionId + payloadHash; a differing
//     payload under the same id is rejected as corruption.
//   - transitions are validated against SUBMISSION_TRANSITIONS.
//   - recover() never re-dispatches a record whose execution state cannot be
//     determined; it surfaces those as "unknown" for reconciliation.

import { DatabaseSync } from "node:sqlite";
import {
  SUBMISSION_TRANSITIONS,
  hashSubmissionPayload,
  type SubmissionLedgerRecord,
  type SubmissionState,
} from "@artemis/protocol";

export class SubmissionLedger {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA journal_mode = WAL;");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS prompt_submissions (
        submission_id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('panel', 'composer')),
        candidate_text TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        state TEXT NOT NULL CHECK (state IN (
          'prepared','accepted','queued','dispatching','running',
          'completed','failed','cancelled','unknown'
        )),
        turn_id TEXT,
        binding_revision TEXT NOT NULL,
        last_transition_reason TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS idx_prompt_submissions_thread_seq
        ON prompt_submissions (thread_id, sequence)
    `);
  }

  /**
   * Persist a new accepted submission. Returns the stored record. Calling
   * accept twice with the same submissionId and the same text is idempotent;
   * the same id with different text is rejected (ledger corruption).
   */
  accept(input: {
    submissionId: string;
    threadId: string;
    source: "panel" | "composer";
    candidateText: string;
    bindingRevision: string;
  }): SubmissionLedgerRecord {
    const existing = this.get(input.submissionId);
    const payloadHash = hashSubmissionPayload(input.candidateText);
    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        throw new Error(
          `Submission ${input.submissionId} already exists with a different payload; refusing to overwrite.`,
        );
      }
      return existing;
    }
    const now = new Date().toISOString();
    const sequence = this.nextSequence(input.threadId);
    this.database
      .prepare(
        `INSERT INTO prompt_submissions (
           submission_id, thread_id, source, candidate_text, payload_hash,
           sequence, state, turn_id, binding_revision,
           last_transition_reason, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'accepted', NULL, ?, 'accepted', ?, ?)`,
      )
      .run(
        input.submissionId,
        input.threadId,
        input.source,
        input.candidateText,
        payloadHash,
        sequence,
        input.bindingRevision,
        now,
        now,
      );
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return this.get(input.submissionId)!;
  }

  get(submissionId: string): SubmissionLedgerRecord | undefined {
    return rowToRecord(
      this.database
        .prepare("SELECT * FROM prompt_submissions WHERE submission_id = ?")
        .get(submissionId) as Row | undefined,
    );
  }

  listByThread(threadId: string): SubmissionLedgerRecord[] {
    const rows = (
      this.database
        .prepare(
          "SELECT * FROM prompt_submissions WHERE thread_id = ? ORDER BY sequence",
        )
        .all(threadId) as Row[]
    ).map(rowToRecord);
    return rows.filter((r): r is SubmissionLedgerRecord => Boolean(r));
  }

  /**
   * Advance a submission's state. Illegal transitions throw. The caller is
   * expected to wrap dispatch-critical sequences in its own transaction so
   * state changes are atomic with any checkpoint writes.
   */
  transition(
    submissionId: string,
    to: SubmissionState,
    reason: string,
    turnId?: string,
  ): SubmissionLedgerRecord {
    const current = this.get(submissionId);
    if (!current) throw new Error(`Unknown submission ${submissionId}`);
    const allowed = SUBMISSION_TRANSITIONS[current.state];
    if (!allowed.includes(to)) {
      throw new Error(
        `Illegal submission transition ${current.state} -> ${to} for ${submissionId}`,
      );
    }
    this.database
      .prepare(
        `UPDATE prompt_submissions
           SET state = ?, last_transition_reason = ?, updated_at = ?,
               turn_id = COALESCE(?, turn_id)
         WHERE submission_id = ?`,
      )
      .run(to, reason, new Date().toISOString(), turnId ?? null, submissionId);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return this.get(submissionId)!;
  }

  /**
   * Crash-window reconciliation, run at startup. Records that were mid-flight
   * (queued beyond accept, dispatching, or running) when the process died
   * cannot be assumed un-executed: they are marked "unknown" with the
   * original state preserved in the reason so the host can reconcile against
   * the turn log before any retry. Records still safely pre-dispatch
   * (accepted) are returned as re-dispatchable.
   */
  recover(): {
    redispatchable: SubmissionLedgerRecord[];
    unknown: SubmissionLedgerRecord[];
  } {
    const redispatchable: SubmissionLedgerRecord[] = [];
    const unknown: SubmissionLedgerRecord[] = [];
    const inFlight = (
      this.database
        .prepare(
          `SELECT * FROM prompt_submissions
            WHERE state IN ('queued', 'dispatching', 'running')`,
        )
        .all() as Row[]
    ).map(rowToRecord);
    for (const record of inFlight) {
      if (!record) continue;
      const moved = this.transition(
        record.submissionId,
        "unknown",
        `recovered from ${record.state} after restart`,
      );
      unknown.push(moved);
    }
    const accepted = (
      this.database
        .prepare("SELECT * FROM prompt_submissions WHERE state = 'accepted'")
        .all() as Row[]
    ).map(rowToRecord);
    redispatchable.push(
      ...accepted.filter((r): r is SubmissionLedgerRecord => Boolean(r)),
    );
    // Records already marked unknown in a previous restart stay visible until
    // they are explicitly reconciled to a terminal state; recovery must not
    // silently drop unresolved work from its report.
    const stillUnknown = (
      this.database
        .prepare("SELECT * FROM prompt_submissions WHERE state = 'unknown'")
        .all() as Row[]
    ).map(rowToRecord);
    unknown.push(
      ...stillUnknown.filter((r): r is SubmissionLedgerRecord => Boolean(r)),
    );
    return { redispatchable, unknown };
  }

  close(): void {
    this.database.close();
  }

  private nextSequence(threadId: string): number {
    const row = this.database
      .prepare(
        `SELECT COALESCE(MAX(sequence), 0) AS max FROM prompt_submissions
          WHERE thread_id = ?`,
      )
      .get(threadId) as { max: number };
    return row.max + 1;
  }
}

type Row = {
  submission_id: string;
  thread_id: string;
  source: string;
  candidate_text: string;
  payload_hash: string;
  sequence: number;
  state: string;
  turn_id: string | null;
  binding_revision: string;
  last_transition_reason: string;
  created_at: string;
  updated_at: string;
};

function rowToRecord(row: Row | undefined): SubmissionLedgerRecord | undefined {
  if (!row) return undefined;
  return {
    submissionId: row.submission_id,
    threadId: row.thread_id,
    source: row.source as "panel" | "composer",
    candidateText: row.candidate_text,
    payloadHash: row.payload_hash,
    sequence: row.sequence,
    state: row.state as SubmissionState,
    turnId: row.turn_id,
    bindingRevision: row.binding_revision,
    lastTransitionReason: row.last_transition_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

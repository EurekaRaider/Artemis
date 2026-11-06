import { promptSubmissionFromRow } from "../store-row-codecs.js";
import { PLUGIN_OPERATION_TRANSITIONS } from "../store-schema.js";
import {
  type PromptSubmissionRow,
  type PluginOperationRow,
} from "../store-types.js";

import {
  hashSubmissionPayload,
  isValidSubmissionTransition,
  type SubmissionLedgerRecord,
  type SubmissionState,
} from "@artemis/protocol";

import type { StoreDependencies } from "./store-dependencies.js";
export function createPluginRepository(
  services: Pick<
    StoreDependencies,
    "database" | "getPromptSubmission" | "nextSubmissionSequence"
  >,
) {
  function insertPluginGrant(grant: {
    grantId: string;
    installationId: string;
    pluginId: string;
    contentHash: string;
    scope: "thread" | "project";
    scopeId: string;
    capabilities: Record<string, unknown>;
    resourceRefs: Record<string, unknown>;
    grantRevision: string;
  }): void {
    const now = new Date().toISOString();
    services.database
      .prepare(
        `INSERT INTO plugin_grants (
          grant_id, installation_id, plugin_id, content_hash, scope, scope_id,
          capabilities_json, resource_refs_json, grant_revision, created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (installation_id, scope, scope_id, grant_revision)
        DO NOTHING`,
      )
      .run(
        grant.grantId,
        grant.installationId,
        grant.pluginId,
        grant.contentHash,
        grant.scope,
        grant.scopeId,
        JSON.stringify(grant.capabilities),
        JSON.stringify(grant.resourceRefs),
        grant.grantRevision,
        now,
        now,
      );
  }

  function revokePluginGrants(installationId: string): number {
    const result = services.database
      .prepare(
        `UPDATE plugin_grants
            SET revoked_at = ?, updated_at = ?
          WHERE installation_id = ? AND revoked_at IS NULL`,
      )
      .run(new Date().toISOString(), new Date().toISOString(), installationId);
    return Number(result.changes);
  }

  function listPluginGrants(scopeId: string): Array<Record<string, unknown>> {
    return services.database
      .prepare("SELECT * FROM plugin_grants WHERE scope_id = ?")
      .all(scopeId) as Array<Record<string, unknown>>;
  }

  function acceptPromptSubmission(input: {
    submissionId: string;
    threadId: string;
    source: "panel" | "composer";
    candidateText: string;
    bindingRevision: string;
  }): SubmissionLedgerRecord {
    const existing = services.getPromptSubmission(input.submissionId);
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
    const sequence = services.nextSubmissionSequence(input.threadId);
    services.database
      .prepare(
        `INSERT INTO prompt_submissions (
          submission_id, thread_id, source, candidate_text, payload_hash,
          sequence, state, turn_id, binding_revision,
          last_transition_reason, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'accepted', NULL, ?, 'host-accept', ?, ?)`,
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
    return services.getPromptSubmission(input.submissionId)!;
  }

  function getPromptSubmission(
    submissionId: string,
  ): SubmissionLedgerRecord | undefined {
    const row = services.database
      .prepare("SELECT * FROM prompt_submissions WHERE submission_id = ?")
      .get(submissionId) as PromptSubmissionRow | undefined;
    return row ? promptSubmissionFromRow(row) : undefined;
  }

  function transitionPromptSubmission(
    submissionId: string,
    nextState: SubmissionState,
    reason: string,
    turnId?: string,
  ): SubmissionLedgerRecord {
    const current = services.getPromptSubmission(submissionId);
    if (!current) throw new Error(`Unknown submission: ${submissionId}`);
    // Rebind check precedes transition validity: a turn conflict must be
    // reported as a rebind refusal even when the state transition itself
    // would be illegal (e.g. running → running with a different turn).
    if (turnId && current.turnId && current.turnId !== turnId) {
      throw new Error(
        `Submission ${submissionId} is bound to turn ${current.turnId}; refusing rebind to ${turnId}`,
      );
    }
    if (!isValidSubmissionTransition(current.state, nextState)) {
      throw new Error(
        `Illegal submission transition: ${current.state} -> ${nextState}`,
      );
    }
    services.database
      .prepare(
        `UPDATE prompt_submissions
         SET state = ?, last_transition_reason = ?, updated_at = ?,
             turn_id = COALESCE(?, turn_id)
         WHERE submission_id = ?`,
      )
      .run(
        nextState,
        reason,
        new Date().toISOString(),
        turnId ?? null,
        submissionId,
      );
    return services.getPromptSubmission(submissionId)!;
  }

  function listPromptSubmissions(threadId: string): SubmissionLedgerRecord[] {
    return (
      services.database
        .prepare(
          "SELECT * FROM prompt_submissions WHERE thread_id = ? ORDER BY sequence",
        )
        .all(threadId) as unknown as PromptSubmissionRow[]
    ).map(promptSubmissionFromRow);
  }

  function nextSubmissionSequence(threadId: string): number {
    const row = services.database
      .prepare(
        "SELECT COALESCE(MAX(sequence), 0) AS max FROM prompt_submissions WHERE thread_id = ?",
      )
      .get(threadId) as { max: number };
    return row.max + 1;
  }

  function commitPluginStateTransaction<T>(work: () => T): T {
    services.database.exec("BEGIN IMMEDIATE;");
    try {
      const result = work();
      services.database.exec("COMMIT;");
      return result;
    } catch (error) {
      try {
        services.database.exec("ROLLBACK;");
      } catch {
        // The transaction may have failed before BEGIN returned.
      }
      throw error;
    }
  }

  function readPluginStateHead(input: {
    threadId: string;
    pluginId: string;
    stateSchemaVersion: number;
  }):
    | {
        stateRevision: string;
        snapshotId: string;
        bindingRevision: string;
        updatedAt: string;
      }
    | undefined {
    return services.database
      .prepare(
        `SELECT state_revision AS stateRevision, snapshot_id AS snapshotId,
                binding_revision AS bindingRevision, updated_at AS updatedAt
           FROM plugin_state_heads
          WHERE thread_id = ? AND plugin_id = ? AND state_schema_version = ?`,
      )
      .get(input.threadId, input.pluginId, input.stateSchemaVersion) as
      | {
          stateRevision: string;
          snapshotId: string;
          bindingRevision: string;
          updatedAt: string;
        }
      | undefined;
  }

  function upsertPluginStateHead(input: {
    threadId: string;
    pluginId: string;
    stateSchemaVersion: number;
    bindingRevision: string;
    stateRevision: string;
    snapshotId: string;
  }): void {
    services.database
      .prepare(
        `INSERT INTO plugin_state_heads (
           thread_id, plugin_id, binding_revision, state_schema_version,
           state_revision, snapshot_id, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (thread_id, plugin_id, state_schema_version) DO UPDATE SET
           binding_revision = excluded.binding_revision,
           state_revision = excluded.state_revision,
           snapshot_id = excluded.snapshot_id,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.threadId,
        input.pluginId,
        input.bindingRevision,
        input.stateSchemaVersion,
        input.stateRevision,
        input.snapshotId,
        new Date().toISOString(),
      );
  }

  function insertPluginSnapshot(snapshot: {
    snapshotId: string;
    threadId: string;
    pluginId: string;
    files: Array<{ path: string; hash: string }>;
    parentSnapshotId?: string;
    createdByOperationId?: string;
    packageRevision: string;
  }): void {
    services.database
      .prepare(
        `INSERT INTO plugin_snapshots (
          snapshot_id, thread_id, plugin_id, files_json,
          parent_snapshot_id, created_by_operation_id, package_revision,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        snapshot.snapshotId,
        snapshot.threadId,
        snapshot.pluginId,
        JSON.stringify(snapshot.files),
        snapshot.parentSnapshotId ?? null,
        snapshot.createdByOperationId ?? null,
        snapshot.packageRevision,
        new Date().toISOString(),
      );
  }

  function recordPluginOperation(operation: {
    operationId: string;
    threadId: string;
    pluginId: string;
    toolName: string;
    requestDigest: string;
    state: "prepared" | "running" | "succeeded" | "failed" | "cancelled";
    resultRef?: string;
    result?: unknown;
    error?: string;
  }): void {
    const existing = services.database
      .prepare("SELECT * FROM plugin_operations WHERE operation_id = ?")
      .get(operation.operationId) as PluginOperationRow | undefined;
    const now = new Date().toISOString();
    if (existing) {
      if (
        existing.request_digest !== operation.requestDigest ||
        existing.thread_id !== operation.threadId ||
        existing.plugin_id !== operation.pluginId ||
        existing.tool_name !== operation.toolName
      ) {
        throw new Error(
          `Operation ${operation.operationId} replayed with a different request digest; refusing.`,
        );
      }
      const allowed = PLUGIN_OPERATION_TRANSITIONS[existing.state];
      if (!allowed || !allowed.has(operation.state)) {
        throw new Error(
          `Operation ${operation.operationId} is ${existing.state}; transition to ${operation.state} is refused.`,
        );
      }
      if (existing.state === operation.state) return;
      services.database
        .prepare(
          `UPDATE plugin_operations
           SET state = ?, result_ref = COALESCE(?, result_ref),
               result_json = ?, error = ?,
               updated_at = ?
           WHERE operation_id = ?`,
        )
        .run(
          operation.state,
          operation.resultRef ?? null,
          operation.result === undefined
            ? null
            : JSON.stringify(operation.result),
          operation.error ?? null,
          now,
          operation.operationId,
        );
      return;
    }
    services.database
      .prepare(
        `INSERT INTO plugin_operations (
          operation_id, thread_id, plugin_id, tool_name, request_digest,
          state, result_ref, result_json, error, cancelled_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      )
      .run(
        operation.operationId,
        operation.threadId,
        operation.pluginId,
        operation.toolName,
        operation.requestDigest,
        operation.state,
        operation.resultRef ?? null,
        operation.result === undefined
          ? null
          : JSON.stringify(operation.result),
        operation.error ?? null,
        now,
        now,
      );
  }

  function readPluginOperation(operationId: string):
    | {
        operationId: string;
        threadId: string;
        pluginId: string;
        toolName: string;
        requestDigest: string;
        state: "prepared" | "running" | "succeeded" | "failed" | "cancelled";
        resultRef?: string;
        result?: unknown;
        error?: string;
      }
    | undefined {
    const row = services.database
      .prepare("SELECT * FROM plugin_operations WHERE operation_id = ?")
      .get(operationId) as PluginOperationRow | undefined;
    if (!row) return undefined;
    return {
      operationId: row.operation_id,
      threadId: row.thread_id,
      pluginId: row.plugin_id,
      toolName: row.tool_name,
      requestDigest: row.request_digest,
      state: row.state as
        "prepared" | "running" | "succeeded" | "failed" | "cancelled",
      ...(row.result_ref ? { resultRef: row.result_ref } : {}),
      ...(row.result_json ? { result: JSON.parse(row.result_json) } : {}),
      ...(row.error ? { error: row.error } : {}),
    };
  }

  function appendPluginEvent(event: {
    eventId: string;
    streamId: string;
    threadId: string;
    schemaVersion: number;
    payload: Record<string, unknown>;
  }): void {
    const seqRow = services.database
      .prepare(
        "SELECT COALESCE(MAX(seq), 0) AS max FROM plugin_events WHERE stream_id = ?",
      )
      .get(event.streamId) as { max: number };
    services.database
      .prepare(
        `INSERT INTO plugin_events (
          event_id, stream_id, thread_id, seq, schema_version, payload_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.eventId,
        event.streamId,
        event.threadId,
        seqRow.max + 1,
        event.schemaVersion,
        JSON.stringify(event.payload),
        new Date().toISOString(),
      );
  }
  const handlers = {
    insertPluginGrant,
    revokePluginGrants,
    listPluginGrants,
    acceptPromptSubmission,
    getPromptSubmission,
    transitionPromptSubmission,
    listPromptSubmissions,
    nextSubmissionSequence,
    commitPluginStateTransaction,
    readPluginStateHead,
    upsertPluginStateHead,
    insertPluginSnapshot,
    recordPluginOperation,
    readPluginOperation,
    appendPluginEvent,
  };
  return handlers;
}

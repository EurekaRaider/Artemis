import {
  customAgentFromRow,
  customAgentInvocationFromRow,
} from "../store-row-codecs.js";

import {
  type CustomAgentRow,
  type CustomAgentInvocationRow,
} from "../store-types.js";
import { randomUUID } from "node:crypto";

import {
  canTransitionInvocation,
  normalizeAgentToken,
  type CustomAgentDefinition,
  type CustomAgentInvocationRecord,
  type CustomAgentInvocationStatus,
  type CustomAgentModelPolicy,
  type CustomAgentThinkingPolicy,
  type CustomAgentToolPolicy,
} from "@artemis/protocol";

import type { StoreDependencies } from "./store-dependencies.js";
export function createCustomAgentRepository(
  services: Pick<
    StoreDependencies,
    | "database"
    | "getCustomAgent"
    | "listCustomAgents"
    | "listCustomAgentProjectIds"
    | "getCustomAgentInvocation"
    | "upsertCustomAgentInvocation"
    | "transitionCustomAgentInvocation"
  >,
) {
  function createCustomAgent(input: {
    name: string;
    description: string;
    color: string;
    enabled?: boolean;
    instructions: string;
    scope: "all" | "selected";
    projectIds?: string[];
    modelPolicy?: CustomAgentModelPolicy;
    thinkingPolicy?: CustomAgentThinkingPolicy;
    toolPolicy?: CustomAgentToolPolicy;
    allowAutomaticInvocation?: boolean;
    triggers?: string[];
  }): CustomAgentDefinition {
    const now = new Date().toISOString();
    const id = randomUUID();
    const normalizedName = normalizeAgentToken(input.name);
    const modelPolicy = input.modelPolicy ?? { kind: "inherit" };
    const thinkingPolicy = input.thinkingPolicy ?? { kind: "inherit" };
    const toolPolicy: CustomAgentToolPolicy = { kind: "inherit" };
    const projectIds = input.projectIds ?? [];
    services.database.exec("BEGIN IMMEDIATE");
    try {
      services.database
        .prepare(
          `INSERT INTO custom_agents (
            id, revision, name, normalized_name, description, color, enabled,
            instructions, scope, model_policy_json, thinking_policy_json,
            tool_policy_json, allow_automatic_invocation, triggers_json,
            created_at, updated_at
          ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.name,
          normalizedName,
          input.description,
          input.color,
          (input.enabled ?? true) ? 1 : 0,
          input.instructions,
          input.scope,
          JSON.stringify(modelPolicy),
          JSON.stringify(thinkingPolicy),
          JSON.stringify(toolPolicy),
          input.allowAutomaticInvocation ? 1 : 0,
          JSON.stringify(input.triggers ?? []),
          now,
          now,
        );
      for (const projectId of projectIds) {
        services.database
          .prepare(
            "INSERT INTO custom_agent_projects (agent_id, project_id) VALUES (?, ?)",
          )
          .run(id, projectId);
      }
      services.database.exec("COMMIT");
    } catch (error) {
      services.database.exec("ROLLBACK");
      throw error;
    }
    const created = services.getCustomAgent(id);
    if (!created) throw new Error("Failed to create custom agent.");
    return created;
  }

  function getCustomAgent(id: string): CustomAgentDefinition | undefined {
    const row = services.database
      .prepare("SELECT * FROM custom_agents WHERE id = ?")
      .get(id) as unknown as CustomAgentRow | undefined;
    return row ? customAgentFromRow(row) : undefined;
  }

  function listCustomAgents(): CustomAgentDefinition[] {
    const rows = services.database
      .prepare("SELECT * FROM custom_agents ORDER BY normalized_name")
      .all() as unknown as CustomAgentRow[];
    return rows.map(customAgentFromRow);
  }

  function listCustomAgentProjectIds(agentId: string): string[] {
    const rows = services.database
      .prepare(
        "SELECT project_id FROM custom_agent_projects WHERE agent_id = ? ORDER BY project_id",
      )
      .all(agentId) as unknown as Array<{ project_id: string }>;
    return rows.map((row) => row.project_id);
  }

  function listEffectiveCustomAgents(
    projectId: string | null,
  ): CustomAgentDefinition[] {
    const effective = services.listCustomAgents().filter((definition) => {
      if (!definition.enabled) return false;
      if (definition.scope === "all") return true;
      if (projectId === null) return false;
      return services
        .listCustomAgentProjectIds(definition.id)
        .includes(projectId);
    });
    // Catalog ordering (D#152 section 7): project-selected definitions
    // first, then stable name/id. Recency ordering is deliberately absent
    // to avoid routing drift; the runtime preserves this order when it
    // injects the per-turn catalog.
    return effective.sort((a, b) => {
      const aSelected = a.scope === "selected" ? 0 : 1;
      const bSelected = b.scope === "selected" ? 0 : 1;
      if (aSelected !== bSelected) return aSelected - bSelected;
      const byName = a.name.localeCompare(b.name);
      return byName !== 0 ? byName : a.id.localeCompare(b.id);
    });
  }

  function updateCustomAgent(
    id: string,
    expectedRevision: number,
    patch: {
      name?: string;
      description?: string;
      color?: string;
      enabled?: boolean;
      instructions?: string;
      scope?: "all" | "selected";
      projectIds?: string[];
      modelPolicy?: CustomAgentModelPolicy;
      thinkingPolicy?: CustomAgentThinkingPolicy;
      toolPolicy?: CustomAgentToolPolicy;
      allowAutomaticInvocation?: boolean;
      triggers?: string[];
    },
  ): CustomAgentDefinition {
    const current = services.getCustomAgent(id);
    if (!current) {
      throw new Error("CUSTOM_AGENT_NOT_FOUND");
    }
    if (current.revision !== expectedRevision) {
      throw new Error("CUSTOM_AGENT_REVISION_CONFLICT");
    }
    const now = new Date().toISOString();
    services.database.exec("BEGIN IMMEDIATE");
    try {
      // Re-check inside the transaction: no other writer may have advanced
      // the revision between the optimistic check and the write.
      const guarded = services.database
        .prepare(
          `UPDATE custom_agents SET
            revision = revision + 1,
            name = ?, normalized_name = ?, description = ?, color = ?,
            enabled = ?, instructions = ?, scope = ?,
            model_policy_json = ?, thinking_policy_json = ?,
            tool_policy_json = ?, allow_automatic_invocation = ?,
            triggers_json = ?, updated_at = ?
          WHERE id = ? AND revision = ?`,
        )
        .run(
          patch.name ?? current.name,
          normalizeAgentToken(patch.name ?? current.name),
          patch.description ?? current.description,
          patch.color ?? current.color,
          (patch.enabled ?? current.enabled) ? 1 : 0,
          patch.instructions ?? current.instructions,
          patch.scope ?? current.scope,
          JSON.stringify(patch.modelPolicy ?? current.modelPolicy),
          JSON.stringify(patch.thinkingPolicy ?? current.thinkingPolicy),
          JSON.stringify({ kind: "inherit" }),
          (patch.allowAutomaticInvocation ?? current.allowAutomaticInvocation)
            ? 1
            : 0,
          JSON.stringify(patch.triggers ?? current.triggers),
          now,
          id,
          expectedRevision,
        );
      if (guarded.changes === 0) {
        throw new Error("CUSTOM_AGENT_REVISION_CONFLICT");
      }
      if (patch.projectIds !== undefined) {
        services.database
          .prepare("DELETE FROM custom_agent_projects WHERE agent_id = ?")
          .run(id);
        for (const projectId of patch.projectIds) {
          services.database
            .prepare(
              "INSERT INTO custom_agent_projects (agent_id, project_id) VALUES (?, ?)",
            )
            .run(id, projectId);
        }
      }
      services.database.exec("COMMIT");
    } catch (error) {
      services.database.exec("ROLLBACK");
      throw error;
    }
    const updated = services.getCustomAgent(id);
    if (!updated) throw new Error("Failed to update custom agent.");
    return updated;
  }

  function deleteCustomAgent(id: string): void {
    // Links cascade; invocation history keeps its definition id/revision/
    // name snapshot and is intentionally NOT cascade-deleted.
    services.database.prepare("DELETE FROM custom_agents WHERE id = ?").run(id);
  }

  function upsertCustomAgentInvocation(
    record: Omit<CustomAgentInvocationRecord, "createdAt" | "updatedAt">,
  ): { record: CustomAgentInvocationRecord; inserted: boolean } {
    const now = new Date().toISOString();
    const inserted = services.database
      .prepare(
        `INSERT OR IGNORE INTO custom_agent_invocations (
          thread_id, invocation_id, request_fingerprint, definition_id,
          definition_revision, definition_name, turn_id, instance_id, status,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.threadId,
        record.invocationId,
        record.requestFingerprint,
        record.definitionId,
        record.definitionRevision,
        record.definitionName,
        record.turnId,
        record.instanceId,
        record.status,
        now,
        now,
      );
    const existing = services.getCustomAgentInvocation(
      record.threadId,
      record.invocationId,
    );
    if (!existing) throw new Error("Failed to persist invocation record.");
    if (existing.requestFingerprint !== record.requestFingerprint) {
      throw new Error("INVOCATION_CONFLICT");
    }
    return { record: existing, inserted: inserted.changes > 0 };
  }

  function commitCustomAgentInvocations(
    records: Array<
      Omit<CustomAgentInvocationRecord, "createdAt" | "updatedAt">
    >,
  ): string | undefined {
    services.database.exec("BEGIN IMMEDIATE");
    try {
      const saved = records.map(
        (record) => services.upsertCustomAgentInvocation(record).record,
      );
      const committed = saved.filter(
        (record) => record.status === "dispatch-committed",
      );
      if (committed.length) {
        if (
          committed.length !== saved.length ||
          new Set(committed.map((record) => record.turnId)).size !== 1
        ) {
          throw new Error(
            "INVOCATION_CONFLICT: task batch does not match its original submission.",
          );
        }
        services.database.exec("COMMIT");
        return committed[0]!.turnId ?? undefined;
      }
      for (const record of saved) {
        if (record.status === "outcome-unknown")
          throw new Error(
            "INVOCATION_OUTCOME_UNKNOWN: send a new message to re-execute.",
          );
        if (record.status !== "pending")
          throw new Error("INVOCATION_CONFLICT: invocation already completed.");
        services.transitionCustomAgentInvocation(
          record.threadId,
          record.invocationId,
          "dispatch-committed",
          { turnId: records[0]!.turnId! },
        );
      }
      services.database.exec("COMMIT");
      return undefined;
    } catch (error) {
      services.database.exec("ROLLBACK");
      throw error;
    }
  }

  function getCustomAgentInvocation(
    threadId: string,
    invocationId: string,
  ): CustomAgentInvocationRecord | undefined {
    const row = services.database
      .prepare(
        `SELECT * FROM custom_agent_invocations
         WHERE thread_id = ? AND invocation_id = ?`,
      )
      .get(threadId, invocationId) as unknown as
      CustomAgentInvocationRow | undefined;
    return row ? customAgentInvocationFromRow(row) : undefined;
  }

  function listCustomAgentInvocationsForThread(
    threadId: string,
  ): CustomAgentInvocationRecord[] {
    const rows = services.database
      .prepare(
        `SELECT * FROM custom_agent_invocations
         WHERE thread_id = ? ORDER BY created_at, invocation_id`,
      )
      .all(threadId) as unknown as CustomAgentInvocationRow[];
    return rows.map(customAgentInvocationFromRow);
  }

  function bindCustomAgentInvocationInstance(
    threadId: string,
    invocationId: string,
    instanceId: string,
  ): void {
    services.database
      .prepare(
        `UPDATE custom_agent_invocations
         SET instance_id = ?, updated_at = ?
         WHERE thread_id = ? AND invocation_id = ?
           AND status = 'dispatch-committed' AND instance_id IS NULL`,
      )
      .run(instanceId, new Date().toISOString(), threadId, invocationId);
  }

  function markStalePendingCustomAgentInvocations(): number {
    const result = services.database
      .prepare(
        `UPDATE custom_agent_invocations
         SET status = 'outcome-unknown', updated_at = ?
         WHERE status = 'pending'`,
      )
      .run(new Date().toISOString());
    return Number(result.changes);
  }

  function transitionCustomAgentInvocation(
    threadId: string,
    invocationId: string,
    to: CustomAgentInvocationStatus,
    patch: { turnId?: string; instanceId?: string } = {},
  ): CustomAgentInvocationRecord {
    const current = services.getCustomAgentInvocation(threadId, invocationId);
    if (!current) throw new Error("INVOCATION_NOT_FOUND");
    if (!canTransitionInvocation(current.status, to)) {
      throw new Error(`INVOCATION_ILLEGAL_TRANSITION:${current.status}->${to}`);
    }
    const now = new Date().toISOString();
    const updated = services.database
      .prepare(
        `UPDATE custom_agent_invocations
         SET status = ?, turn_id = COALESCE(?, turn_id),
             instance_id = COALESCE(?, instance_id), updated_at = ?
         WHERE thread_id = ? AND invocation_id = ? AND status = ?`,
      )
      .run(
        to,
        patch.turnId ?? null,
        patch.instanceId ?? null,
        now,
        threadId,
        invocationId,
        current.status,
      );
    if (updated.changes === 0) {
      throw new Error("INVOCATION_TRANSITION_LOST_RACE");
    }
    const next = services.getCustomAgentInvocation(threadId, invocationId);
    if (!next) throw new Error("Invocation record vanished.");
    return next;
  }
  const handlers = {
    createCustomAgent,
    getCustomAgent,
    listCustomAgents,
    listCustomAgentProjectIds,
    listEffectiveCustomAgents,
    updateCustomAgent,
    deleteCustomAgent,
    upsertCustomAgentInvocation,
    commitCustomAgentInvocations,
    getCustomAgentInvocation,
    listCustomAgentInvocationsForThread,
    bindCustomAgentInvocationInstance,
    markStalePendingCustomAgentInvocations,
    transitionCustomAgentInvocation,
  };
  return handlers;
}

import {
  automationFromRow,
  automationRunFromRow,
} from "../store-row-codecs.js";

import { type AutomationRow, type AutomationRunRow } from "../store-types.js";

import {
  automationRunSchema,
  automationSchema,
  type Automation,
  type AutomationRun,
  type AutomationRunState,
} from "@artemis/protocol";

import type { StoreDependencies } from "./store-dependencies.js";
export function createAutomationRepository(
  services: Pick<
    StoreDependencies,
    | "database"
    | "getAutomation"
    | "updateAutomation"
    | "getAutomationRun"
    | "getAutomationRunForThread"
    | "updateAutomationRun"
    | "completeAutomationRunForThreadCore"
    | "softDeleteAutomation"
  >,
) {
  function createAutomation(automation: Automation): Automation {
    const value = automationSchema.parse(automation);
    services.database
      .prepare(
        `INSERT INTO automations (
          id, project_id, name, prompt, mode, target, schedule_json, enabled,
          authorization_state, authorization_fingerprint, authorized_at,
          next_run_at, last_run_at, deleted_at, created_at, updated_at, model_selection_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        value.id,
        value.projectId,
        value.name,
        value.prompt,
        value.mode,
        value.target,
        JSON.stringify(value.schedule),
        value.enabled ? 1 : 0,
        value.authorizationState,
        value.authorizationFingerprint ?? null,
        value.authorizedAt ?? null,
        value.nextRunAt ?? null,
        value.lastRunAt ?? null,
        value.deletedAt ?? null,
        value.createdAt,
        value.updatedAt,
        value.modelSelection ? JSON.stringify(value.modelSelection) : null,
      );
    return services.getAutomation(value.id)!;
  }

  function getAutomation(id: string): Automation | undefined {
    const row = services.database
      .prepare("SELECT * FROM automations WHERE id = ?")
      .get(id) as AutomationRow | undefined;
    return row ? automationFromRow(row) : undefined;
  }

  function listAutomations(projectId?: string): Automation[] {
    const rows = (projectId
      ? services.database
          .prepare(
            `SELECT * FROM automations
               WHERE project_id = ? AND deleted_at IS NULL
               ORDER BY updated_at DESC`,
          )
          .all(projectId)
      : services.database
          .prepare(
            `SELECT * FROM automations
               WHERE deleted_at IS NULL
               ORDER BY updated_at DESC`,
          )
          .all()) as unknown as AutomationRow[];
    return rows.map(automationFromRow);
  }

  function listDueAutomations(now: string): Automation[] {
    return (
      services.database
        .prepare(
          `SELECT * FROM automations
           WHERE enabled = 1
             AND deleted_at IS NULL
             AND next_run_at IS NOT NULL
             AND next_run_at <= ?
           ORDER BY next_run_at ASC`,
        )
        .all(now) as unknown as AutomationRow[]
    ).map(automationFromRow);
  }

  function updateAutomation(automation: Automation): Automation {
    const value = automationSchema.parse(automation);
    if (!services.getAutomation(value.id)) {
      throw new Error(`Automation not found: ${value.id}`);
    }
    services.database
      .prepare(
        `UPDATE automations
         SET name = ?, prompt = ?, mode = ?, target = ?, schedule_json = ?,
             enabled = ?, authorization_state = ?,
             authorization_fingerprint = ?, authorized_at = ?,
             next_run_at = ?, last_run_at = ?, deleted_at = ?, updated_at = ?,
             model_selection_json = ?
         WHERE id = ?`,
      )
      .run(
        value.name,
        value.prompt,
        value.mode,
        value.target,
        JSON.stringify(value.schedule),
        value.enabled ? 1 : 0,
        value.authorizationState,
        value.authorizationFingerprint ?? null,
        value.authorizedAt ?? null,
        value.nextRunAt ?? null,
        value.lastRunAt ?? null,
        value.deletedAt ?? null,
        value.updatedAt,
        value.modelSelection ? JSON.stringify(value.modelSelection) : null,
        value.id,
      );
    return services.getAutomation(value.id)!;
  }

  function softDeleteAutomation(id: string): Automation {
    const current = services.getAutomation(id);
    if (!current) throw new Error(`Automation not found: ${id}`);
    const now = new Date().toISOString();
    return services.updateAutomation({
      ...current,
      enabled: false,
      nextRunAt: undefined,
      deletedAt: now,
      updatedAt: now,
    });
  }

  function claimAutomationRun(
    run: AutomationRun,
    options: {
      nextRunAt?: string;
      advanceSchedule: boolean;
      disableAutomation?: boolean;
    },
  ): AutomationRun | undefined {
    const value = automationRunSchema.parse(run);
    services.database.exec("BEGIN IMMEDIATE");
    try {
      const existing = services.database
        .prepare(
          `SELECT 1 FROM automation_runs
           WHERE automation_id = ? AND scheduled_for = ?`,
        )
        .get(value.automationId, value.scheduledFor);
      if (existing) {
        services.database.exec("ROLLBACK");
        return undefined;
      }
      services.database
        .prepare(
          `INSERT INTO automation_runs (
            id, automation_id, scheduled_for, trigger, state, thread_id,
            reason, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          value.id,
          value.automationId,
          value.scheduledFor,
          value.trigger,
          value.state,
          value.threadId ?? null,
          value.reason ?? null,
          value.createdAt,
          value.updatedAt,
        );
      if (options.advanceSchedule) {
        services.database
          .prepare(
            `UPDATE automations
             SET next_run_at = ?, last_run_at = ?, enabled = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(
            options.nextRunAt ?? null,
            value.scheduledFor,
            options.disableAutomation ? 0 : 1,
            value.updatedAt,
            value.automationId,
          );
      } else {
        services.database
          .prepare(
            `UPDATE automations
             SET last_run_at = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(value.scheduledFor, value.updatedAt, value.automationId);
      }
      services.database.exec("COMMIT");
      return services.getAutomationRun(value.id)!;
    } catch (error) {
      services.database.exec("ROLLBACK");
      throw error;
    }
  }

  function getAutomationRun(id: string): AutomationRun | undefined {
    const row = services.database
      .prepare("SELECT * FROM automation_runs WHERE id = ?")
      .get(id) as AutomationRunRow | undefined;
    return row ? automationRunFromRow(row) : undefined;
  }

  function getAutomationRunForThread(
    threadId: string,
  ): AutomationRun | undefined {
    const row = services.database
      .prepare(
        `SELECT * FROM automation_runs
         WHERE thread_id = ?
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get(threadId) as AutomationRunRow | undefined;
    return row ? automationRunFromRow(row) : undefined;
  }

  function listAutomationRuns(
    automationId: string,
    limit = 50,
  ): AutomationRun[] {
    const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), 200));
    return (
      services.database
        .prepare(
          `SELECT * FROM automation_runs
           WHERE automation_id = ?
           ORDER BY created_at DESC
           LIMIT ?`,
        )
        .all(automationId, boundedLimit) as unknown as AutomationRunRow[]
    ).map(automationRunFromRow);
  }

  function updateAutomationRun(
    id: string,
    changes: {
      state?: AutomationRunState;
      threadId?: string;
      reason?: string | null;
    },
  ): AutomationRun {
    const current = services.getAutomationRun(id);
    if (!current) throw new Error(`Automation run not found: ${id}`);
    const now = new Date().toISOString();
    services.database
      .prepare(
        `UPDATE automation_runs
         SET state = ?, thread_id = ?, reason = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        changes.state ?? current.state,
        changes.threadId ?? current.threadId ?? null,
        changes.reason === undefined
          ? (current.reason ?? null)
          : changes.reason,
        now,
        id,
      );
    return services.getAutomationRun(id)!;
  }

  function updateAutomationRunForThread(
    threadId: string,
    state: AutomationRunState,
    reason?: string,
  ): AutomationRun | undefined {
    const run = services.getAutomationRunForThread(threadId);
    if (!run) return undefined;
    return services.updateAutomationRun(run.id, {
      state,
      ...(reason ? { reason } : {}),
    });
  }

  function completeAutomationRunForThread(
    threadId: string,
  ): { run: AutomationRun; deletedAutomationId?: string } | undefined {
    services.database.exec("BEGIN IMMEDIATE");
    try {
      const result = services.completeAutomationRunForThreadCore(threadId);
      services.database.exec("COMMIT");
      return result;
    } catch (error) {
      services.database.exec("ROLLBACK");
      throw error;
    }
  }

  function completeAutomationRunForThreadCore(
    threadId: string,
  ): { run: AutomationRun; deletedAutomationId?: string } | undefined {
    const current = services.getAutomationRunForThread(threadId);
    if (!current) return undefined;
    const run = services.updateAutomationRun(current.id, {
      state: "completed",
    });
    const automation = services.getAutomation(run.automationId);
    const shouldDelete =
      automation?.schedule.kind === "once" &&
      !automation.nextRunAt &&
      !automation.deletedAt;
    if (shouldDelete) services.softDeleteAutomation(run.automationId);
    return {
      run,
      ...(shouldDelete ? { deletedAutomationId: run.automationId } : {}),
    };
  }

  function hasActiveAutomationRun(automationId: string): boolean {
    return Boolean(
      services.database
        .prepare(
          `SELECT 1 FROM automation_runs
           WHERE automation_id = ?
             AND state IN ('starting', 'running', 'waiting-approval')
           LIMIT 1`,
        )
        .get(automationId),
    );
  }

  function hasActiveLocalThread(projectId: string): boolean {
    return Boolean(
      services.database
        .prepare(
          `SELECT 1 FROM threads
           WHERE project_id = ? AND target = 'local'
             AND status IN ('running', 'waiting-approval')
           LIMIT 1`,
        )
        .get(projectId),
    );
  }

  function recoverInterruptedAutomationRuns(): AutomationRun[] {
    const rows = services.database
      .prepare(
        `SELECT * FROM automation_runs
         WHERE state = 'starting'`,
      )
      .all() as unknown as AutomationRunRow[];
    return rows.map((row) =>
      services.updateAutomationRun(row.id, {
        state: "failed",
        reason:
          "The previous Artemis process stopped before this scheduled task started.",
      }),
    );
  }
  const handlers = {
    createAutomation,
    getAutomation,
    listAutomations,
    listDueAutomations,
    updateAutomation,
    softDeleteAutomation,
    claimAutomationRun,
    getAutomationRun,
    getAutomationRunForThread,
    listAutomationRuns,
    updateAutomationRun,
    updateAutomationRunForThread,
    completeAutomationRunForThread,
    completeAutomationRunForThreadCore,
    hasActiveAutomationRun,
    hasActiveLocalThread,
    recoverInterruptedAutomationRuns,
  };
  return handlers;
}

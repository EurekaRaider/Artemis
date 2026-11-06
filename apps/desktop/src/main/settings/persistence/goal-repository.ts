import { activeGoalSeconds, threadGoalFromRow } from "../store-row-codecs.js";

import { type ThreadGoalRow } from "../store-types.js";
import { randomUUID } from "node:crypto";

import { type ThreadGoal, type ThreadGoalStatus } from "@artemis/protocol";

import type { StoreDependencies } from "./store-dependencies.js";
export function createGoalRepository(
  services: Pick<
    StoreDependencies,
    | "database"
    | "getThread"
    | "getThreadGoal"
    | "mutateThreadGoal"
    | "setThreadGoal"
    | "updateThreadGoalStatus"
  >,
) {
  function getThreadGoal(threadId: string): ThreadGoal | undefined {
    const row = services.database
      .prepare("SELECT * FROM thread_goals WHERE thread_id = ?")
      .get(threadId) as ThreadGoalRow | undefined;
    return row ? threadGoalFromRow(row) : undefined;
  }

  function setThreadGoal(
    threadId: string,
    objective: string,
    tokenBudget: number | undefined,
    status: ThreadGoalStatus = "active",
  ): ThreadGoal {
    if (!services.getThread(threadId)) {
      throw new Error(`Thread not found: ${threadId}`);
    }
    const normalizedObjective = objective.trim();
    if (!normalizedObjective)
      throw new Error("Goal objective cannot be empty.");
    const existing = services.getThreadGoal(threadId);
    if (existing) throw new Error("This task already has a Goal.");
    const now = new Date().toISOString();
    services.database.exec("BEGIN IMMEDIATE");
    try {
      services.database
        .prepare(
          `INSERT INTO thread_goals (
          thread_id, goal_id, objective, status, token_budget, tokens_used,
          time_used_seconds, revision, blocker, blocker_turns, created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, 0, 0, 1, NULL, 0, ?, ?)`,
        )
        .run(
          threadId,
          randomUUID(),
          normalizedObjective,
          status,
          tokenBudget ?? null,
          now,
          now,
        );
      services.database
        .prepare("UPDATE threads SET updated_at = ? WHERE id = ?")
        .run(now, threadId);
      services.database.exec("COMMIT");
    } catch (error) {
      services.database.exec("ROLLBACK");
      throw error;
    }
    return services.getThreadGoal(threadId)!;
  }

  function updateThreadGoalObjective(
    threadId: string,
    objective: string,
    expectedGoalId: string,
    expectedRevision: number,
  ): ThreadGoal {
    return services.mutateThreadGoal(
      threadId,
      { objective },
      expectedGoalId,
      expectedRevision,
    );
  }

  function mutateThreadGoal(
    threadId: string,
    changes: {
      objective?: string;
      status?: ThreadGoalStatus;
      tokenBudget?: number | null;
    },
    expectedGoalId?: string,
    expectedRevision?: number,
    clearBlocker = false,
  ): ThreadGoal {
    const goal = services.getThreadGoal(threadId);
    if (!goal) {
      if (expectedGoalId !== undefined || expectedRevision !== undefined) {
        throw new Error("The Goal changed while it was being edited.");
      }
      const objective = changes.objective?.trim();
      if (!objective) throw new Error("A new Goal requires an objective.");
      return services.setThreadGoal(
        threadId,
        objective,
        changes.tokenBudget ?? undefined,
        changes.status ?? "active",
      );
    }
    if (
      (expectedGoalId !== undefined && goal.goalId !== expectedGoalId) ||
      (expectedRevision !== undefined && goal.revision !== expectedRevision)
    ) {
      throw new Error("The Goal changed while it was being edited.");
    }
    const normalizedObjective = changes.objective?.trim() ?? goal.objective;
    if (!normalizedObjective) {
      throw new Error("Goal objective cannot be empty.");
    }
    const status =
      changes.status ??
      (changes.objective !== undefined && goal.status === "complete"
        ? "active"
        : goal.status);
    const tokenBudget =
      changes.tokenBudget === undefined
        ? goal.tokenBudget
        : (changes.tokenBudget ?? undefined);
    const shouldClearBlocker =
      clearBlocker || (goal.status === "complete" && status === "active");
    const matchedGoalId = expectedGoalId ?? goal.goalId;
    const matchedRevision = expectedRevision ?? goal.revision;
    const now = new Date().toISOString();
    services.database.exec("BEGIN IMMEDIATE");
    try {
      const result = services.database
        .prepare(
          `UPDATE thread_goals
           SET objective = ?, status = ?, token_budget = ?,
               time_used_seconds = ?,
               revision = revision + 1,
               blocker = CASE WHEN ? THEN NULL ELSE blocker END,
               blocker_turns = CASE WHEN ? THEN 0 ELSE blocker_turns END,
               updated_at = ?
           WHERE thread_id = ? AND goal_id = ? AND revision = ?`,
        )
        .run(
          normalizedObjective,
          status,
          tokenBudget ?? null,
          goal.timeUsedSeconds + activeGoalSeconds(goal, now),
          shouldClearBlocker ? 1 : 0,
          shouldClearBlocker ? 1 : 0,
          now,
          threadId,
          matchedGoalId,
          matchedRevision,
        );
      if (result.changes !== 1) {
        throw new Error("The Goal changed while it was being edited.");
      }
      services.database
        .prepare("UPDATE threads SET updated_at = ? WHERE id = ?")
        .run(now, threadId);
      services.database.exec("COMMIT");
    } catch (error) {
      services.database.exec("ROLLBACK");
      throw error;
    }
    return services.getThreadGoal(threadId)!;
  }

  function pauseThreadGoal(threadId: string): ThreadGoal {
    const goal = services.getThreadGoal(threadId);
    if (!goal) throw new Error("This task has no Goal.");
    if (goal.status === "paused") return goal;
    if (goal.status !== "active") {
      throw new Error(`A ${goal.status} Goal cannot be paused.`);
    }
    return services.mutateThreadGoal(
      threadId,
      { status: "paused" },
      goal.goalId,
      goal.revision,
    );
  }

  function resumeThreadGoal(threadId: string): ThreadGoal {
    const goal = services.getThreadGoal(threadId);
    if (!goal) throw new Error("This task has no Goal.");
    if (goal.status === "active") return goal;
    if (!["paused", "blocked", "usageLimited"].includes(goal.status)) {
      throw new Error(`A ${goal.status} Goal cannot be resumed.`);
    }
    return services.mutateThreadGoal(
      threadId,
      { status: "active" },
      goal.goalId,
      goal.revision,
      true,
    );
  }

  function clearThreadGoal(
    threadId: string,
    expectedGoalId?: string,
  ): { goalId: string; revision: number } | undefined {
    const goal = services.getThreadGoal(threadId);
    if (!goal) return undefined;
    if (expectedGoalId && goal.goalId !== expectedGoalId) {
      throw new Error("The Goal changed before it could be cleared.");
    }
    services.database.exec("BEGIN IMMEDIATE");
    try {
      services.database
        .prepare("DELETE FROM thread_goals WHERE thread_id = ? AND goal_id = ?")
        .run(threadId, goal.goalId);
      services.database
        .prepare("UPDATE threads SET updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), threadId);
      services.database.exec("COMMIT");
    } catch (error) {
      services.database.exec("ROLLBACK");
      throw error;
    }
    return { goalId: goal.goalId, revision: goal.revision + 1 };
  }

  function updateThreadGoalAccounting(
    threadId: string,
    goalId: string,
    tokens: number,
    seconds: number,
  ): ThreadGoal | undefined {
    const row = services.database
      .prepare("SELECT * FROM thread_goals WHERE thread_id = ? AND goal_id = ?")
      .get(threadId, goalId) as ThreadGoalRow | undefined;
    if (!row) return undefined;
    const tokensUsed = row.tokens_used + Math.max(0, Math.trunc(tokens));
    const now = new Date().toISOString();
    const timeUsedSeconds =
      row.time_used_seconds +
      activeGoalSeconds(threadGoalFromRow(row), now) +
      Math.max(0, seconds);
    const status =
      row.token_budget !== null &&
      tokensUsed >= row.token_budget &&
      !["complete", "budgetLimited"].includes(row.status)
        ? "budgetLimited"
        : row.status;
    services.database
      .prepare(
        `UPDATE thread_goals
         SET tokens_used = ?, time_used_seconds = ?, status = ?,
             revision = revision + 1, updated_at = ?
         WHERE thread_id = ? AND goal_id = ?`,
      )
      .run(tokensUsed, timeUsedSeconds, status, now, threadId, goalId);
    return services.getThreadGoal(threadId);
  }

  function completeThreadGoal(threadId: string, goalId: string): ThreadGoal {
    const goal = services.getThreadGoal(threadId);
    if (!goal || goal.goalId !== goalId) {
      throw new Error("The active Goal changed before completion.");
    }
    if (goal.status !== "active") {
      throw new Error(`A ${goal.status} Goal cannot be completed.`);
    }
    return services.updateThreadGoalStatus(threadId, goalId, "complete");
  }

  function recordThreadGoalBlocker(
    threadId: string,
    goalId: string,
    blocker: string,
  ): { goal: ThreadGoal; attempts: number } {
    const row = services.database
      .prepare("SELECT * FROM thread_goals WHERE thread_id = ? AND goal_id = ?")
      .get(threadId, goalId) as ThreadGoalRow | undefined;
    if (!row || row.status !== "active") {
      throw new Error("Only an active Goal can become blocked.");
    }
    const attempts = row.blocker === blocker ? row.blocker_turns + 1 : 1;
    const status: ThreadGoalStatus = attempts >= 3 ? "blocked" : "active";
    const now = new Date().toISOString();
    services.database
      .prepare(
        `UPDATE thread_goals
         SET blocker = ?, blocker_turns = ?, status = ?, time_used_seconds = ?,
             revision = revision + 1, updated_at = ?
         WHERE thread_id = ? AND goal_id = ?`,
      )
      .run(
        blocker,
        attempts,
        status,
        row.time_used_seconds + activeGoalSeconds(threadGoalFromRow(row), now),
        now,
        threadId,
        goalId,
      );
    return { goal: services.getThreadGoal(threadId)!, attempts };
  }

  function markThreadGoalUsageLimited(
    threadId: string,
    goalId: string,
  ): ThreadGoal {
    return services.updateThreadGoalStatus(threadId, goalId, "usageLimited");
  }

  function markThreadGoalBlocked(threadId: string, goalId: string): ThreadGoal {
    return services.updateThreadGoalStatus(threadId, goalId, "blocked");
  }

  function updateThreadGoalStatus(
    threadId: string,
    goalId: string,
    status: ThreadGoalStatus,
    resetBlocker = false,
  ): ThreadGoal {
    const goal = services.getThreadGoal(threadId);
    if (!goal || goal.goalId !== goalId) {
      throw new Error("The Goal changed before its status could be updated.");
    }
    const now = new Date().toISOString();
    const result = services.database
      .prepare(
        `UPDATE thread_goals
         SET status = ?, time_used_seconds = ?, revision = revision + 1,
             blocker = CASE WHEN ? THEN NULL ELSE blocker END,
             blocker_turns = CASE WHEN ? THEN 0 ELSE blocker_turns END,
             updated_at = ?
         WHERE thread_id = ? AND goal_id = ?`,
      )
      .run(
        status,
        goal.timeUsedSeconds + activeGoalSeconds(goal, now),
        resetBlocker ? 1 : 0,
        resetBlocker ? 1 : 0,
        now,
        threadId,
        goalId,
      );
    if (result.changes === 0) {
      throw new Error("The Goal changed before its status could be updated.");
    }
    return services.getThreadGoal(threadId)!;
  }
  const handlers = {
    getThreadGoal,
    setThreadGoal,
    updateThreadGoalObjective,
    mutateThreadGoal,
    pauseThreadGoal,
    resumeThreadGoal,
    clearThreadGoal,
    updateThreadGoalAccounting,
    completeThreadGoal,
    recordThreadGoalBlocker,
    markThreadGoalUsageLimited,
    markThreadGoalBlocked,
    updateThreadGoalStatus,
  };
  return handlers;
}

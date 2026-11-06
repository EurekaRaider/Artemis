import { threadFromRow } from "../store-row-codecs.js";

import { type ThreadRow } from "../store-types.js";

import { type ModelSelection, type Thread } from "@artemis/protocol";

import type { StoreDependencies } from "./store-dependencies.js";
export function createThreadRepository(
  services: Pick<
    StoreDependencies,
    "database" | "getThread" | "getThreadGoal" | "notifications"
  >,
) {
  function createThread(thread: Thread): Thread {
    services.database
      .prepare(
        `INSERT INTO threads (
          id, project_id, title, goal, mode, target, status, session_file,
          model_selection_json, context_window, pinned, archived,
          type_binding_json, execution_profile, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        thread.id,
        thread.projectId ?? null,
        thread.title,
        null,
        thread.mode,
        thread.target,
        thread.status,
        thread.sessionFile ?? null,
        thread.modelSelection ? JSON.stringify(thread.modelSelection) : null,
        thread.contextWindow ?? null,
        thread.pinned ? 1 : 0,
        thread.archived ? 1 : 0,
        thread.typeBinding ? JSON.stringify(thread.typeBinding) : null,
        null,
        thread.createdAt,
        thread.updatedAt,
      );
    if (thread.goal) {
      if (thread.goal.threadId !== thread.id) {
        throw new Error("Thread and Goal identity do not match.");
      }
      services.database
        .prepare(
          `INSERT INTO thread_goals (
            thread_id, goal_id, objective, status, token_budget, tokens_used,
            time_used_seconds, revision, blocker, blocker_turns, created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)`,
        )
        .run(
          thread.id,
          thread.goal.goalId,
          thread.goal.objective,
          thread.goal.status,
          thread.goal.tokenBudget ?? null,
          thread.goal.tokensUsed,
          thread.goal.timeUsedSeconds,
          thread.goal.revision,
          thread.goal.createdAt,
          thread.goal.updatedAt,
        );
    }
    return services.getThread(thread.id)!;
  }

  function getThread(id: string): Thread | undefined {
    const row = services.database
      .prepare("SELECT * FROM threads WHERE id = ?")
      .get(id) as ThreadRow | undefined;
    return row
      ? {
          ...threadFromRow(row, services.getThreadGoal(id)),
          notification: services.notifications.state(id),
        }
      : undefined;
  }

  function listThreads(): Thread[] {
    return (
      services.database
        .prepare(
          "SELECT * FROM threads ORDER BY archived ASC, pinned DESC, updated_at DESC",
        )
        .all() as unknown as ThreadRow[]
    ).map((row) => ({
      ...threadFromRow(row, services.getThreadGoal(row.id)),
      notification: services.notifications.state(row.id),
    }));
  }

  function deleteThread(threadId: string): void {
    const result = services.database
      .prepare("DELETE FROM threads WHERE id = ?")
      .run(threadId);
    if (result.changes === 0) {
      throw new Error(`Thread not found: ${threadId}`);
    }
  }

  function updateThread(
    id: string,
    changes: Partial<
      Pick<
        Thread,
        | "mode"
        | "status"
        | "sessionFile"
        | "title"
        | "pinned"
        | "archived"
        | "target"
      >
    > & {
      modelSelection?: ModelSelection | null;
      contextWindow?: number | null;
      /** Design-plugin binding: freezes the thread onto a plugin revision. */
      typeBinding?: Thread["typeBinding"];
    },
  ): Thread {
    const current = services.getThread(id);
    if (!current) {
      throw new Error(`Thread not found: ${id}`);
    }
    const typeBinding =
      changes.typeBinding === undefined
        ? current.typeBinding
        : changes.typeBinding;
    const modelSelection =
      changes.modelSelection === undefined
        ? current.modelSelection
        : changes.modelSelection;
    const contextWindow =
      changes.contextWindow === undefined
        ? (current.contextWindow ?? null)
        : changes.contextWindow;
    const updatedAt = new Date().toISOString();
    services.database
      .prepare(
        `UPDATE threads
         SET mode = ?, status = ?, session_file = ?, title = ?, goal = ?,
             pinned = ?, archived = ?, target = ?, model_selection_json = ?,
             context_window = ?, type_binding_json = ?, execution_profile = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(
        changes.mode ?? current.mode,
        changes.status ?? current.status,
        changes.sessionFile ?? current.sessionFile ?? null,
        changes.title ?? current.title,
        null,
        (changes.pinned ?? current.pinned) ? 1 : 0,
        (changes.archived ?? current.archived) ? 1 : 0,
        changes.target ?? current.target,
        modelSelection ? JSON.stringify(modelSelection) : null,
        contextWindow,
        typeBinding ? JSON.stringify(typeBinding) : null,
        null,
        updatedAt,
        id,
      );
    return services.getThread(id)!;
  }
  const handlers = {
    createThread,
    getThread,
    listThreads,
    deleteThread,
    updateThread,
  };
  return handlers;
}

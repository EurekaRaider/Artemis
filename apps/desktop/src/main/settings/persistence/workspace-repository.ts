import { agentEventFromBody, worktreeFromRow } from "../store-row-codecs.js";

import { type WorktreeRow } from "../store-types.js";
import { randomUUID } from "node:crypto";

import {
  type AgentEvent,
  type TaskWorktree,
  type Thread,
} from "@artemis/protocol";

import type { StoreDependencies } from "./store-dependencies.js";
export function createWorkspaceRepository(
  services: Pick<
    StoreDependencies,
    | "database"
    | "insertWorktree"
    | "getWorktree"
    | "createThread"
    | "getThread"
    | "attachWorktree"
    | "updateThread"
    | "updateWorktree"
    | "appendEvent"
    | "copyThreadEventsCore"
  >,
) {
  function insertWorktree(worktree: TaskWorktree): TaskWorktree {
    services.database
      .prepare(
        `INSERT INTO worktrees (
          id, thread_id, project_id, path, target, head, branch, status,
          recovery_path, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        worktree.id,
        worktree.threadId,
        worktree.projectId,
        worktree.path,
        worktree.target,
        worktree.head,
        worktree.branch ?? null,
        worktree.status,
        worktree.recoveryPath ?? null,
        worktree.createdAt,
        worktree.updatedAt,
      );
    return worktree;
  }

  function attachWorktree(worktree: TaskWorktree): TaskWorktree {
    const existingRow = services.database
      .prepare("SELECT * FROM worktrees WHERE path = ?")
      .get(worktree.path) as WorktreeRow | undefined;
    if (!existingRow) {
      return services.insertWorktree(worktree);
    }
    const existing = worktreeFromRow(existingRow);
    if (
      existing.threadId !== worktree.threadId ||
      existing.projectId !== worktree.projectId ||
      existing.target !== worktree.target
    ) {
      throw new Error(
        `Worktree path is already assigned to another task: ${worktree.path}`,
      );
    }
    if (existing.status === "active") {
      throw new Error(`Worktree path is already active: ${worktree.path}`);
    }
    services.database
      .prepare(
        `UPDATE worktrees
         SET head = ?, branch = ?, status = ?, recovery_path = ?,
             target = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        worktree.head,
        worktree.branch ?? null,
        worktree.status,
        worktree.recoveryPath ?? null,
        worktree.target,
        worktree.updatedAt,
        existing.id,
      );
    return services.getWorktree(existing.id)!;
  }

  function createThreadWithWorktree(
    thread: Thread,
    worktree: TaskWorktree,
  ): { thread: Thread; worktree: TaskWorktree } {
    if (
      thread.id !== worktree.threadId ||
      thread.projectId !== worktree.projectId ||
      thread.target !== worktree.target
    ) {
      throw new Error("Thread and worktree identity do not match.");
    }
    services.database.exec("BEGIN IMMEDIATE");
    try {
      const createdThread = services.createThread(thread);
      const createdWorktree = services.insertWorktree(worktree);
      services.database.exec("COMMIT");
      return { thread: createdThread, worktree: createdWorktree };
    } catch (error) {
      services.database.exec("ROLLBACK");
      throw error;
    }
  }

  function getWorktreeForThread(threadId: string): TaskWorktree | undefined {
    const row = services.database
      .prepare(
        `SELECT * FROM worktrees
         WHERE thread_id = ?
         ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END,
                  updated_at DESC
         LIMIT 1`,
      )
      .get(threadId) as WorktreeRow | undefined;
    return row ? worktreeFromRow(row) : undefined;
  }

  function getWorktree(id: string): TaskWorktree | undefined {
    const row = services.database
      .prepare("SELECT * FROM worktrees WHERE id = ?")
      .get(id) as WorktreeRow | undefined;
    return row ? worktreeFromRow(row) : undefined;
  }

  function listWorktrees(): TaskWorktree[] {
    return (
      services.database
        .prepare("SELECT * FROM worktrees ORDER BY updated_at DESC")
        .all() as unknown as WorktreeRow[]
    ).map(worktreeFromRow);
  }

  function updateWorktree(
    id: string,
    changes: Partial<
      Pick<
        TaskWorktree,
        "head" | "branch" | "status" | "recoveryPath" | "target"
      >
    >,
  ): TaskWorktree {
    const current = services.getWorktree(id);
    if (!current) {
      throw new Error(`Worktree not found: ${id}`);
    }
    services.database
      .prepare(
        `UPDATE worktrees
         SET head = ?, branch = ?, status = ?, recovery_path = ?,
             target = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        changes.head ?? current.head,
        changes.branch ?? current.branch ?? null,
        changes.status ?? current.status,
        changes.recoveryPath ?? current.recoveryPath ?? null,
        changes.target ?? current.target,
        new Date().toISOString(),
        id,
      );
    return services.getWorktree(id)!;
  }

  function clearWorktreeRecovery(id: string): TaskWorktree {
    if (!services.getWorktree(id)) {
      throw new Error(`Worktree not found: ${id}`);
    }
    services.database
      .prepare(
        `UPDATE worktrees
         SET recovery_path = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .run(new Date().toISOString(), id);
    return services.getWorktree(id)!;
  }

  function attachWorktreeToThread(
    threadId: string,
    worktree: TaskWorktree,
  ): { thread: Thread; worktree: TaskWorktree } {
    const thread = services.getThread(threadId);
    if (
      !thread ||
      thread.id !== worktree.threadId ||
      thread.projectId !== worktree.projectId
    ) {
      throw new Error("Thread and worktree identity do not match.");
    }
    services.database.exec("BEGIN IMMEDIATE");
    try {
      const createdWorktree = services.attachWorktree(worktree);
      const updatedThread = services.updateThread(thread.id, {
        target: worktree.target,
      });
      services.database.exec("COMMIT");
      return { thread: updatedThread, worktree: createdWorktree };
    } catch (error) {
      services.database.exec("ROLLBACK");
      throw error;
    }
  }

  function completeWorktreeCleanup(
    threadId: string,
    worktreeId: string,
    recoveryPath?: string,
  ): { thread: Thread; worktree: TaskWorktree } {
    services.database.exec("BEGIN IMMEDIATE");
    try {
      const worktree = services.updateWorktree(worktreeId, {
        status: "removed",
        ...(recoveryPath ? { recoveryPath } : {}),
      });
      const thread = services.updateThread(threadId, { target: "local" });
      services.database.exec("COMMIT");
      return { thread, worktree };
    } catch (error) {
      services.database.exec("ROLLBACK");
      throw error;
    }
  }

  function copyThreadEventsCore(
    sourceThreadId: string,
    targetThreadId: string,
  ): AgentEvent[] {
    const rows = services.database
      .prepare("SELECT body FROM events WHERE thread_id = ? ORDER BY seq ASC")
      .all(sourceThreadId) as unknown as Array<{ body: string }>;
    const copied: AgentEvent[] = [];
    for (const row of rows) {
      const source = agentEventFromBody(row.body);
      if (source.payload.type === "assistant.usage") {
        continue;
      }
      copied.push(
        services.appendEvent(
          randomUUID(),
          targetThreadId,
          source.turnId,
          source.payload,
        ),
      );
    }
    return copied;
  }

  function copyThreadEvents(
    sourceThreadId: string,
    targetThreadId: string,
  ): AgentEvent[] {
    services.database.exec("BEGIN IMMEDIATE");
    try {
      const copied = services.copyThreadEventsCore(
        sourceThreadId,
        targetThreadId,
      );
      services.database.exec("COMMIT");
      return copied;
    } catch (error) {
      services.database.exec("ROLLBACK");
      throw error;
    }
  }

  function createForkedThread(
    thread: Thread,
    sourceThreadId: string,
  ): { thread: Thread; events: AgentEvent[] } {
    services.database.exec("BEGIN IMMEDIATE");
    try {
      const created = services.createThread(thread);
      const events = services.copyThreadEventsCore(sourceThreadId, thread.id);
      services.database.exec("COMMIT");
      return { thread: created, events };
    } catch (error) {
      services.database.exec("ROLLBACK");
      throw error;
    }
  }

  function createForkedThreadWithWorktree(
    thread: Thread,
    worktree: TaskWorktree,
    sourceThreadId: string,
  ): { thread: Thread; worktree: TaskWorktree; events: AgentEvent[] } {
    if (
      thread.id !== worktree.threadId ||
      thread.projectId !== worktree.projectId ||
      thread.target !== worktree.target
    ) {
      throw new Error("Thread and worktree identity do not match.");
    }
    services.database.exec("BEGIN IMMEDIATE");
    try {
      const created = services.createThread(thread);
      const createdWorktree = services.insertWorktree(worktree);
      const events = services.copyThreadEventsCore(sourceThreadId, thread.id);
      services.database.exec("COMMIT");
      return { thread: created, worktree: createdWorktree, events };
    } catch (error) {
      services.database.exec("ROLLBACK");
      throw error;
    }
  }
  const handlers = {
    insertWorktree,
    attachWorktree,
    createThreadWithWorktree,
    getWorktreeForThread,
    getWorktree,
    listWorktrees,
    updateWorktree,
    clearWorktreeRecovery,
    attachWorktreeToThread,
    completeWorktreeCleanup,
    copyThreadEventsCore,
    copyThreadEvents,
    createForkedThread,
    createForkedThreadWithWorktree,
  };
  return handlers;
}

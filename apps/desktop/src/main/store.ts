import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import {
  PROTOCOL_VERSION,
  agentEventSchema,
  automationRunSchema,
  automationSchema,
  isLegacyInternalAgentMessage,
  modelSelectionSchema,
  reduceAgentEvents,
  type AgentEvent,
  type AgentPayload,
  type AppSnapshot,
  type ApprovalScope,
  type Automation,
  type AutomationRun,
  type AutomationRunState,
  type AutomationRunTrigger,
  type AutomationTarget,
  type ModelSelection,
  type MultiQuestionUserInputState,
  type Project,
  type RunMode,
  type TaskWorktree,
  type Thread,
  type ThreadGoal,
  type ThreadGoalStatus,
  type TurnChangeFile,
  type WorkspaceTarget,
} from "@artemis/protocol";

import type { ReviewComment, ReviewCommentAnchor } from "../shared/api.js";

interface ProjectRow {
  id: string;
  name: string;
  path: string;
  created_at: string;
  updated_at: string;
}

interface ThreadRow {
  id: string;
  project_id: string | null;
  title: string;
  goal: string | null;
  mode: RunMode;
  target: WorkspaceTarget;
  status: Thread["status"];
  session_file: string | null;
  model_selection_json: string | null;
  context_window: number | null;
  pinned: number;
  archived: number;
  created_at: string;
  updated_at: string;
}

interface ThreadGoalRow {
  thread_id: string;
  goal_id: string;
  objective: string;
  status: ThreadGoalStatus;
  token_budget: number | null;
  tokens_used: number;
  time_used_seconds: number;
  revision: number;
  blocker: string | null;
  blocker_turns: number;
  created_at: string;
  updated_at: string;
}

interface WorktreeRow {
  id: string;
  thread_id: string;
  project_id: string;
  path: string;
  target: TaskWorktree["target"];
  head: string;
  branch: string | null;
  status: TaskWorktree["status"];
  recovery_path: string | null;
  created_at: string;
  updated_at: string;
}

interface ReviewCommentRow {
  id: string;
  thread_id: string;
  scope: ReviewComment["scope"];
  line_id: string;
  path: string;
  kind: ReviewComment["kind"];
  line_text: string;
  old_line: number | null;
  new_line: number | null;
  body: string;
  created_at: string;
  updated_at: string;
}

interface AutomationRow {
  id: string;
  project_id: string;
  name: string;
  prompt: string;
  mode: RunMode;
  target: AutomationTarget;
  schedule_json: string;
  enabled: number;
  authorization_state: Automation["authorizationState"];
  authorization_fingerprint: string | null;
  authorized_at: string | null;
  next_run_at: string | null;
  last_run_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

interface AutomationRunRow {
  id: string;
  automation_id: string;
  scheduled_for: string;
  trigger: AutomationRunTrigger;
  state: AutomationRunState;
  thread_id: string | null;
  reason: string | null;
  created_at: string;
  updated_at: string;
}

interface TurnChangeSetRow {
  thread_id: string;
  turn_id: string;
  status: TurnChangeSetRecord["status"];
  files_json: string;
  additions: number;
  deletions: number;
  undo_available: number;
  message: string | null;
  diff_text: string;
  snapshot_path: string | null;
  workspace_path: string;
  start_head: string;
  start_index: string;
  end_head: string;
  end_index: string;
  created_at: string;
  updated_at: string;
}

export interface TurnChangeSetRecord {
  threadId: string;
  turnId: string;
  status: "ready" | "undone" | "unavailable";
  files: TurnChangeFile[];
  additions: number;
  deletions: number;
  undoAvailable: boolean;
  message?: string;
  diffText: string;
  snapshotPath?: string;
  workspacePath: string;
  startHead: string;
  startIndex: string;
  endHead: string;
  endIndex: string;
  createdAt: string;
  updatedAt: string;
}

const THREAD_SESSION_DATABASE_VERSION = 10;
const THREAD_GOAL_DATABASE_VERSION = 11;
const DATABASE_VERSION = 12;
const EVENT_PROTOCOL_DATABASE_VERSION = 9;

export interface EventAppendInput {
  eventId: string;
  turnId?: string;
  payload: AgentPayload;
  // Optional stamp override for callers that must pin an event to a frozen
  // deadline (multi-question expiry clamping); defaults to append time.
  timestamp?: string;
}

export interface ApprovalGrant {
  scope: Exclude<ApprovalScope, "once">;
  subjectId: string;
  operation: string;
  fingerprint: string;
  createdAt: string;
}

export interface ApprovalGrantQuery {
  threadId: string;
  projectId: string;
  operation: string;
  fingerprint: string;
}

function projectFromRow(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function threadGoalFromRow(row: ThreadGoalRow): ThreadGoal {
  return {
    threadId: row.thread_id,
    goalId: row.goal_id,
    objective: row.objective,
    status: row.status,
    ...(row.token_budget ? { tokenBudget: row.token_budget } : {}),
    tokensUsed: row.tokens_used,
    timeUsedSeconds: row.time_used_seconds,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function turnChangeSetFromRow(row: TurnChangeSetRow): TurnChangeSetRecord {
  return {
    threadId: row.thread_id,
    turnId: row.turn_id,
    status: row.status,
    files: JSON.parse(row.files_json) as TurnChangeFile[],
    additions: row.additions,
    deletions: row.deletions,
    undoAvailable: Boolean(row.undo_available),
    ...(row.message ? { message: row.message } : {}),
    diffText: row.diff_text,
    ...(row.snapshot_path ? { snapshotPath: row.snapshot_path } : {}),
    workspacePath: row.workspace_path,
    startHead: row.start_head,
    startIndex: row.start_index,
    endHead: row.end_head,
    endIndex: row.end_index,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function agentEventFromBody(body: string): AgentEvent {
  const persisted = JSON.parse(body) as Record<string, unknown>;
  return agentEventSchema.parse({
    ...persisted,
    protocolVersion: PROTOCOL_VERSION,
  });
}

function threadFromRow(row: ThreadRow, goal?: ThreadGoal): Thread {
  return {
    id: row.id,
    ...(row.project_id ? { projectId: row.project_id } : {}),
    title: row.title,
    ...(goal ? { goal } : {}),
    mode: row.mode,
    target: row.target,
    status: row.status,
    ...(row.session_file ? { sessionFile: row.session_file } : {}),
    ...(row.model_selection_json
      ? {
          modelSelection: modelSelectionSchema.parse(
            JSON.parse(row.model_selection_json),
          ),
        }
      : {}),
    ...(row.context_window ? { contextWindow: row.context_window } : {}),
    pinned: row.pinned === 1,
    archived: row.archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function worktreeFromRow(row: WorktreeRow): TaskWorktree {
  return {
    id: row.id,
    threadId: row.thread_id,
    projectId: row.project_id,
    path: row.path,
    target: row.target,
    head: row.head,
    ...(row.branch ? { branch: row.branch } : {}),
    status: row.status,
    ...(row.recovery_path ? { recoveryPath: row.recovery_path } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function reviewCommentFromRow(row: ReviewCommentRow): ReviewComment {
  return {
    id: row.id,
    threadId: row.thread_id,
    scope: row.scope,
    lineId: row.line_id,
    path: row.path,
    kind: row.kind,
    text: row.line_text,
    ...(row.old_line === null ? {} : { oldLine: row.old_line }),
    ...(row.new_line === null ? {} : { newLine: row.new_line }),
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function automationFromRow(row: AutomationRow): Automation {
  return automationSchema.parse({
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    prompt: row.prompt,
    mode: row.mode,
    target: row.target,
    schedule: JSON.parse(row.schedule_json),
    enabled: row.enabled === 1,
    authorizationState: row.authorization_state,
    ...(row.authorization_fingerprint
      ? { authorizationFingerprint: row.authorization_fingerprint }
      : {}),
    ...(row.authorized_at ? { authorizedAt: row.authorized_at } : {}),
    ...(row.next_run_at ? { nextRunAt: row.next_run_at } : {}),
    ...(row.last_run_at ? { lastRunAt: row.last_run_at } : {}),
    ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function automationRunFromRow(row: AutomationRunRow): AutomationRun {
  return automationRunSchema.parse({
    id: row.id,
    automationId: row.automation_id,
    scheduledFor: row.scheduled_for,
    trigger: row.trigger,
    state: row.state,
    ...(row.thread_id ? { threadId: row.thread_id } : {}),
    ...(row.reason ? { reason: row.reason } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function persistentAgentPayload(payload: AgentPayload): AgentPayload {
  if (
    payload.type === "message.part.delta" &&
    payload.partType === "thinking" &&
    payload.delta
  ) {
    return { ...payload, delta: "" };
  }
  if (payload.type === "child-agent.status" && payload.activityDelta) {
    return { ...payload, activityDelta: undefined };
  }
  return payload;
}

export class AppStore {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        hidden INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        goal TEXT,
        mode TEXT NOT NULL,
        target TEXT NOT NULL,
        status TEXT NOT NULL,
        session_file TEXT,
        model_selection_json TEXT,
        context_window INTEGER,
        pinned INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS thread_goals (
        thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
        goal_id TEXT NOT NULL UNIQUE,
        objective TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN (
          'active', 'paused', 'blocked', 'usageLimited',
          'budgetLimited', 'complete'
        )),
        token_budget INTEGER,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        time_used_seconds REAL NOT NULL DEFAULT 0,
        revision INTEGER NOT NULL DEFAULT 1,
        blocker TEXT,
        blocker_turns INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        event_id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(thread_id, seq)
      );

      CREATE INDEX IF NOT EXISTS ix_threads_project
        ON threads(project_id, archived, updated_at DESC);
      CREATE INDEX IF NOT EXISTS ix_events_thread
        ON events(thread_id, seq);

      CREATE TABLE IF NOT EXISTS turn_change_sets (
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        turn_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('ready', 'undone', 'unavailable')),
        files_json TEXT NOT NULL,
        additions INTEGER NOT NULL,
        deletions INTEGER NOT NULL,
        undo_available INTEGER NOT NULL DEFAULT 0,
        message TEXT,
        diff_text TEXT NOT NULL,
        snapshot_path TEXT,
        workspace_path TEXT NOT NULL,
        start_head TEXT NOT NULL,
        start_index TEXT NOT NULL,
        end_head TEXT NOT NULL,
        end_index TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(thread_id, turn_id)
      );

      CREATE INDEX IF NOT EXISTS ix_turn_change_sets_thread
        ON turn_change_sets(thread_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS approval_grants (
        scope TEXT NOT NULL CHECK(scope IN ('session', 'project')),
        subject_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(scope, subject_id, operation, fingerprint)
      );

      CREATE INDEX IF NOT EXISTS ix_approval_grants_lookup
        ON approval_grants(operation, fingerprint, scope, subject_id);

      CREATE TABLE IF NOT EXISTS worktrees (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL
          REFERENCES threads(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL
          REFERENCES projects(id) ON DELETE CASCADE,
        path TEXT NOT NULL UNIQUE,
        target TEXT NOT NULL
          CHECK(target IN ('managed-worktree', 'permanent-worktree')),
        head TEXT NOT NULL,
        branch TEXT,
        status TEXT NOT NULL
          CHECK(status IN ('active', 'removed', 'missing')),
        recovery_path TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS ix_worktrees_project
        ON worktrees(project_id, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS ix_worktrees_thread
        ON worktrees(thread_id, status, updated_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS ix_worktrees_one_active_per_thread
        ON worktrees(thread_id) WHERE status = 'active';

      CREATE TABLE IF NOT EXISTS review_comments (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        scope TEXT NOT NULL
          CHECK(scope IN ('last-turn', 'unstaged', 'staged', 'branch')),
        line_id TEXT NOT NULL,
        path TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('context', 'addition', 'deletion')),
        line_text TEXT NOT NULL,
        old_line INTEGER,
        new_line INTEGER,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS ix_review_comments_thread
        ON review_comments(thread_id, created_at);

      CREATE TABLE IF NOT EXISTS automations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        prompt TEXT NOT NULL,
        mode TEXT NOT NULL CHECK(mode IN ('execute', 'plan', 'review')),
        target TEXT NOT NULL CHECK(target IN ('local', 'managed-worktree')),
        schedule_json TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        authorization_state TEXT NOT NULL
          CHECK(authorization_state IN ('not-required', 'required', 'authorized')),
        authorization_fingerprint TEXT,
        authorized_at TEXT,
        next_run_at TEXT,
        last_run_at TEXT,
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS ix_automations_due
        ON automations(enabled, deleted_at, next_run_at);
      CREATE INDEX IF NOT EXISTS ix_automations_project
        ON automations(project_id, deleted_at, updated_at DESC);

      CREATE TABLE IF NOT EXISTS automation_runs (
        id TEXT PRIMARY KEY,
        automation_id TEXT NOT NULL
          REFERENCES automations(id) ON DELETE CASCADE,
        scheduled_for TEXT NOT NULL,
        trigger TEXT NOT NULL
          CHECK(trigger IN ('schedule', 'catch-up', 'manual')),
        state TEXT NOT NULL
          CHECK(state IN (
            'starting', 'running', 'waiting-approval',
            'completed', 'failed', 'skipped'
          )),
        thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,
        reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(automation_id, scheduled_for)
      );

      CREATE INDEX IF NOT EXISTS ix_automation_runs_automation
        ON automation_runs(automation_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS ix_automation_runs_thread
        ON automation_runs(thread_id);

    `);
    const projectColumns = this.database
      .prepare("PRAGMA table_info(projects)")
      .all() as unknown as Array<{ name: string }>;
    if (!projectColumns.some((column) => column.name === "hidden")) {
      this.database.exec(
        "ALTER TABLE projects ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0",
      );
    }
    const threadColumns = this.database
      .prepare("PRAGMA table_info(threads)")
      .all() as unknown as Array<{ name: string }>;
    if (!threadColumns.some((column) => column.name === "goal")) {
      this.database.exec("ALTER TABLE threads ADD COLUMN goal TEXT");
    }
    const databaseVersion = this.database
      .prepare("PRAGMA user_version")
      .get() as {
      user_version: number;
    };
    if (databaseVersion.user_version < 8) {
      this.migrateRunModes();
    }
    const migratedVersion = this.database
      .prepare("PRAGMA user_version")
      .get() as { user_version: number };
    if (migratedVersion.user_version < EVENT_PROTOCOL_DATABASE_VERSION) {
      this.advanceDatabaseVersion(EVENT_PROTOCOL_DATABASE_VERSION);
    }
    const eventMigratedVersion = this.database
      .prepare("PRAGMA user_version")
      .get() as { user_version: number };
    if (eventMigratedVersion.user_version < THREAD_SESSION_DATABASE_VERSION) {
      this.migrateThreadSessions();
    }
    const sessionMigratedVersion = this.database
      .prepare("PRAGMA user_version")
      .get() as { user_version: number };
    if (sessionMigratedVersion.user_version < THREAD_GOAL_DATABASE_VERSION) {
      this.migrateThreadGoals();
    }
    const goalMigratedVersion = this.database
      .prepare("PRAGMA user_version")
      .get() as { user_version: number };
    if (goalMigratedVersion.user_version < DATABASE_VERSION) {
      this.advanceDatabaseVersion(DATABASE_VERSION);
    }
  }

  private migrateRunModes(): void {
    this.database.exec("PRAGMA foreign_keys = OFF");
    try {
      this.database.exec(`
        BEGIN IMMEDIATE;

        CREATE TABLE automations_mode_v8 (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          prompt TEXT NOT NULL,
          mode TEXT NOT NULL CHECK(mode IN ('execute', 'plan', 'review')),
          target TEXT NOT NULL CHECK(target IN ('local', 'managed-worktree')),
          schedule_json TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 0,
          authorization_state TEXT NOT NULL
            CHECK(authorization_state IN ('not-required', 'required', 'authorized')),
          authorization_fingerprint TEXT,
          authorized_at TEXT,
          next_run_at TEXT,
          last_run_at TEXT,
          deleted_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        INSERT INTO automations_mode_v8 (
          id, project_id, name, prompt, mode, target, schedule_json, enabled,
          authorization_state, authorization_fingerprint, authorized_at,
          next_run_at, last_run_at, deleted_at, created_at, updated_at
        )
        SELECT
          id,
          project_id,
          name,
          prompt,
          CASE WHEN mode IN ('code', 'work') THEN 'execute' ELSE mode END,
          target,
          schedule_json,
          CASE WHEN mode IN ('code', 'work') THEN 0 ELSE enabled END,
          CASE
            WHEN mode IN ('code', 'work') THEN 'required'
            ELSE authorization_state
          END,
          CASE
            WHEN mode IN ('code', 'work') THEN NULL
            ELSE authorization_fingerprint
          END,
          CASE WHEN mode IN ('code', 'work') THEN NULL ELSE authorized_at END,
          CASE WHEN mode IN ('code', 'work') THEN NULL ELSE next_run_at END,
          last_run_at,
          deleted_at,
          created_at,
          updated_at
        FROM automations;

        DROP TABLE automations;
        ALTER TABLE automations_mode_v8 RENAME TO automations;
        CREATE INDEX ix_automations_due
          ON automations(enabled, deleted_at, next_run_at);
        CREATE INDEX ix_automations_project
          ON automations(project_id, deleted_at, updated_at DESC);

        UPDATE threads
        SET mode = 'execute'
        WHERE mode IN ('code', 'work');

        UPDATE events
        SET body = json_set(body, '$.payload.mode', 'execute')
        WHERE json_extract(body, '$.payload.type') = 'turn.started'
          AND json_extract(body, '$.payload.mode') IN ('code', 'work');

        PRAGMA user_version = 8;
        COMMIT;
      `);
    } catch (error) {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // The migration failed before opening its transaction.
      }
      throw error;
    } finally {
      this.database.exec("PRAGMA foreign_keys = ON");
    }

    const violations = this.database
      .prepare("PRAGMA foreign_key_check")
      .all() as unknown[];
    if (violations.length > 0) {
      throw new Error("Run mode migration produced invalid references.");
    }
  }

  private advanceDatabaseVersion(databaseVersion: number): void {
    try {
      this.database.exec(`
        BEGIN IMMEDIATE;
        PRAGMA user_version = ${databaseVersion};
        COMMIT;
      `);
    } catch (error) {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // The migration failed before opening its transaction.
      }
      throw error;
    }
  }

  private migrateThreadSessions(): void {
    const columns = this.database
      .prepare("PRAGMA table_info(threads)")
      .all() as unknown as Array<{ name: string; notnull: number }>;
    const projectId = columns.find((column) => column.name === "project_id");
    if (
      projectId?.notnull === 0 &&
      columns.some((column) => column.name === "model_selection_json") &&
      columns.some((column) => column.name === "context_window")
    ) {
      this.database.exec(
        `PRAGMA user_version = ${THREAD_SESSION_DATABASE_VERSION}`,
      );
      return;
    }

    this.database.exec("PRAGMA foreign_keys = OFF");
    try {
      this.database.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE threads_session_v10 (
          id TEXT PRIMARY KEY,
          project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          goal TEXT,
          mode TEXT NOT NULL,
          target TEXT NOT NULL,
          status TEXT NOT NULL,
          session_file TEXT,
          model_selection_json TEXT,
          context_window INTEGER,
          pinned INTEGER NOT NULL DEFAULT 0,
          archived INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO threads_session_v10 (
          id, project_id, title, goal, mode, target, status, session_file,
          model_selection_json, context_window, pinned, archived, created_at,
          updated_at
        )
        SELECT
          id, project_id, title, goal, mode, target, status, session_file,
          NULL, NULL, pinned, archived, created_at, updated_at
        FROM threads;
        DROP TABLE threads;
        ALTER TABLE threads_session_v10 RENAME TO threads;
        CREATE INDEX ix_threads_project
          ON threads(project_id, archived, updated_at DESC);
        PRAGMA user_version = ${THREAD_SESSION_DATABASE_VERSION};
        COMMIT;
      `);
    } catch (error) {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // The migration failed before opening its transaction.
      }
      throw error;
    } finally {
      this.database.exec("PRAGMA foreign_keys = ON");
    }
    const violations = this.database
      .prepare("PRAGMA foreign_key_check")
      .all() as unknown[];
    if (violations.length > 0) {
      throw new Error("Thread session migration produced invalid references.");
    }
  }

  private migrateThreadGoals(): void {
    try {
      this.database.exec(`
        BEGIN IMMEDIATE;
        INSERT OR IGNORE INTO thread_goals (
          thread_id, goal_id, objective, status, token_budget, tokens_used,
          time_used_seconds, revision, blocker, blocker_turns, created_at,
          updated_at
        )
        SELECT
          id, lower(hex(randomblob(16))), trim(goal), 'active', NULL, 0,
          0, 1, NULL, 0, created_at, updated_at
        FROM threads
        WHERE goal IS NOT NULL AND length(trim(goal)) > 0;
        UPDATE threads SET goal = NULL WHERE goal IS NOT NULL;
        PRAGMA user_version = ${THREAD_GOAL_DATABASE_VERSION};
        COMMIT;
      `);
    } catch (error) {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // The migration failed before opening its transaction.
      }
      throw error;
    }
  }

  upsertProject(project: Project): Project {
    this.database
      .prepare(
        `INSERT INTO projects (id, name, path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           name = excluded.name,
           updated_at = excluded.updated_at,
           hidden = 0`,
      )
      .run(
        project.id,
        project.name,
        project.path,
        project.createdAt,
        project.updatedAt,
      );

    return this.getProjectByPath(project.path) ?? project;
  }

  removeProject(id: string): void {
    if (!this.getProject(id)) {
      throw new Error(`Project not found: ${id}`);
    }
    const activeThread = this.database
      .prepare(
        `SELECT 1 FROM threads
         WHERE project_id = ? AND status IN ('running', 'waiting-approval')
         LIMIT 1`,
      )
      .get(id);
    if (activeThread) {
      throw new Error("Stop active tasks before removing this project.");
    }
    this.database
      .prepare("UPDATE projects SET hidden = 1, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
    this.database
      .prepare(
        `UPDATE automations
         SET enabled = 0, next_run_at = NULL, updated_at = ?
         WHERE project_id = ? AND deleted_at IS NULL`,
      )
      .run(new Date().toISOString(), id);
  }

  getProject(id: string): Project | undefined {
    const row = this.database
      .prepare("SELECT * FROM projects WHERE id = ?")
      .get(id) as ProjectRow | undefined;
    return row ? projectFromRow(row) : undefined;
  }

  getProjectByPath(path: string): Project | undefined {
    const row = this.database
      .prepare("SELECT * FROM projects WHERE path = ?")
      .get(path) as ProjectRow | undefined;
    return row ? projectFromRow(row) : undefined;
  }

  createThread(thread: Thread): Thread {
    this.database
      .prepare(
        `INSERT INTO threads (
          id, project_id, title, goal, mode, target, status, session_file,
          model_selection_json, context_window, pinned, archived, created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        thread.createdAt,
        thread.updatedAt,
      );
    if (thread.goal) {
      if (thread.goal.threadId !== thread.id) {
        throw new Error("Thread and Goal identity do not match.");
      }
      this.database
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
    return this.getThread(thread.id)!;
  }

  private insertWorktree(worktree: TaskWorktree): TaskWorktree {
    this.database
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

  private attachWorktree(worktree: TaskWorktree): TaskWorktree {
    const existingRow = this.database
      .prepare("SELECT * FROM worktrees WHERE path = ?")
      .get(worktree.path) as WorktreeRow | undefined;
    if (!existingRow) {
      return this.insertWorktree(worktree);
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
    this.database
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
    return this.getWorktree(existing.id)!;
  }

  createThreadWithWorktree(
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
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const createdThread = this.createThread(thread);
      const createdWorktree = this.insertWorktree(worktree);
      this.database.exec("COMMIT");
      return { thread: createdThread, worktree: createdWorktree };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  getThread(id: string): Thread | undefined {
    const row = this.database
      .prepare("SELECT * FROM threads WHERE id = ?")
      .get(id) as ThreadRow | undefined;
    return row ? threadFromRow(row, this.getThreadGoal(id)) : undefined;
  }

  getThreadGoal(threadId: string): ThreadGoal | undefined {
    const row = this.database
      .prepare("SELECT * FROM thread_goals WHERE thread_id = ?")
      .get(threadId) as ThreadGoalRow | undefined;
    return row ? threadGoalFromRow(row) : undefined;
  }

  listThreads(): Thread[] {
    return (
      this.database
        .prepare(
          "SELECT * FROM threads ORDER BY archived ASC, pinned DESC, updated_at DESC",
        )
        .all() as unknown as ThreadRow[]
    ).map((row) => threadFromRow(row, this.getThreadGoal(row.id)));
  }

  deleteThread(threadId: string): void {
    const result = this.database
      .prepare("DELETE FROM threads WHERE id = ?")
      .run(threadId);
    if (result.changes === 0) {
      throw new Error(`Thread not found: ${threadId}`);
    }
  }

  updateThread(
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
    },
  ): Thread {
    const current = this.getThread(id);
    if (!current) {
      throw new Error(`Thread not found: ${id}`);
    }
    const modelSelection =
      changes.modelSelection === undefined
        ? current.modelSelection
        : changes.modelSelection;
    const contextWindow =
      changes.contextWindow === undefined
        ? (current.contextWindow ?? null)
        : changes.contextWindow;
    const updatedAt = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE threads
         SET mode = ?, status = ?, session_file = ?, title = ?, goal = ?,
             pinned = ?, archived = ?, target = ?, model_selection_json = ?,
             context_window = ?, updated_at = ?
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
        updatedAt,
        id,
      );
    return this.getThread(id)!;
  }

  setThreadGoal(
    threadId: string,
    objective: string,
    tokenBudget: number | undefined,
    status: ThreadGoalStatus = "active",
  ): ThreadGoal {
    if (!this.getThread(threadId)) {
      throw new Error(`Thread not found: ${threadId}`);
    }
    const normalizedObjective = objective.trim();
    if (!normalizedObjective)
      throw new Error("Goal objective cannot be empty.");
    const existing = this.getThreadGoal(threadId);
    if (existing) throw new Error("This task already has a Goal.");
    const now = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
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
      this.database
        .prepare("UPDATE threads SET updated_at = ? WHERE id = ?")
        .run(now, threadId);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.getThreadGoal(threadId)!;
  }

  updateThreadGoalObjective(
    threadId: string,
    objective: string,
    expectedGoalId: string,
    expectedRevision: number,
  ): ThreadGoal {
    return this.mutateThreadGoal(
      threadId,
      { objective },
      expectedGoalId,
      expectedRevision,
    );
  }

  mutateThreadGoal(
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
    const goal = this.getThreadGoal(threadId);
    if (!goal) {
      if (expectedGoalId !== undefined || expectedRevision !== undefined) {
        throw new Error("The Goal changed while it was being edited.");
      }
      const objective = changes.objective?.trim();
      if (!objective) throw new Error("A new Goal requires an objective.");
      return this.setThreadGoal(
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
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = this.database
        .prepare(
          `UPDATE thread_goals
           SET objective = ?, status = ?, token_budget = ?,
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
      this.database
        .prepare("UPDATE threads SET updated_at = ? WHERE id = ?")
        .run(now, threadId);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.getThreadGoal(threadId)!;
  }

  pauseThreadGoal(threadId: string): ThreadGoal {
    const goal = this.getThreadGoal(threadId);
    if (!goal) throw new Error("This task has no Goal.");
    if (goal.status === "paused") return goal;
    if (goal.status !== "active") {
      throw new Error(`A ${goal.status} Goal cannot be paused.`);
    }
    return this.mutateThreadGoal(
      threadId,
      { status: "paused" },
      goal.goalId,
      goal.revision,
    );
  }

  resumeThreadGoal(threadId: string): ThreadGoal {
    const goal = this.getThreadGoal(threadId);
    if (!goal) throw new Error("This task has no Goal.");
    if (goal.status === "active") return goal;
    if (!["paused", "blocked", "usageLimited"].includes(goal.status)) {
      throw new Error(`A ${goal.status} Goal cannot be resumed.`);
    }
    return this.mutateThreadGoal(
      threadId,
      { status: "active" },
      goal.goalId,
      goal.revision,
      true,
    );
  }

  clearThreadGoal(
    threadId: string,
    expectedGoalId?: string,
  ): { goalId: string; revision: number } | undefined {
    const goal = this.getThreadGoal(threadId);
    if (!goal) return undefined;
    if (expectedGoalId && goal.goalId !== expectedGoalId) {
      throw new Error("The Goal changed before it could be cleared.");
    }
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare("DELETE FROM thread_goals WHERE thread_id = ? AND goal_id = ?")
        .run(threadId, goal.goalId);
      this.database
        .prepare("UPDATE threads SET updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), threadId);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return { goalId: goal.goalId, revision: goal.revision + 1 };
  }

  updateThreadGoalAccounting(
    threadId: string,
    goalId: string,
    tokens: number,
    seconds: number,
  ): ThreadGoal | undefined {
    const row = this.database
      .prepare("SELECT * FROM thread_goals WHERE thread_id = ? AND goal_id = ?")
      .get(threadId, goalId) as ThreadGoalRow | undefined;
    if (!row) return undefined;
    const tokensUsed = row.tokens_used + Math.max(0, Math.trunc(tokens));
    const timeUsedSeconds = row.time_used_seconds + Math.max(0, seconds);
    const status =
      row.token_budget !== null &&
      tokensUsed >= row.token_budget &&
      !["complete", "budgetLimited"].includes(row.status)
        ? "budgetLimited"
        : row.status;
    const now = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE thread_goals
         SET tokens_used = ?, time_used_seconds = ?, status = ?,
             revision = revision + 1, updated_at = ?
         WHERE thread_id = ? AND goal_id = ?`,
      )
      .run(tokensUsed, timeUsedSeconds, status, now, threadId, goalId);
    return this.getThreadGoal(threadId);
  }

  completeThreadGoal(threadId: string, goalId: string): ThreadGoal {
    const goal = this.getThreadGoal(threadId);
    if (!goal || goal.goalId !== goalId) {
      throw new Error("The active Goal changed before completion.");
    }
    if (goal.status !== "active") {
      throw new Error(`A ${goal.status} Goal cannot be completed.`);
    }
    return this.updateThreadGoalStatus(threadId, goalId, "complete");
  }

  recordThreadGoalBlocker(
    threadId: string,
    goalId: string,
    blocker: string,
  ): { goal: ThreadGoal; attempts: number } {
    const row = this.database
      .prepare("SELECT * FROM thread_goals WHERE thread_id = ? AND goal_id = ?")
      .get(threadId, goalId) as ThreadGoalRow | undefined;
    if (!row || row.status !== "active") {
      throw new Error("Only an active Goal can become blocked.");
    }
    const attempts = row.blocker === blocker ? row.blocker_turns + 1 : 1;
    const status: ThreadGoalStatus = attempts >= 3 ? "blocked" : "active";
    this.database
      .prepare(
        `UPDATE thread_goals
         SET blocker = ?, blocker_turns = ?, status = ?,
             revision = revision + 1, updated_at = ?
         WHERE thread_id = ? AND goal_id = ?`,
      )
      .run(
        blocker,
        attempts,
        status,
        new Date().toISOString(),
        threadId,
        goalId,
      );
    return { goal: this.getThreadGoal(threadId)!, attempts };
  }

  markThreadGoalUsageLimited(threadId: string, goalId: string): ThreadGoal {
    return this.updateThreadGoalStatus(threadId, goalId, "usageLimited");
  }

  markThreadGoalBlocked(threadId: string, goalId: string): ThreadGoal {
    return this.updateThreadGoalStatus(threadId, goalId, "blocked");
  }

  private updateThreadGoalStatus(
    threadId: string,
    goalId: string,
    status: ThreadGoalStatus,
    resetBlocker = false,
  ): ThreadGoal {
    const result = this.database
      .prepare(
        `UPDATE thread_goals
         SET status = ?, revision = revision + 1,
             blocker = CASE WHEN ? THEN NULL ELSE blocker END,
             blocker_turns = CASE WHEN ? THEN 0 ELSE blocker_turns END,
             updated_at = ?
         WHERE thread_id = ? AND goal_id = ?`,
      )
      .run(
        status,
        resetBlocker ? 1 : 0,
        resetBlocker ? 1 : 0,
        new Date().toISOString(),
        threadId,
        goalId,
      );
    if (result.changes === 0) {
      throw new Error("The Goal changed before its status could be updated.");
    }
    return this.getThreadGoal(threadId)!;
  }

  getWorktreeForThread(threadId: string): TaskWorktree | undefined {
    const row = this.database
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

  getWorktree(id: string): TaskWorktree | undefined {
    const row = this.database
      .prepare("SELECT * FROM worktrees WHERE id = ?")
      .get(id) as WorktreeRow | undefined;
    return row ? worktreeFromRow(row) : undefined;
  }

  listWorktrees(): TaskWorktree[] {
    return (
      this.database
        .prepare("SELECT * FROM worktrees ORDER BY updated_at DESC")
        .all() as unknown as WorktreeRow[]
    ).map(worktreeFromRow);
  }

  updateWorktree(
    id: string,
    changes: Partial<
      Pick<
        TaskWorktree,
        "head" | "branch" | "status" | "recoveryPath" | "target"
      >
    >,
  ): TaskWorktree {
    const current = this.getWorktree(id);
    if (!current) {
      throw new Error(`Worktree not found: ${id}`);
    }
    this.database
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
    return this.getWorktree(id)!;
  }

  clearWorktreeRecovery(id: string): TaskWorktree {
    if (!this.getWorktree(id)) {
      throw new Error(`Worktree not found: ${id}`);
    }
    this.database
      .prepare(
        `UPDATE worktrees
         SET recovery_path = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .run(new Date().toISOString(), id);
    return this.getWorktree(id)!;
  }

  attachWorktreeToThread(
    threadId: string,
    worktree: TaskWorktree,
  ): { thread: Thread; worktree: TaskWorktree } {
    const thread = this.getThread(threadId);
    if (
      !thread ||
      thread.id !== worktree.threadId ||
      thread.projectId !== worktree.projectId
    ) {
      throw new Error("Thread and worktree identity do not match.");
    }
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const createdWorktree = this.attachWorktree(worktree);
      const updatedThread = this.updateThread(thread.id, {
        target: worktree.target,
      });
      this.database.exec("COMMIT");
      return { thread: updatedThread, worktree: createdWorktree };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  completeWorktreeCleanup(
    threadId: string,
    worktreeId: string,
    recoveryPath?: string,
  ): { thread: Thread; worktree: TaskWorktree } {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const worktree = this.updateWorktree(worktreeId, {
        status: "removed",
        ...(recoveryPath ? { recoveryPath } : {}),
      });
      const thread = this.updateThread(threadId, { target: "local" });
      this.database.exec("COMMIT");
      return { thread, worktree };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private copyThreadEventsCore(
    sourceThreadId: string,
    targetThreadId: string,
  ): AgentEvent[] {
    const rows = this.database
      .prepare("SELECT body FROM events WHERE thread_id = ? ORDER BY seq ASC")
      .all(sourceThreadId) as unknown as Array<{ body: string }>;
    const copied: AgentEvent[] = [];
    for (const row of rows) {
      const source = agentEventFromBody(row.body);
      if (source.payload.type === "assistant.usage") {
        continue;
      }
      copied.push(
        this.appendEvent(
          randomUUID(),
          targetThreadId,
          source.turnId,
          source.payload,
        ),
      );
    }
    return copied;
  }

  copyThreadEvents(
    sourceThreadId: string,
    targetThreadId: string,
  ): AgentEvent[] {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const copied = this.copyThreadEventsCore(sourceThreadId, targetThreadId);
      this.database.exec("COMMIT");
      return copied;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  createForkedThread(
    thread: Thread,
    sourceThreadId: string,
  ): { thread: Thread; events: AgentEvent[] } {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const created = this.createThread(thread);
      const events = this.copyThreadEventsCore(sourceThreadId, thread.id);
      this.database.exec("COMMIT");
      return { thread: created, events };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  createForkedThreadWithWorktree(
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
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const created = this.createThread(thread);
      const createdWorktree = this.insertWorktree(worktree);
      const events = this.copyThreadEventsCore(sourceThreadId, thread.id);
      this.database.exec("COMMIT");
      return { thread: created, worktree: createdWorktree, events };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  saveApprovalGrant(grant: ApprovalGrant): void {
    this.database
      .prepare(
        `INSERT OR IGNORE INTO approval_grants (
          scope, subject_id, operation, fingerprint, created_at
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        grant.scope,
        grant.subjectId,
        grant.operation,
        grant.fingerprint,
        grant.createdAt,
      );
  }

  findApprovalGrant(
    query: ApprovalGrantQuery,
  ): Exclude<ApprovalScope, "once"> | undefined {
    const row = this.database
      .prepare(
        `SELECT scope FROM approval_grants
         WHERE operation = ? AND fingerprint = ?
           AND (
             (scope = 'session' AND subject_id = ?)
             OR (scope = 'project' AND subject_id = ?)
           )
         ORDER BY CASE scope WHEN 'session' THEN 0 ELSE 1 END
         LIMIT 1`,
      )
      .get(
        query.operation,
        query.fingerprint,
        query.threadId,
        query.projectId,
      ) as { scope: Exclude<ApprovalScope, "once"> } | undefined;
    return row?.scope;
  }

  listReviewComments(threadId: string): ReviewComment[] {
    return (
      this.database
        .prepare(
          `SELECT * FROM review_comments
           WHERE thread_id = ?
           ORDER BY created_at ASC`,
        )
        .all(threadId) as unknown as ReviewCommentRow[]
    ).map(reviewCommentFromRow);
  }

  addReviewComment(
    threadId: string,
    anchor: ReviewCommentAnchor,
    body: string,
  ): ReviewComment {
    if (!this.getThread(threadId)) {
      throw new Error(`Thread not found: ${threadId}`);
    }
    const normalizedBody = body.trim();
    if (
      !normalizedBody ||
      Buffer.byteLength(normalizedBody, "utf8") > 16 * 1024
    ) {
      throw new Error("Review comment must contain between 1 byte and 16 KiB.");
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO review_comments(
           id, thread_id, scope, line_id, path, kind, line_text,
           old_line, new_line, body, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        threadId,
        anchor.scope,
        anchor.lineId,
        anchor.path,
        anchor.kind,
        anchor.text,
        anchor.oldLine ?? null,
        anchor.newLine ?? null,
        normalizedBody,
        now,
        now,
      );
    return this.listReviewComments(threadId).find(
      (comment) => comment.id === id,
    )!;
  }

  deleteReviewComment(threadId: string, commentId: string): void {
    const result = this.database
      .prepare(
        `DELETE FROM review_comments
         WHERE id = ? AND thread_id = ?`,
      )
      .run(commentId, threadId);
    if (result.changes !== 1) {
      throw new Error("Review comment was not found.");
    }
  }

  createAutomation(automation: Automation): Automation {
    const value = automationSchema.parse(automation);
    this.database
      .prepare(
        `INSERT INTO automations (
          id, project_id, name, prompt, mode, target, schedule_json, enabled,
          authorization_state, authorization_fingerprint, authorized_at,
          next_run_at, last_run_at, deleted_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      );
    return this.getAutomation(value.id)!;
  }

  getAutomation(id: string): Automation | undefined {
    const row = this.database
      .prepare("SELECT * FROM automations WHERE id = ?")
      .get(id) as AutomationRow | undefined;
    return row ? automationFromRow(row) : undefined;
  }

  listAutomations(projectId?: string): Automation[] {
    const rows = (projectId
      ? this.database
          .prepare(
            `SELECT * FROM automations
               WHERE project_id = ? AND deleted_at IS NULL
               ORDER BY updated_at DESC`,
          )
          .all(projectId)
      : this.database
          .prepare(
            `SELECT * FROM automations
               WHERE deleted_at IS NULL
               ORDER BY updated_at DESC`,
          )
          .all()) as unknown as AutomationRow[];
    return rows.map(automationFromRow);
  }

  listDueAutomations(now: string): Automation[] {
    return (
      this.database
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

  updateAutomation(automation: Automation): Automation {
    const value = automationSchema.parse(automation);
    if (!this.getAutomation(value.id)) {
      throw new Error(`Automation not found: ${value.id}`);
    }
    this.database
      .prepare(
        `UPDATE automations
         SET name = ?, prompt = ?, mode = ?, target = ?, schedule_json = ?,
             enabled = ?, authorization_state = ?,
             authorization_fingerprint = ?, authorized_at = ?,
             next_run_at = ?, last_run_at = ?, deleted_at = ?, updated_at = ?
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
        value.id,
      );
    return this.getAutomation(value.id)!;
  }

  softDeleteAutomation(id: string): Automation {
    const current = this.getAutomation(id);
    if (!current) throw new Error(`Automation not found: ${id}`);
    const now = new Date().toISOString();
    return this.updateAutomation({
      ...current,
      enabled: false,
      nextRunAt: undefined,
      deletedAt: now,
      updatedAt: now,
    });
  }

  claimAutomationRun(
    run: AutomationRun,
    options: {
      nextRunAt?: string;
      advanceSchedule: boolean;
      disableAutomation?: boolean;
    },
  ): AutomationRun | undefined {
    const value = automationRunSchema.parse(run);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.database
        .prepare(
          `SELECT 1 FROM automation_runs
           WHERE automation_id = ? AND scheduled_for = ?`,
        )
        .get(value.automationId, value.scheduledFor);
      if (existing) {
        this.database.exec("ROLLBACK");
        return undefined;
      }
      this.database
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
        this.database
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
        this.database
          .prepare(
            `UPDATE automations
             SET last_run_at = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(value.scheduledFor, value.updatedAt, value.automationId);
      }
      this.database.exec("COMMIT");
      return this.getAutomationRun(value.id)!;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  getAutomationRun(id: string): AutomationRun | undefined {
    const row = this.database
      .prepare("SELECT * FROM automation_runs WHERE id = ?")
      .get(id) as AutomationRunRow | undefined;
    return row ? automationRunFromRow(row) : undefined;
  }

  getAutomationRunForThread(threadId: string): AutomationRun | undefined {
    const row = this.database
      .prepare(
        `SELECT * FROM automation_runs
         WHERE thread_id = ?
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get(threadId) as AutomationRunRow | undefined;
    return row ? automationRunFromRow(row) : undefined;
  }

  listAutomationRuns(automationId: string, limit = 50): AutomationRun[] {
    const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), 200));
    return (
      this.database
        .prepare(
          `SELECT * FROM automation_runs
           WHERE automation_id = ?
           ORDER BY created_at DESC
           LIMIT ?`,
        )
        .all(automationId, boundedLimit) as unknown as AutomationRunRow[]
    ).map(automationRunFromRow);
  }

  updateAutomationRun(
    id: string,
    changes: {
      state?: AutomationRunState;
      threadId?: string;
      reason?: string | null;
    },
  ): AutomationRun {
    const current = this.getAutomationRun(id);
    if (!current) throw new Error(`Automation run not found: ${id}`);
    const now = new Date().toISOString();
    this.database
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
    return this.getAutomationRun(id)!;
  }

  updateAutomationRunForThread(
    threadId: string,
    state: AutomationRunState,
    reason?: string,
  ): AutomationRun | undefined {
    const run = this.getAutomationRunForThread(threadId);
    if (!run) return undefined;
    return this.updateAutomationRun(run.id, {
      state,
      ...(reason ? { reason } : {}),
    });
  }

  completeAutomationRunForThread(
    threadId: string,
  ): { run: AutomationRun; deletedAutomationId?: string } | undefined {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const current = this.getAutomationRunForThread(threadId);
      if (!current) {
        this.database.exec("ROLLBACK");
        return undefined;
      }
      const run = this.updateAutomationRun(current.id, { state: "completed" });
      const automation = this.getAutomation(run.automationId);
      const shouldDelete =
        automation?.schedule.kind === "once" &&
        !automation.nextRunAt &&
        !automation.deletedAt;
      if (shouldDelete) this.softDeleteAutomation(run.automationId);
      this.database.exec("COMMIT");
      return {
        run,
        ...(shouldDelete ? { deletedAutomationId: run.automationId } : {}),
      };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  hasActiveAutomationRun(automationId: string): boolean {
    return Boolean(
      this.database
        .prepare(
          `SELECT 1 FROM automation_runs
           WHERE automation_id = ?
             AND state IN ('starting', 'running', 'waiting-approval')
           LIMIT 1`,
        )
        .get(automationId),
    );
  }

  hasActiveLocalThread(projectId: string): boolean {
    return Boolean(
      this.database
        .prepare(
          `SELECT 1 FROM threads
           WHERE project_id = ? AND target = 'local'
             AND status IN ('running', 'waiting-approval')
           LIMIT 1`,
        )
        .get(projectId),
    );
  }

  recoverInterruptedAutomationRuns(): AutomationRun[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM automation_runs
         WHERE state = 'starting'`,
      )
      .all() as unknown as AutomationRunRow[];
    return rows.map((row) =>
      this.updateAutomationRun(row.id, {
        state: "failed",
        reason:
          "The previous Artemis process stopped before this scheduled task started.",
      }),
    );
  }

  appendEvent(
    eventId: string,
    threadId: string,
    turnId: string | undefined,
    payload: AgentPayload,
    timestamp?: string,
  ): AgentEvent {
    return this.appendEventsCore(threadId, [
      {
        eventId,
        ...(turnId ? { turnId } : {}),
        payload,
        ...(timestamp ? { timestamp } : {}),
      },
    ])[0]!;
  }

  appendEvents(
    threadId: string,
    inputs: readonly EventAppendInput[],
  ): AgentEvent[] {
    if (inputs.length === 0) return [];
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const events = this.appendEventsCore(threadId, inputs);
      this.database.exec("COMMIT");
      return events;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  appendEventsAndUpdateThread(
    threadId: string,
    inputs: readonly EventAppendInput[],
    changes: Partial<
      Pick<Thread, "title" | "mode" | "target" | "status" | "sessionFile">
    >,
  ): { events: AgentEvent[]; thread: Thread } {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const events = this.appendEventsCore(threadId, inputs);
      const thread = this.updateThread(threadId, changes);
      this.database.exec("COMMIT");
      return { events, thread };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private appendEventsCore(
    threadId: string,
    inputs: readonly EventAppendInput[],
  ): AgentEvent[] {
    if (inputs.length === 0) return [];
    const seqRow = this.database
      .prepare(
        "SELECT COALESCE(MAX(seq), -1) + 1 AS next_seq FROM events WHERE thread_id = ?",
      )
      .get(threadId) as { next_seq: number };
    const insert = this.database.prepare(
      "INSERT INTO events (event_id, thread_id, seq, body, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    const stampedAt = new Date().toISOString();
    return inputs.map((input, index) => {
      const event = agentEventSchema.parse({
        protocolVersion: PROTOCOL_VERSION,
        eventId: input.eventId,
        threadId,
        ...(input.turnId ? { turnId: input.turnId } : {}),
        seq: seqRow.next_seq + index,
        timestamp: input.timestamp ?? stampedAt,
        payload: persistentAgentPayload(input.payload),
      });
      insert.run(
        event.eventId,
        event.threadId,
        event.seq,
        JSON.stringify(event),
        event.timestamp,
      );
      return event;
    });
  }

  getThreadEvents(threadId: string): AgentEvent[] {
    return (
      this.database
        .prepare("SELECT body FROM events WHERE thread_id = ? ORDER BY seq ASC")
        .all(threadId) as unknown as Array<{ body: string }>
    ).map((row) => agentEventFromBody(row.body));
  }

  getTokenUsageEvents(): AgentEvent[] {
    return (
      this.database
        .prepare(
          `SELECT body
           FROM events
           WHERE json_extract(body, '$.payload.type') = 'assistant.usage'
           ORDER BY created_at ASC, event_id ASC`,
        )
        .all() as unknown as Array<{ body: string }>
    ).map((row) => agentEventFromBody(row.body));
  }

  listPromptHistory(limit = 100): string[] {
    const boundedLimit = Math.max(0, Math.min(Math.trunc(limit), 500));
    if (boundedLimit === 0) return [];
    const rows = this.database
      .prepare(
        `SELECT body FROM events
         WHERE body LIKE ?
           AND json_extract(body, '$.payload.text') NOT LIKE ?
           AND json_extract(body, '$.payload.text') NOT LIKE ?
           AND json_extract(body, '$.payload.text') NOT LIKE ?
           AND json_extract(body, '$.payload.text') NOT LIKE ?
           AND json_extract(body, '$.payload.text') NOT LIKE ?
           AND json_extract(body, '$.payload.text') NOT LIKE ?
           AND json_extract(body, '$.payload.text') NOT LIKE ?
           AND json_extract(body, '$.payload.text') != ?
         ORDER BY created_at DESC, rowid DESC
         LIMIT ?`,
      )
      .all(
        '%"type":"user.message"%',
        "[agent-team finding] %: %",
        "[agent-team request] %: %",
        "[agent-team blocker] %: %",
        "[agent-team handoff] %: %",
        "The user nudged sub-agent % (%). Check its status and adjust the approach if needed.",
        "Sub-agent % (%) was stopped by the user. Do not keep waiting for it; continue with another approach.",
        "The user retried sub-agent % as %. Monitor the new attempt instead of the old one.",
        "The user stopped the agent team. Continue the current task without waiting for its members.",
        boundedLimit * 4,
      ) as unknown as Array<{ body: string }>;
    const history: string[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const event = agentEventFromBody(row.body);
      if (event.payload.type !== "user.message") continue;
      const text = event.payload.text.trim();
      if (!text || isLegacyInternalAgentMessage(text) || seen.has(text)) {
        continue;
      }
      seen.add(text);
      history.push(text);
      if (history.length === boundedLimit) break;
    }
    return history;
  }

  getLastTurnChangedFiles(threadId: string): string[] {
    const events = this.getThreadEvents(threadId);
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

  upsertTurnChangeSet(record: TurnChangeSetRecord): TurnChangeSetRecord {
    this.database
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
    return this.getTurnChangeSet(record.threadId, record.turnId)!;
  }

  getTurnChangeSet(
    threadId: string,
    turnId: string,
  ): TurnChangeSetRecord | undefined {
    const row = this.database
      .prepare(
        "SELECT * FROM turn_change_sets WHERE thread_id = ? AND turn_id = ?",
      )
      .get(threadId, turnId) as TurnChangeSetRow | undefined;
    return row ? turnChangeSetFromRow(row) : undefined;
  }

  getLatestTurnChangeSet(threadId: string): TurnChangeSetRecord | undefined {
    const row = this.database
      .prepare(
        `SELECT * FROM turn_change_sets
         WHERE thread_id = ?
         ORDER BY created_at DESC, rowid DESC
         LIMIT 1`,
      )
      .get(threadId) as TurnChangeSetRow | undefined;
    return row ? turnChangeSetFromRow(row) : undefined;
  }

  releaseOlderTurnChangeSetUndo(
    threadId: string,
    currentTurnId: string,
  ): string[] {
    const rows = this.database
      .prepare(
        `SELECT snapshot_path FROM turn_change_sets
         WHERE thread_id = ? AND turn_id != ? AND snapshot_path IS NOT NULL`,
      )
      .all(threadId, currentTurnId) as unknown as Array<{
      snapshot_path: string;
    }>;
    this.database
      .prepare(
        `UPDATE turn_change_sets
         SET undo_available = 0, snapshot_path = NULL
         WHERE thread_id = ? AND turn_id != ?`,
      )
      .run(threadId, currentTurnId);
    return rows.map((row) => row.snapshot_path);
  }

  listTurnChangeSetSnapshotPaths(threadId: string): string[] {
    return (
      this.database
        .prepare(
          `SELECT snapshot_path FROM turn_change_sets
           WHERE thread_id = ? AND snapshot_path IS NOT NULL`,
        )
        .all(threadId) as unknown as Array<{ snapshot_path: string }>
    ).map((row) => row.snapshot_path);
  }

  getThreadChangedFiles(threadId: string): string[] {
    return [
      ...new Set(
        this.getThreadEvents(threadId)
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

  recoverInterruptedThreads(): AgentEvent[] {
    const interrupted = this.database
      .prepare(
        "SELECT * FROM threads WHERE status IN ('running', 'waiting-approval')",
      )
      .all() as unknown as ThreadRow[];
    if (interrupted.length === 0) {
      return [];
    }

    const recovered: AgentEvent[] = [];
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const row of interrupted) {
        const eventRows = this.database
          .prepare(
            "SELECT body FROM events WHERE thread_id = ? ORDER BY seq ASC",
          )
          .all(row.id) as unknown as Array<{ body: string }>;
        const events = eventRows.map((eventRow) =>
          agentEventFromBody(eventRow.body),
        );
        const turnId = events.at(-1)?.turnId;
        const unresolvedApprovals = new Map<
          string,
          { nonce: string; turnId?: string }
        >();
        const unresolvedUserInputs = new Map<
          string,
          { nonce: string; turnId?: string }
        >();
        const multiRequestIds = new Set<string>();
        for (const event of events) {
          if (event.payload.type === "approval.requested") {
            unresolvedApprovals.set(event.payload.approvalId, {
              nonce: event.payload.nonce,
              ...(event.turnId ? { turnId: event.turnId } : {}),
            });
          } else if (event.payload.type === "approval.resolved") {
            unresolvedApprovals.delete(event.payload.approvalId);
          } else if (event.payload.type === "user-input.requested") {
            unresolvedUserInputs.set(event.payload.requestId, {
              nonce: event.payload.nonce,
              ...(event.turnId ? { turnId: event.turnId } : {}),
            });
            if (event.payload.kind === "multi-question") {
              multiRequestIds.add(event.payload.requestId);
            }
          } else if (
            event.payload.type === "user-input.resolved" &&
            event.payload.kind === undefined
          ) {
            unresolvedUserInputs.delete(event.payload.requestId);
          }
        }
        if (multiRequestIds.size > 0) {
          // Kind'd per-question resolutions close only their own question,
          // so "answered one of three, then crashed" is not a whole-card
          // close: replay through the same reducer the renderer uses and
          // keep only requests it still shows with pending questions.
          const viewState = reduceAgentEvents(row.id, events, row.mode);
          for (const requestId of multiRequestIds) {
            // The kind check remains the runtime guard; the cast only gives
            // the per-question answers their protocol type.
            const input = viewState.userInputs[requestId] as
              MultiQuestionUserInputState | undefined;
            if (
              input?.kind === "multi-question" &&
              Object.values(input.answers).every(
                (answer) => answer.status !== "pending",
              )
            ) {
              unresolvedUserInputs.delete(requestId);
            }
          }
        }
        for (const [requestId, input] of unresolvedUserInputs) {
          recovered.push(
            this.appendEvent(randomUUID(), row.id, input.turnId, {
              type: "user-input.resolved",
              requestId,
              nonce: input.nonce,
              answer: "",
              source: "cancelled",
            }),
          );
        }
        for (const [approvalId, approval] of unresolvedApprovals) {
          recovered.push(
            this.appendEvent(randomUUID(), row.id, approval.turnId, {
              type: "approval.resolved",
              approvalId,
              nonce: approval.nonce,
              approved: false,
              scope: "once",
            }),
          );
        }
        recovered.push(
          this.appendEvent(randomUUID(), row.id, turnId, {
            type: "turn.failed",
            message:
              "The previous Artemis process stopped before this turn completed.",
            code: "HOST_RESTART",
          }),
        );
        this.updateThread(row.id, { status: "failed" });
        this.updateAutomationRunForThread(
          row.id,
          "failed",
          "The previous Artemis process stopped before this scheduled task completed.",
        );
      }
      this.database.exec("COMMIT");
      return recovered;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  snapshot(
    locale: AppSnapshot["locale"],
    platform: AppSnapshot["platform"],
    sandbox: AppSnapshot["sandbox"],
    options: { includeEvents?: boolean } = {},
  ): AppSnapshot {
    const projects = (
      this.database
        .prepare(
          "SELECT * FROM projects WHERE hidden = 0 ORDER BY updated_at DESC",
        )
        .all() as unknown as ProjectRow[]
    ).map(projectFromRow);
    const visibleProjectIds = new Set(projects.map((project) => project.id));
    const threads = this.listThreads().filter(
      (thread) => !thread.projectId || visibleProjectIds.has(thread.projectId),
    );
    const worktrees = this.listWorktrees().filter((worktree) =>
      visibleProjectIds.has(worktree.projectId),
    );
    const events: Record<string, AgentEvent[]> = {};
    if (options.includeEvents !== false) {
      for (const thread of threads) {
        if (thread.archived) {
          continue;
        }
        events[thread.id] = this.getThreadEvents(thread.id);
      }
    }
    return { projects, threads, worktrees, events, locale, platform, sandbox };
  }

  close(): void {
    this.database.close();
  }
}

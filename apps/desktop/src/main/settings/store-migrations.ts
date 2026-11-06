import { automationFromRow } from "./store-row-codecs.js";
import {
  THREAD_SESSION_DATABASE_VERSION,
  THREAD_GOAL_DATABASE_VERSION,
  DATABASE_VERSION,
  CUSTOM_AGENTS_DATABASE_VERSION,
  CURRENT_DATABASE_VERSION,
  DESIGN_PLUGIN_DATABASE_VERSION,
  EVENT_PROTOCOL_DATABASE_VERSION,
  DESIGN_PLUGIN_TABLES_DDL,
} from "./store-schema.js";
import { type AutomationRow } from "./store-types.js";

import { DatabaseSync } from "node:sqlite";

import { automationAuthorizationFingerprint } from "../automation/automation-authorization.js";

export function initializeStoreDatabase(database: DatabaseSync): void {
  database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
    `);
  // Schema DDL otherwise commits each table/index separately. On a fresh
  // Windows profile those repeated durable writes can delay the first window.
  try {
    database.exec(`
      BEGIN IMMEDIATE;
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
        type_binding_json TEXT,
        execution_profile TEXT,
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

      CREATE TABLE IF NOT EXISTS custom_agents (
        id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL,
        color TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        instructions TEXT NOT NULL,
        scope TEXT NOT NULL CHECK(scope IN ('all', 'selected')),
        model_policy_json TEXT NOT NULL,
        thinking_policy_json TEXT NOT NULL,
        tool_policy_json TEXT NOT NULL,
        allow_automatic_invocation INTEGER NOT NULL DEFAULT 0,
        triggers_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS custom_agent_projects (
        agent_id TEXT NOT NULL REFERENCES custom_agents(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        PRIMARY KEY (agent_id, project_id)
      );

      CREATE TABLE IF NOT EXISTS custom_agent_invocations (
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        invocation_id TEXT NOT NULL,
        request_fingerprint TEXT NOT NULL,
        definition_id TEXT NOT NULL,
        definition_revision INTEGER NOT NULL,
        definition_name TEXT NOT NULL,
        turn_id TEXT,
        instance_id TEXT,
        status TEXT NOT NULL CHECK(status IN (
          'pending', 'dispatch-committed', 'finished', 'cancelled',
          'outcome-unknown'
        )),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (thread_id, invocation_id)
      );

      CREATE TABLE IF NOT EXISTS events (
        event_id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(thread_id, seq)
      );

      ${DESIGN_PLUGIN_TABLES_DDL}

      CREATE TABLE IF NOT EXISTS turn_checkpoints (
        thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
        turn_id TEXT NOT NULL,
        body TEXT NOT NULL
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
        model_selection_json TEXT,
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
      COMMIT;
    `);
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // BEGIN itself can fail before opening a transaction.
    }
    database.close();
    throw error;
  }
  const projectColumns = database
    .prepare("PRAGMA table_info(projects)")
    .all() as unknown as Array<{ name: string }>;
  if (!projectColumns.some((column) => column.name === "hidden")) {
    database.exec(
      "ALTER TABLE projects ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0",
    );
  }
  const threadColumns = database
    .prepare("PRAGMA table_info(threads)")
    .all() as unknown as Array<{ name: string }>;
  if (!threadColumns.some((column) => column.name === "goal")) {
    database.exec("ALTER TABLE threads ADD COLUMN goal TEXT");
  }
  const databaseVersion = database.prepare("PRAGMA user_version").get() as {
    user_version: number;
  };
  if (databaseVersion.user_version < 8) {
    migrateRunModes();
  }
  const migratedVersion = database.prepare("PRAGMA user_version").get() as {
    user_version: number;
  };
  if (migratedVersion.user_version < EVENT_PROTOCOL_DATABASE_VERSION) {
    advanceDatabaseVersion(EVENT_PROTOCOL_DATABASE_VERSION);
  }
  const eventMigratedVersion = database
    .prepare("PRAGMA user_version")
    .get() as { user_version: number };
  if (eventMigratedVersion.user_version < THREAD_SESSION_DATABASE_VERSION) {
    migrateThreadSessions();
  }
  const sessionMigratedVersion = database
    .prepare("PRAGMA user_version")
    .get() as { user_version: number };
  if (sessionMigratedVersion.user_version < THREAD_GOAL_DATABASE_VERSION) {
    migrateThreadGoals();
  }
  const goalMigratedVersion = database.prepare("PRAGMA user_version").get() as {
    user_version: number;
  };
  if (goalMigratedVersion.user_version < DATABASE_VERSION) {
    advanceDatabaseVersion(DATABASE_VERSION);
  }
  const customAgentsVersion = database.prepare("PRAGMA user_version").get() as {
    user_version: number;
  };
  if (customAgentsVersion.user_version < CUSTOM_AGENTS_DATABASE_VERSION) {
    advanceDatabaseVersion(CUSTOM_AGENTS_DATABASE_VERSION);
  }

  // 三模式迁移（execute→work / review→plan / +codemode）必须先于设计
  // 插件表迁移：它重写既有 threads 的 mode 值域。除了版本门，还要探测
  // 残留旧值——设计插件分支先到过 v15 的开发库从未跑过三模式迁移。
  const hasLegacyModes = Boolean(
    database
      .prepare(
        "SELECT 1 FROM threads WHERE mode IN ('execute','review') LIMIT 1",
      )
      .get() ??
    database
      .prepare(
        "SELECT 1 FROM automations WHERE mode IN ('execute','review') LIMIT 1",
      )
      .get(),
  );
  const beforeThreeModes = database.prepare("PRAGMA user_version").get() as {
    user_version: number;
  };
  if (
    beforeThreeModes.user_version < CURRENT_DATABASE_VERSION ||
    hasLegacyModes
  ) {
    migrateThreeModes();
    if (beforeThreeModes.user_version > CURRENT_DATABASE_VERSION) {
      advanceDatabaseVersion(beforeThreeModes.user_version);
    }
  }
  // S1 design plugins: add the six plugin tables and thread binding columns.
  // CREATE IF NOT EXISTS keeps this safe for fresh databases, and the ALTER
  // paths only run when an older threads table lacks the new columns.
  const afterThreeModes = database.prepare("PRAGMA user_version").get() as {
    user_version: number;
  };
  if (afterThreeModes.user_version < DESIGN_PLUGIN_DATABASE_VERSION) {
    migrateDesignPluginTables();
  }
  // Retire legacy Design permission choices, including already-migrated databases.
  // Keep the column for database compatibility; all chats use mode/tool policy.
  database.exec(
    "UPDATE threads SET execution_profile = NULL WHERE execution_profile IS NOT NULL",
  );
  // Run after legacy mode migrations, which rebuild the automations table.
  const automationColumns = database
    .prepare("PRAGMA table_info(automations)")
    .all() as Array<{ name: string }>;
  if (
    !automationColumns.some((column) => column.name === "model_selection_json")
  ) {
    database.exec(
      "ALTER TABLE automations ADD COLUMN model_selection_json TEXT",
    );
  }

  function migrateRunModes(): void {
    database.exec("PRAGMA foreign_keys = OFF");
    try {
      database.exec(`
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

        UPDATE turn_checkpoints SET body = json_set(body, '$.checkpoint.mode', 'execute') WHERE json_extract(body, '$.checkpoint.mode') IN ('code', 'work');
        PRAGMA user_version = 8;
        COMMIT;
      `);
    } catch (error) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // The migration failed before opening its transaction.
      }
      throw error;
    } finally {
      database.exec("PRAGMA foreign_keys = ON");
    }

    const violations = database
      .prepare("PRAGMA foreign_key_check")
      .all() as unknown[];
    if (violations.length > 0) {
      throw new Error("Run mode migration produced invalid references.");
    }
  }

  /**
   * S1 design-plugin migration (§6.1). Creates the six plugin tables on older
   * databases and adds the thread type-binding columns when missing. The
   * prompt_submissions CHECK constraints mirror the protocol state machine;
   * the S0 standalone ledger table is byte-compatible, so S1 convergence only
   * needs the tables to exist in the main database.
   */
  function migrateDesignPluginTables(): void {
    const threadColumns = database
      .prepare("PRAGMA table_info(threads)")
      .all() as Array<{ name: string }>;
    database.exec(`
      BEGIN IMMEDIATE;
      ${threadColumns.some((column) => column.name === "type_binding_json") ? "" : "ALTER TABLE threads ADD COLUMN type_binding_json TEXT;"}
      ${threadColumns.some((column) => column.name === "execution_profile") ? "" : "ALTER TABLE threads ADD COLUMN execution_profile TEXT;"}
      COMMIT;
    `);
    database.exec(DESIGN_PLUGIN_TABLES_DDL);
    const operationColumns = database
      .prepare("PRAGMA table_info(plugin_operations)")
      .all() as Array<{ name: string }>;
    if (!operationColumns.some((column) => column.name === "result_json")) {
      database.exec(
        "ALTER TABLE plugin_operations ADD COLUMN result_json TEXT",
      );
    }
    advanceDatabaseVersion(DESIGN_PLUGIN_DATABASE_VERSION);
  }

  function migrateThreeModes(): void {
    database.exec("PRAGMA foreign_keys = OFF");
    try {
      database.exec("BEGIN IMMEDIATE");
      const rows = database
        .prepare("SELECT * FROM automations")
        .all() as unknown as AutomationRow[];
      // Verify the original permission fingerprint before changing its canonical mode.
      const grants = rows
        .filter((row) => row.authorization_state === "authorized")
        .map((row) => {
          const canonical = automationFromRow(row);
          const valid =
            row.authorization_fingerprint ===
            automationAuthorizationFingerprint({
              ...canonical,
              mode: row.mode,
            });
          return {
            id: row.id,
            fingerprint: valid
              ? automationAuthorizationFingerprint(canonical)
              : null,
          };
        });
      const schema = (
        database
          .prepare(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='automations'",
          )
          .get() as { sql: string }
      ).sql;
      database.exec(
        schema
          .replace(
            /CREATE TABLE (?:IF NOT EXISTS )?["`]?automations["`]?/i,
            "CREATE TABLE automations_v14",
          )
          .replace("'execute', 'plan', 'review'", "'work', 'plan', 'codemode'"),
      );
      const columns = (
        database.prepare("PRAGMA table_info(automations)").all() as Array<{
          name: string;
        }>
      ).map((c) => c.name);
      database.exec(`INSERT INTO automations_v14 (${columns.join(",")}) SELECT ${columns.map((c) => (c === "mode" ? "CASE mode WHEN 'execute' THEN 'work' WHEN 'review' THEN 'plan' ELSE mode END" : c)).join(",")} FROM automations;
        DROP TABLE automations;
        ALTER TABLE automations_v14 RENAME TO automations;
        CREATE INDEX ix_automations_due ON automations(enabled, deleted_at, next_run_at);
        CREATE INDEX ix_automations_project ON automations(project_id, deleted_at, updated_at DESC);
        UPDATE threads SET mode = CASE mode WHEN 'execute' THEN 'work' WHEN 'review' THEN 'plan' ELSE mode END;
        UPDATE turn_checkpoints SET body = json_set(body, '$.checkpoint.mode', CASE json_extract(body, '$.checkpoint.mode') WHEN 'execute' THEN 'work' WHEN 'review' THEN 'plan' ELSE json_extract(body, '$.checkpoint.mode') END);`);
      for (const grant of grants) {
        if (grant.fingerprint)
          database
            .prepare(
              "UPDATE automations SET authorization_fingerprint=? WHERE id=?",
            )
            .run(grant.fingerprint, grant.id);
        else
          database
            .prepare(
              "UPDATE automations SET enabled=0, authorization_state='required', authorization_fingerprint=NULL, authorized_at=NULL, next_run_at=NULL WHERE id=?",
            )
            .run(grant.id);
      }
      if (database.prepare("PRAGMA foreign_key_check").all().length)
        throw new Error("Invalid mode migration references");
      database.exec(
        `PRAGMA user_version = ${CURRENT_DATABASE_VERSION}; COMMIT;`,
      );
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    } finally {
      database.exec("PRAGMA foreign_keys = ON");
    }
  }

  function advanceDatabaseVersion(databaseVersion: number): void {
    try {
      database.exec(`
        BEGIN IMMEDIATE;
        PRAGMA user_version = ${databaseVersion};
        COMMIT;
      `);
    } catch (error) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // The migration failed before opening its transaction.
      }
      throw error;
    }
  }

  function migrateThreadSessions(): void {
    const columns = database
      .prepare("PRAGMA table_info(threads)")
      .all() as unknown as Array<{ name: string; notnull: number }>;
    const projectId = columns.find((column) => column.name === "project_id");
    if (
      projectId?.notnull === 0 &&
      columns.some((column) => column.name === "model_selection_json") &&
      columns.some((column) => column.name === "context_window")
    ) {
      database.exec(`PRAGMA user_version = ${THREAD_SESSION_DATABASE_VERSION}`);
      return;
    }

    database.exec("PRAGMA foreign_keys = OFF");
    try {
      database.exec(`
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
        database.exec("ROLLBACK");
      } catch {
        // The migration failed before opening its transaction.
      }
      throw error;
    } finally {
      database.exec("PRAGMA foreign_keys = ON");
    }
    const violations = database
      .prepare("PRAGMA foreign_key_check")
      .all() as unknown[];
    if (violations.length > 0) {
      throw new Error("Thread session migration produced invalid references.");
    }
  }

  function migrateThreadGoals(): void {
    try {
      database.exec(`
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
        database.exec("ROLLBACK");
      } catch {
        // The migration failed before opening its transaction.
      }
      throw error;
    }
  }
}

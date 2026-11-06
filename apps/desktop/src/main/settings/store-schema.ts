import { type PluginOperationRow } from "./store-types.js";
export const THREAD_SESSION_DATABASE_VERSION = 10;

export const THREAD_GOAL_DATABASE_VERSION = 11;

export const DATABASE_VERSION = 12;

export const CUSTOM_AGENTS_DATABASE_VERSION = 13;

// Latest schema version; exported so migration tests assert against the
// constant instead of a hardcoded number that goes stale on the next bump.
export const CURRENT_DATABASE_VERSION = 14;

// S1 design plugins: grants/state heads/snapshots/ledger tables plus thread
// type-binding snapshot columns. Threads created for plugin project types
// freeze their binding and restricted profile at creation time (§6.1).
// 合并 main 的三模式迁移（v14）时升到 16：三模式迁移必须先跑（它重写
// threads.mode 的值域），插件表迁移在后；已在 15 的开发库靠旧值内容
// 探测补跑三模式迁移，user_version 只升不降。
export const DESIGN_PLUGIN_DATABASE_VERSION = 16;

export const EVENT_PROTOCOL_DATABASE_VERSION = 9;

/**
 * PR#245 P2-12：plugin_operations 的合法前向迁移表。终态只接受自身重放
 *（幂等再提交），任何回退/终态后重启执行都在 recordPluginOperation 抛错。
 */
export const PLUGIN_OPERATION_TRANSITIONS: Record<
  PluginOperationRow["state"],
  ReadonlySet<PluginOperationRow["state"]>
> = {
  prepared: new Set(["running", "cancelled", "succeeded", "failed"]),
  running: new Set(["succeeded", "failed", "cancelled"]),
  succeeded: new Set(["succeeded"]),
  failed: new Set(["failed"]),
  cancelled: new Set(["cancelled"]),
};

// Six design-plugin tables (proposal §6.1). Shared by the fresh-database
// constructor transaction and the S1 migration path so their definitions
// can never drift apart.
export const DESIGN_PLUGIN_TABLES_DDL = `
      CREATE TABLE IF NOT EXISTS plugin_grants (
        grant_id TEXT PRIMARY KEY,
        installation_id TEXT NOT NULL,
        plugin_id TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        scope TEXT NOT NULL CHECK (scope IN ('thread', 'project')),
        scope_id TEXT NOT NULL,
        capabilities_json TEXT NOT NULL,
        resource_refs_json TEXT NOT NULL,
        grant_revision TEXT NOT NULL,
        revoked_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (installation_id, scope, scope_id, grant_revision)
      );

      CREATE TABLE IF NOT EXISTS plugin_state_heads (
        thread_id TEXT NOT NULL,
        plugin_id TEXT NOT NULL,
        binding_revision TEXT NOT NULL,
        state_schema_version INTEGER NOT NULL,
        state_revision TEXT NOT NULL,
        snapshot_id TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (thread_id, plugin_id, state_schema_version)
      );

      CREATE TABLE IF NOT EXISTS plugin_snapshots (
        snapshot_id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        plugin_id TEXT NOT NULL,
        files_json TEXT NOT NULL,
        parent_snapshot_id TEXT,
        created_by_operation_id TEXT,
        package_revision TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

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
      );

      CREATE INDEX IF NOT EXISTS idx_prompt_submissions_thread_seq
        ON prompt_submissions (thread_id, sequence);

      CREATE TABLE IF NOT EXISTS plugin_operations (
        operation_id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        plugin_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        request_digest TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN (
          'prepared','running','succeeded','failed','cancelled'
        )),
        result_ref TEXT,
        result_json TEXT,
        error TEXT,
        cancelled_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS plugin_events (
        event_id TEXT PRIMARY KEY,
        stream_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        schema_version INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (stream_id, seq)
      );
`;

// S1 design-plugin store tests (proposal §6.1, §9.3).
//
// Covers the two S1 acceptance slices for the main database:
//   1. Fresh database: the six plugin tables exist and the thread
//      typeBinding/executionProfile snapshot round-trips through
//      createThread/getThread.
//   2. Old database (version 13, no plugin tables, no thread binding
//      columns): opening it with AppStore migrates without losing data.
//   3. The converged prompt-submission ledger preserves the S0 crash-window
//      invariants (idempotent accept, illegal transitions, corruption
//      refusal) inside the main database.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AppStore,
  CUSTOM_AGENTS_DATABASE_VERSION,
  DESIGN_PLUGIN_DATABASE_VERSION,
} from "../src/main/store.js";

let directory: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "s1-design-store-"));
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

function threadFixture(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    title: "设计任务",
    mode: "execute" as const,
    target: "local" as const,
    status: "idle" as const,
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const binding = {
  installationId: "install-1",
  pluginId: "com.artemis.design",
  typeId: "artemis-design",
  pluginVersion: "0.1.0",
  contentHash: "a".repeat(64),
  bindingRevision: "rev-1",
};

describe("AppStore S1 design-plugin tables (fresh database)", () => {
  it("creates the six plugin tables on a fresh database", () => {
    const databasePath = join(directory, "fresh.sqlite");
    const store = new AppStore(databasePath);
    store.close();
    const check = new DatabaseSync(databasePath);
    const tables = check
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    const names = new Set(tables.map((t) => t.name));
    for (const expected of [
      "plugin_grants",
      "plugin_state_heads",
      "plugin_snapshots",
      "prompt_submissions",
      "plugin_operations",
      "plugin_events",
    ]) {
      expect(names.has(expected), `missing table ${expected}`).toBe(true);
    }
    const version = check.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    expect(version.user_version).toBe(DESIGN_PLUGIN_DATABASE_VERSION);
    check.close();
  });

  it("round-trips a thread typeBinding and executionProfile", () => {
    const store = new AppStore(join(directory, "binding.sqlite"));
    const created = store.createThread(
      threadFixture({
        typeBinding: binding,
        executionProfile: "plugin-restricted-v1",
      }),
    ) as never as {
      typeBinding: typeof binding;
      executionProfile: string;
    };
    expect(created.typeBinding).toEqual(binding);
    expect(created.executionProfile).toBe("plugin-restricted-v1");

    const reread = store.getThread(created.id) as never as {
      typeBinding: typeof binding;
      executionProfile: string;
    };
    expect(reread.typeBinding).toEqual(binding);
    expect(reread.executionProfile).toBe("plugin-restricted-v1");
    store.close();
  });

  it("keeps ordinary threads unchanged (no binding fields)", () => {
    const store = new AppStore(join(directory, "plain.sqlite"));
    const created = store.createThread(threadFixture()) as never as Record<
      string,
      unknown
    >;
    expect(created.typeBinding).toBeUndefined();
    expect(created.executionProfile).toBeUndefined();
    store.close();
  });
});

describe("AppStore S1 migration from version 13", () => {
  it("migrates an old database without losing existing threads", () => {
    const legacyPath = join(directory, "legacy.sqlite");
    // Build a version-13 database with a threads table that has no plugin
    // columns, then let AppStore open and migrate it.
    const legacy = new DatabaseSync(legacyPath);
    legacy.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        title TEXT NOT NULL,
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
      INSERT INTO threads (id, title, mode, target, status, created_at, updated_at)
        VALUES ('legacy-1', '旧任务', 'execute', 'local', 'idle', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
      PRAGMA user_version = ${CUSTOM_AGENTS_DATABASE_VERSION};
    `);
    legacy.close();

    const store = new AppStore(legacyPath);
    const thread = store.getThread("legacy-1");
    expect(thread?.title).toBe("旧任务");
    expect(
      (thread as unknown as Record<string, unknown>).typeBinding,
    ).toBeUndefined();

    const check = new DatabaseSync(legacyPath);
    const version = check.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    expect(version.user_version).toBe(DESIGN_PLUGIN_DATABASE_VERSION);

    const tables = check
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    expect(new Set(tables.map((t) => t.name)).has("plugin_grants")).toBe(true);

    // New plugin threads can be created on the migrated database.
    const created = store.createThread(
      threadFixture({
        typeBinding: binding,
        executionProfile: "plugin-restricted-v1",
      }),
    ) as never as { typeBinding: typeof binding };
    expect(created.typeBinding).toEqual(binding);
    store.close();
    check.close();
  });
});

describe("AppStore converged prompt-submission ledger", () => {
  it("accept is idempotent and rejects payload corruption", () => {
    const store = new AppStore(join(directory, "ledger.sqlite"));
    const submissionId = randomUUID();
    const first = store.acceptPromptSubmission({
      submissionId,
      threadId: "thread-ledger",
      source: "panel",
      candidateText: "把这个按钮改为深绿",
      bindingRevision: "rev-1",
    });
    const second = store.acceptPromptSubmission({
      submissionId,
      threadId: "thread-ledger",
      source: "panel",
      candidateText: "把这个按钮改为深绿",
      bindingRevision: "rev-1",
    });
    expect(second).toEqual(first);
    expect(first.state).toBe("accepted");
    expect(first.sequence).toBe(1);

    expect(() =>
      store.acceptPromptSubmission({
        submissionId,
        threadId: "thread-ledger",
        source: "panel",
        candidateText: "篡改后的文本",
        bindingRevision: "rev-1",
      }),
    ).toThrow(/different payload/);
    store.close();
  });

  it("enforces the protocol state machine on transitions", () => {
    const store = new AppStore(join(directory, "transitions.sqlite"));
    const submissionId = randomUUID();
    store.acceptPromptSubmission({
      submissionId,
      threadId: "thread-t",
      source: "composer",
      candidateText: "生成客户档案页",
      bindingRevision: "rev-1",
    });
    store.transitionPromptSubmission(submissionId, "queued", "host-queue");
    store.transitionPromptSubmission(submissionId, "dispatching", "host-send");
    store.transitionPromptSubmission(submissionId, "running", "pi-start");
    store.transitionPromptSubmission(submissionId, "completed", "pi-finish");
    const record = store.getPromptSubmission(submissionId)!;
    expect(record.state).toBe("completed");

    // completed is terminal; any further move must throw.
    expect(() =>
      store.transitionPromptSubmission(submissionId, "running", "replay"),
    ).toThrow(/Illegal submission transition/);

    // Unknown ids are refused.
    expect(() =>
      store.transitionPromptSubmission(randomUUID(), "failed", "nope"),
    ).toThrow(/Unknown submission/);
    store.close();
  });

  it("allocates a monotonic per-thread sequence", () => {
    const store = new AppStore(join(directory, "sequence.sqlite"));
    for (let index = 0; index < 3; index += 1) {
      store.acceptPromptSubmission({
        submissionId: randomUUID(),
        threadId: "thread-seq",
        source: "panel",
        candidateText: `指令 ${index}`,
        bindingRevision: "rev-1",
      });
    }
    const records = store.listPromptSubmissions("thread-seq");
    expect(records.map((r) => r.sequence)).toEqual([1, 2, 3]);
    store.close();
  });

  it("records plugin operations idempotently and rejects digest drift", () => {
    const store = new AppStore(join(directory, "operations.sqlite"));
    const operationId = randomUUID();
    store.recordPluginOperation({
      operationId,
      threadId: "thread-op",
      pluginId: "com.artemis.design",
      toolName: "create_document",
      requestDigest: "digest-1",
      state: "succeeded",
      resultRef: "blob://op-1",
    });
    // Same digest replay is a no-op (returns original state).
    store.recordPluginOperation({
      operationId,
      threadId: "thread-op",
      pluginId: "com.artemis.design",
      toolName: "create_document",
      requestDigest: "digest-1",
      state: "failed",
    });
    expect(() =>
      store.recordPluginOperation({
        operationId,
        threadId: "thread-op",
        pluginId: "com.artemis.design",
        toolName: "create_document",
        requestDigest: "digest-2",
        state: "failed",
      }),
    ).toThrow(/different request digest/);
    store.close();
  });

  it("appends plugin events with per-stream sequence numbers", () => {
    const store = new AppStore(join(directory, "events.sqlite"));
    store.appendPluginEvent({
      eventId: randomUUID(),
      streamId: "stream-1",
      threadId: "thread-ev",
      schemaVersion: 1,
      payload: { kind: "snapshot-created" },
    });
    store.appendPluginEvent({
      eventId: randomUUID(),
      streamId: "stream-1",
      threadId: "thread-ev",
      schemaVersion: 1,
      payload: { kind: "state-head-advanced" },
    });
    store.close();
    const check = new DatabaseSync(join(directory, "events.sqlite"));
    const rows = check
      .prepare("SELECT seq FROM plugin_events ORDER BY seq")
      .all() as unknown as Array<{ seq: number }>;
    expect(rows.map((r) => r.seq)).toEqual([1, 2]);
    check.close();
  });
});

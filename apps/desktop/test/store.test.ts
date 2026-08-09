import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { AppStore } from "../src/main/store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("AppStore", () => {
  it("appends event batches with continuous sequence numbers in one turn transaction", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-store-"));
    temporaryDirectories.push(directory);
    const store = new AppStore(join(directory, "state.sqlite"));
    const now = "2026-08-07T00:00:00.000Z";
    store.upsertProject({
      id: "project-1",
      name: "Workspace",
      path: join(directory, "workspace"),
      createdAt: now,
      updatedAt: now,
    });
    store.createThread({
      id: "thread-1",
      projectId: "project-1",
      title: "Batch",
      mode: "execute",
      target: "local",
      status: "idle",
      pinned: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });

    const result = store.appendEventsAndUpdateThread(
      "thread-1",
      [
        {
          eventId: "event-1",
          turnId: "turn-1",
          payload: {
            type: "user.message",
            messageId: "message-1",
            text: "Hello",
          },
        },
        {
          eventId: "event-2",
          turnId: "turn-1",
          payload: { type: "turn.started", mode: "execute" },
        },
      ],
      { status: "running", mode: "execute" },
    );

    expect(result.events.map((event) => event.seq)).toEqual([0, 1]);
    expect(
      store.getThreadEvents("thread-1").map((event) => event.eventId),
    ).toEqual(["event-1", "event-2"]);
    expect(result.thread.status).toBe("running");
    store.close();
  });

  it("never persists Reasoning text in task timeline events", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-store-"));
    temporaryDirectories.push(directory);
    const store = new AppStore(join(directory, "state.sqlite"));
    const now = "2026-08-03T00:00:00.000Z";
    store.upsertProject({
      id: "project-1",
      name: "Workspace",
      path: join(directory, "workspace"),
      createdAt: now,
      updatedAt: now,
    });
    store.createThread({
      id: "thread-1",
      projectId: "project-1",
      title: "Private reasoning",
      mode: "execute",
      target: "local",
      status: "running",
      pinned: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });

    const event = store.appendEvent("thinking-event", "thread-1", "turn-1", {
      type: "message.part.delta",
      partId: "assistant:thinking",
      partType: "thinking",
      delta: "private chain of thought",
    });
    const persisted = store.getThreadEvents("thread-1")[0];
    store.close();

    expect(event.payload).toMatchObject({ partType: "thinking", delta: "" });
    expect(persisted?.payload).toMatchObject({
      partType: "thinking",
      delta: "",
    });
  });

  it("reads a global, deduplicated prompt history from persisted events", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-store-"));
    temporaryDirectories.push(directory);
    const store = new AppStore(join(directory, "state.sqlite"));
    const now = "2026-07-29T00:00:00.000Z";
    store.upsertProject({
      id: "project-1",
      name: "Workspace",
      path: join(directory, "workspace"),
      createdAt: now,
      updatedAt: now,
    });
    for (const [id, title] of [
      ["thread-1", "First task"],
      ["thread-2", "Second task"],
    ]) {
      store.createThread({
        id,
        projectId: "project-1",
        title,
        mode: "execute",
        target: "local",
        status: "idle",
        pinned: false,
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
    }
    store.appendEvent("event-1", "thread-1", "turn-1", {
      type: "user.message",
      messageId: "message-1",
      text: "first prompt",
    });
    store.appendEvent("event-2", "thread-2", "turn-2", {
      type: "user.message",
      messageId: "message-2",
      text: "second prompt",
    });
    store.appendEvent("event-3", "thread-2", "turn-3", {
      type: "user.message",
      messageId: "message-3",
      text: "first prompt",
    });
    for (let index = 0; index < 12; index += 1) {
      store.appendEvent(`event-internal-${index}`, "thread-2", "turn-3", {
        type: "user.message",
        messageId: `legacy-handoff-${index}`,
        text: `[agent-team handoff] child-${index}: Internal result.`,
      });
    }
    store.appendEvent("event-internal-stop", "thread-2", "turn-3", {
      type: "user.message",
      messageId: "legacy-stop",
      text: "Sub-agent child-1 (Reviewer) was stopped by the user. Do not keep waiting for it; continue with another approach.",
    });
    store.appendEvent("event-internal-retry", "thread-2", "turn-3", {
      type: "user.message",
      messageId: "legacy-retry",
      text: "The user retried sub-agent child-1 as child-2. Monitor the new attempt instead of the old one.",
    });

    expect(store.listPromptHistory(2)).toEqual([
      "first prompt",
      "second prompt",
    ]);
    store.close();
  });

  it("migrates existing project rows to the removable sidebar schema", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-store-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "state.sqlite");
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO projects VALUES (
        'legacy-project',
        'Legacy',
        'D:\\legacy',
        '2026-07-26T00:00:00.000Z',
        '2026-07-26T00:00:00.000Z'
      );
      PRAGMA user_version = 4;
    `);
    legacy.close();

    const store = new AppStore(databasePath);
    expect(
      store.snapshot("en", "win32", {
        available: false,
        implementation: "test",
      }).projects,
    ).toHaveLength(1);
    store.removeProject("legacy-project");
    expect(
      store.snapshot("en", "win32", {
        available: false,
        implementation: "test",
      }).projects,
    ).toEqual([]);
    store.close();
  });

  it("migrates legacy Code and Work state to Execute without retaining unattended authorization", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-store-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "state.sqlite");
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        hidden INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        goal TEXT,
        mode TEXT NOT NULL,
        target TEXT NOT NULL,
        status TEXT NOT NULL,
        session_file TEXT,
        pinned INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE events (
        event_id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(thread_id, seq)
      );
      CREATE TABLE automations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        prompt TEXT NOT NULL,
        mode TEXT NOT NULL CHECK(mode IN ('code', 'work', 'plan', 'review')),
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
      CREATE TABLE automation_runs (
        id TEXT PRIMARY KEY,
        automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
        scheduled_for TEXT NOT NULL,
        trigger TEXT NOT NULL CHECK(trigger IN ('schedule', 'catch-up', 'manual')),
        state TEXT NOT NULL CHECK(state IN (
          'starting', 'running', 'waiting-approval',
          'completed', 'failed', 'skipped'
        )),
        thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,
        reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(automation_id, scheduled_for)
      );
      PRAGMA user_version = 7;
    `);
    const now = "2026-08-06T00:00:00.000Z";
    legacy
      .prepare("INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?)")
      .run("project-1", "Workspace", join(directory, "workspace"), now, now, 0);
    const insertThread = legacy.prepare(
      `INSERT INTO threads VALUES (
        ?, 'project-1', ?, NULL, ?, 'local', 'idle', NULL, 0, 0, ?, ?
      )`,
    );
    insertThread.run("thread-code", "Code task", "code", now, now);
    insertThread.run("thread-work", "Work task", "work", now, now);
    const insertEvent = legacy.prepare(
      "INSERT INTO events VALUES (?, ?, 0, ?, ?)",
    );
    for (const [threadId, mode] of [
      ["thread-code", "code"],
      ["thread-work", "work"],
    ] as const) {
      insertEvent.run(
        `event-${mode}`,
        threadId,
        JSON.stringify({
          protocolVersion: 1,
          eventId: `event-${mode}`,
          threadId,
          turnId: `turn-${mode}`,
          seq: 0,
          timestamp: now,
          payload: { type: "turn.started", mode },
        }),
        now,
      );
    }
    legacy
      .prepare(
        `INSERT INTO automations VALUES (
          'automation-1', 'project-1', 'Legacy work', 'Build the report',
          'work', 'managed-worktree', ?, 1, 'authorized', ?, ?, ?, NULL, NULL,
          ?, ?
        )`,
      )
      .run(
        JSON.stringify({
          kind: "weekly",
          daysOfWeek: [1],
          localTime: "09:00",
          timeZone: "Asia/Shanghai",
        }),
        "a".repeat(64),
        now,
        "2026-08-07T01:00:00.000Z",
        now,
        now,
      );
    legacy
      .prepare(
        `INSERT INTO automation_runs VALUES (
          'run-1', 'automation-1', ?, 'schedule', 'completed', 'thread-work',
          NULL, ?, ?
        )`,
      )
      .run(now, now, now);
    legacy.close();

    const store = new AppStore(databasePath);
    expect(store.getThread("thread-code")?.mode).toBe("execute");
    expect(store.getThread("thread-work")?.mode).toBe("execute");
    for (const threadId of ["thread-code", "thread-work"]) {
      expect(store.getThreadEvents(threadId)[0]).toMatchObject({
        protocolVersion: 3,
        payload: { type: "turn.started", mode: "execute" },
      });
    }
    expect(store.getAutomation("automation-1")).toMatchObject({
      mode: "execute",
      enabled: false,
      authorizationState: "required",
    });
    expect(store.getAutomation("automation-1")).not.toHaveProperty(
      "authorizationFingerprint",
    );
    expect(store.getAutomation("automation-1")).not.toHaveProperty(
      "authorizedAt",
    );
    expect(store.getAutomation("automation-1")).not.toHaveProperty("nextRunAt");
    expect(store.listAutomationRuns("automation-1")).toHaveLength(1);
    store.close();
  });

  it("removes a project from the sidebar without deleting its task history", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-store-"));
    temporaryDirectories.push(directory);
    const store = new AppStore(join(directory, "state.sqlite"));
    const workspacePath = join(directory, "workspace");
    const now = "2026-07-27T00:00:00.000Z";
    const project = store.upsertProject({
      id: "project-1",
      name: "Workspace",
      path: workspacePath,
      createdAt: now,
      updatedAt: now,
    });
    store.createThread({
      id: "thread-1",
      projectId: project.id,
      title: "Keep this task",
      mode: "execute",
      target: "local",
      status: "idle",
      pinned: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    store.appendEvent(randomUUID(), "thread-1", "turn-1", {
      type: "message.part.delta",
      partId: "assistant:text",
      partType: "text",
      delta: "preserved",
    });

    store.removeProject(project.id);

    const hidden = store.snapshot("en", "win32", {
      available: false,
      implementation: "test",
    });
    expect(hidden.projects).toEqual([]);
    expect(hidden.threads).toEqual([]);
    expect(hidden.events).toEqual({});
    expect(store.getThread("thread-1")).toBeDefined();

    const reopened = store.upsertProject({
      ...project,
      updatedAt: "2026-07-27T00:01:00.000Z",
    });
    const restored = store.snapshot("en", "win32", {
      available: false,
      implementation: "test",
    });
    store.close();

    expect(reopened.id).toBe(project.id);
    expect(restored.projects).toHaveLength(1);
    expect(restored.threads).toHaveLength(1);
    expect(restored.events["thread-1"]?.[0]?.payload).toMatchObject({
      type: "message.part.delta",
      delta: "preserved",
    });
  });

  it("keeps a project visible while one of its tasks is active", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-store-"));
    temporaryDirectories.push(directory);
    const store = new AppStore(join(directory, "state.sqlite"));
    const now = "2026-07-27T00:00:00.000Z";
    store.upsertProject({
      id: "project-1",
      name: "Workspace",
      path: join(directory, "workspace"),
      createdAt: now,
      updatedAt: now,
    });
    store.createThread({
      id: "thread-1",
      projectId: "project-1",
      title: "Running task",
      mode: "execute",
      target: "local",
      status: "running",
      pinned: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });

    expect(() => store.removeProject("project-1")).toThrow(
      "Stop active tasks before removing this project.",
    );
    expect(
      store.snapshot("en", "win32", {
        available: false,
        implementation: "test",
      }).projects,
    ).toHaveLength(1);
    store.close();
  });

  it("restores projects, threads, and replayable events", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-store-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "state.sqlite");
    const workspacePath = join(directory, "workspace");
    const now = "2026-07-26T00:00:00.000Z";

    const first = new AppStore(databasePath);
    const project = first.upsertProject({
      id: "project-1",
      name: "Workspace",
      path: workspacePath,
      createdAt: now,
      updatedAt: now,
    });
    first.createThread({
      id: "thread-1",
      projectId: project.id,
      title: "Persist this task",
      mode: "execute",
      target: "local",
      status: "idle",
      pinned: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    first.appendEvent(randomUUID(), "thread-1", "turn-1", {
      type: "message.part.delta",
      partId: "assistant:text",
      partType: "text",
      delta: "persisted",
    });
    first.close();

    const reopened = new AppStore(databasePath);
    const shellSnapshot = reopened.snapshot(
      "en",
      "win32",
      {
        available: false,
        implementation: "test",
      },
      { includeEvents: false },
    );
    const snapshot = reopened.snapshot("en", "win32", {
      available: false,
      implementation: "test",
    });
    const threadEvents = reopened.getThreadEvents("thread-1");
    reopened.close();

    expect(shellSnapshot.events).toEqual({});
    expect(snapshot.projects).toHaveLength(1);
    expect(snapshot.threads).toHaveLength(1);
    expect(snapshot.events["thread-1"]?.[0]?.payload).toMatchObject({
      type: "message.part.delta",
      delta: "persisted",
    });
    expect(threadEvents[0]?.payload).toMatchObject({
      type: "message.part.delta",
      delta: "persisted",
    });
  });

  it("persists scoped approval grants and matches the exact subject", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-store-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "state.sqlite");
    const now = "2026-07-26T00:00:00.000Z";

    const first = new AppStore(databasePath);
    first.upsertProject({
      id: "project-1",
      name: "Workspace",
      path: join(directory, "workspace"),
      createdAt: now,
      updatedAt: now,
    });
    first.createThread({
      id: "thread-1",
      projectId: "project-1",
      title: "Approval task",
      mode: "execute",
      target: "local",
      status: "idle",
      pinned: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    first.saveApprovalGrant({
      scope: "session",
      subjectId: "thread-1",
      operation: "workspace.write",
      fingerprint: "readme-fingerprint",
      createdAt: now,
    });
    first.saveApprovalGrant({
      scope: "project",
      subjectId: "project-1",
      operation: "workspace.write",
      fingerprint: "project-fingerprint",
      createdAt: now,
    });
    first.close();

    const reopened = new AppStore(databasePath);
    expect(
      reopened.findApprovalGrant({
        threadId: "thread-1",
        projectId: "project-1",
        operation: "workspace.write",
        fingerprint: "readme-fingerprint",
      }),
    ).toBe("session");
    expect(
      reopened.findApprovalGrant({
        threadId: "another-thread",
        projectId: "project-1",
        operation: "workspace.write",
        fingerprint: "readme-fingerprint",
      }),
    ).toBeUndefined();
    expect(
      reopened.findApprovalGrant({
        threadId: "another-thread",
        projectId: "project-1",
        operation: "workspace.write",
        fingerprint: "project-fingerprint",
      }),
    ).toBe("project");
    reopened.close();
  });

  it("updates lifecycle fields and copies replay events for a fork", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-store-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "state.sqlite");
    const now = "2026-07-26T00:00:00.000Z";
    const store = new AppStore(databasePath);
    store.upsertProject({
      id: "project-1",
      name: "Workspace",
      path: join(directory, "workspace"),
      createdAt: now,
      updatedAt: now,
    });
    store.createThread({
      id: "thread-1",
      projectId: "project-1",
      title: "Source",
      mode: "execute",
      target: "local",
      status: "idle",
      pinned: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    store.createThread({
      id: "thread-2",
      projectId: "project-1",
      title: "Fork",
      mode: "execute",
      target: "local",
      status: "idle",
      pinned: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    const sourceEvent = store.appendEvent(randomUUID(), "thread-1", "turn-1", {
      type: "user.message",
      messageId: "message-1",
      text: "Keep this history",
    });

    expect(
      store.updateThread("thread-1", {
        title: "Renamed",
        archived: true,
      }),
    ).toMatchObject({ title: "Renamed", archived: true });
    const copied = store.copyThreadEvents("thread-1", "thread-2");
    const forkSnapshot = store.snapshot("en", "win32", {
      available: false,
      implementation: "test",
    });
    store.close();

    expect(copied).toHaveLength(1);
    expect(copied[0]?.eventId).not.toBe(sourceEvent.eventId);
    expect(
      forkSnapshot.threads
        .filter((thread) => !thread.archived)
        .map((thread) => thread.id),
    ).toEqual(["thread-2"]);
    expect(forkSnapshot.events["thread-2"]?.[0]?.payload).toMatchObject({
      type: "user.message",
      text: "Keep this history",
    });
  });

  it("returns only files changed by the latest turn", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-store-"));
    temporaryDirectories.push(directory);
    const store = new AppStore(join(directory, "state.sqlite"));
    const now = "2026-07-26T00:00:00.000Z";
    store.upsertProject({
      id: "project-1",
      name: "Workspace",
      path: join(directory, "workspace"),
      createdAt: now,
      updatedAt: now,
    });
    store.createThread({
      id: "thread-1",
      projectId: "project-1",
      title: "Review task",
      mode: "execute",
      target: "local",
      status: "idle",
      pinned: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    store.appendEvent(randomUUID(), "thread-1", "turn-1", {
      type: "turn.started",
      mode: "execute",
    });
    store.appendEvent(randomUUID(), "thread-1", "turn-1", {
      type: "file.changed",
      path: "old.txt",
      operation: "update",
    });
    store.appendEvent(randomUUID(), "thread-1", "turn-2", {
      type: "turn.started",
      mode: "execute",
    });
    store.appendEvent(randomUUID(), "thread-1", "turn-2", {
      type: "file.changed",
      path: "current.txt",
      operation: "create",
    });
    store.appendEvent(randomUUID(), "thread-1", "turn-2", {
      type: "file.changed",
      path: "current.txt",
      operation: "update",
    });

    expect(store.getLastTurnChangedFiles("thread-1")).toEqual(["current.txt"]);
    store.close();
  });

  it("persists a task worktree atomically and records safe cleanup", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-store-"));
    temporaryDirectories.push(directory);
    const store = new AppStore(join(directory, "state.sqlite"));
    const now = "2026-07-26T00:00:00.000Z";
    store.upsertProject({
      id: "project-1",
      name: "Workspace",
      path: join(directory, "workspace"),
      createdAt: now,
      updatedAt: now,
    });
    const created = store.createThreadWithWorktree(
      {
        id: "thread-1",
        projectId: "project-1",
        title: "Managed task",
        mode: "execute",
        target: "managed-worktree",
        status: "idle",
        pinned: false,
        archived: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "worktree-1",
        threadId: "thread-1",
        projectId: "project-1",
        path: join(directory, "managed", "thread-1"),
        target: "managed-worktree",
        head: "0123456789abcdef",
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
    );

    expect(created.thread.target).toBe("managed-worktree");
    expect(store.getWorktreeForThread("thread-1")).toMatchObject({
      id: "worktree-1",
      status: "active",
    });
    store.updateWorktree("worktree-1", {
      branch: "feature/thread-1",
    });
    expect(
      store.completeWorktreeCleanup(
        "thread-1",
        "worktree-1",
        join(directory, "recovery"),
      ),
    ).toMatchObject({
      thread: { target: "local" },
      worktree: {
        branch: "feature/thread-1",
        status: "removed",
      },
    });
    const reattached = store.attachWorktreeToThread("thread-1", {
      id: "worktree-2",
      threadId: "thread-1",
      projectId: "project-1",
      path: join(directory, "managed", "thread-1-again"),
      target: "managed-worktree",
      head: "fedcba9876543210",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    expect(reattached.thread.target).toBe("managed-worktree");
    expect(store.getWorktreeForThread("thread-1")?.id).toBe("worktree-2");
    expect(() =>
      store.attachWorktreeToThread("thread-1", {
        id: "worktree-3",
        threadId: "thread-1",
        projectId: "project-1",
        path: join(directory, "managed", "thread-1-duplicate"),
        target: "managed-worktree",
        head: "duplicate",
        status: "active",
        createdAt: now,
        updatedAt: now,
      }),
    ).toThrow();
    expect(
      store.snapshot("en", "win32", {
        available: false,
        implementation: "test",
      }).worktrees,
    ).toHaveLength(2);
    store.close();
  });

  it("reactivates a removed managed worktree when handing back to the same path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-store-"));
    temporaryDirectories.push(directory);
    const store = new AppStore(join(directory, "state.sqlite"));
    const now = "2026-07-26T00:00:00.000Z";
    const worktreePath = join(directory, "managed", "thread-1");
    store.upsertProject({
      id: "project-1",
      name: "Workspace",
      path: join(directory, "workspace"),
      createdAt: now,
      updatedAt: now,
    });
    store.createThreadWithWorktree(
      {
        id: "thread-1",
        projectId: "project-1",
        title: "Managed task",
        mode: "execute",
        target: "managed-worktree",
        status: "idle",
        pinned: false,
        archived: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "worktree-1",
        threadId: "thread-1",
        projectId: "project-1",
        path: worktreePath,
        target: "managed-worktree",
        head: "0123456789abcdef",
        branch: "old-branch",
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
    );
    store.completeWorktreeCleanup(
      "thread-1",
      "worktree-1",
      join(directory, "old-recovery"),
    );

    const reattached = store.attachWorktreeToThread("thread-1", {
      id: "worktree-2",
      threadId: "thread-1",
      projectId: "project-1",
      path: worktreePath,
      target: "managed-worktree",
      head: "fedcba9876543210",
      status: "active",
      recoveryPath: join(directory, "new-recovery"),
      createdAt: now,
      updatedAt: now,
    });

    expect(reattached.thread.target).toBe("managed-worktree");
    expect(reattached.worktree).toMatchObject({
      id: "worktree-1",
      path: worktreePath,
      head: "fedcba9876543210",
      status: "active",
      recoveryPath: join(directory, "new-recovery"),
    });
    expect(reattached.worktree.branch).toBeUndefined();
    expect(store.listWorktrees()).toHaveLength(1);
    store.close();
  });

  it("fails interrupted tasks on restart with a replayable recovery event", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-store-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "state.sqlite");
    const now = "2026-07-26T00:00:00.000Z";
    const first = new AppStore(databasePath);
    first.upsertProject({
      id: "project-1",
      name: "Workspace",
      path: join(directory, "workspace"),
      createdAt: now,
      updatedAt: now,
    });
    first.createThread({
      id: "thread-1",
      projectId: "project-1",
      title: "Interrupted",
      mode: "execute",
      target: "local",
      status: "waiting-approval",
      pinned: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    first.appendEvent(randomUUID(), "thread-1", "turn-1", {
      type: "approval.requested",
      approvalId: "approval-1",
      nonce: "restart-nonce-0001",
      summary: "Write README.md",
      paths: ["README.md"],
      network: [],
      risk: "medium",
      allowedScopes: ["once"],
    });
    first.appendEvent(randomUUID(), "thread-1", "turn-1", {
      type: "user-input.requested",
      requestId: "input-1",
      nonce: "restart-input-0001",
      header: "Target",
      question: "Which target should be optimized?",
      options: [
        {
          label: "Sweep",
          description: "Optimize the whole sweep.",
          recommended: true,
        },
        {
          label: "Latency",
          description: "Optimize one point.",
          recommended: false,
        },
      ],
      expiresAt: "2026-07-26T00:05:00.000Z",
    });
    first.close();

    const reopened = new AppStore(databasePath);
    expect(reopened.recoverInterruptedThreads()).toHaveLength(3);
    const snapshot = reopened.snapshot("en", "win32", {
      available: false,
      implementation: "test",
    });
    reopened.close();

    expect(snapshot.threads[0]?.status).toBe("failed");
    expect(snapshot.events["thread-1"]?.at(-1)?.payload).toMatchObject({
      type: "turn.failed",
      code: "HOST_RESTART",
    });
    expect(snapshot.events["thread-1"]?.at(-2)?.payload).toMatchObject({
      type: "approval.resolved",
      approved: false,
    });
    expect(snapshot.events["thread-1"]?.at(-3)?.payload).toMatchObject({
      type: "user-input.resolved",
      source: "cancelled",
    });
  });

  it("persists and deletes line-anchored Review comments", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-comments-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "state.sqlite");
    const now = "2026-07-26T00:00:00.000Z";
    const first = new AppStore(databasePath);
    first.upsertProject({
      id: "project-1",
      name: "Workspace",
      path: join(directory, "workspace"),
      createdAt: now,
      updatedAt: now,
    });
    first.createThread({
      id: "thread-1",
      projectId: "project-1",
      title: "Review task",
      mode: "review",
      target: "local",
      status: "idle",
      pinned: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    const created = first.addReviewComment(
      "thread-1",
      {
        scope: "unstaged",
        lineId: "line-anchor-1",
        path: "src/app.ts",
        kind: "addition",
        text: "const value = 1;",
        newLine: 12,
      },
      "Please cover this branch.",
    );
    first.close();

    const reopened = new AppStore(databasePath);
    expect(reopened.listReviewComments("thread-1")).toEqual([
      expect.objectContaining({
        id: created.id,
        lineId: "line-anchor-1",
        newLine: 12,
        body: "Please cover this branch.",
      }),
    ]);
    reopened.deleteReviewComment("thread-1", created.id);
    expect(reopened.listReviewComments("thread-1")).toEqual([]);
    reopened.close();
  });

  it("migrates legacy threads and persists a task goal", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-goal-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "state.sqlite");
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        hidden INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        mode TEXT NOT NULL,
        target TEXT NOT NULL,
        status TEXT NOT NULL,
        session_file TEXT,
        pinned INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO projects VALUES (
        'project-1',
        'Workspace',
        'D:\\workspace',
        '2026-07-27T00:00:00.000Z',
        '2026-07-27T00:00:00.000Z',
        0
      );
      INSERT INTO threads VALUES (
        'thread-1',
        'project-1',
        'Existing task',
        'code',
        'local',
        'idle',
        NULL,
        0,
        0,
        '2026-07-27T00:00:00.000Z',
        '2026-07-27T00:00:00.000Z'
      );
      PRAGMA user_version = 5;
    `);
    legacy.close();

    const store = new AppStore(databasePath);
    expect(store.getThread("thread-1")?.goal).toBeUndefined();
    const updated = store.updateThread("thread-1", {
      goal: "Ship searchable archives",
    });
    expect(updated.goal).toBe("Ship searchable archives");
    expect(store.updateThread("thread-1", { goal: null }).goal).toBeUndefined();
    store.close();
  });
});

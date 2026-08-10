import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import type { Automation } from "@artemis/protocol";
import { AppStore } from "../src/main/store.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function createStore(): Promise<AppStore> {
  const directory = await mkdtemp(join(tmpdir(), "artemis-automation-"));
  cleanup.push(directory);
  return new AppStore(join(directory, "state.sqlite"));
}

function automation(): Automation {
  return {
    id: "automation-1",
    projectId: "project-1",
    name: "Daily review",
    prompt: "Review the workspace.",
    mode: "review",
    target: "local",
    schedule: {
      kind: "weekly",
      daysOfWeek: [1, 2, 3, 4, 5],
      localTime: "09:30",
      timeZone: "Asia/Shanghai",
    },
    enabled: true,
    authorizationState: "not-required",
    nextRunAt: "2026-07-31T01:30:00.000Z",
    createdAt: "2026-07-30T01:00:00.000Z",
    updatedAt: "2026-07-30T01:00:00.000Z",
  };
}

describe("AppStore automations", () => {
  it("persists schedules and claims each occurrence exactly once", async () => {
    const store = await createStore();
    store.upsertProject({
      id: "project-1",
      name: "Project",
      path: "D:\\Project",
      createdAt: "2026-07-30T01:00:00.000Z",
      updatedAt: "2026-07-30T01:00:00.000Z",
    });
    store.createAutomation(automation());

    const run = {
      id: "run-1",
      automationId: "automation-1",
      scheduledFor: "2026-07-31T01:30:00.000Z",
      trigger: "schedule" as const,
      state: "starting" as const,
      createdAt: "2026-07-31T01:30:00.000Z",
      updatedAt: "2026-07-31T01:30:00.000Z",
    };
    expect(
      store.claimAutomationRun(run, {
        advanceSchedule: true,
        nextRunAt: "2026-08-01T01:30:00.000Z",
      }),
    ).toMatchObject({ id: "run-1", state: "starting" });
    expect(
      store.claimAutomationRun(
        { ...run, id: "run-duplicate" },
        {
          advanceSchedule: true,
          nextRunAt: "2026-08-01T01:30:00.000Z",
        },
      ),
    ).toBeUndefined();
    expect(store.getAutomation("automation-1")).toMatchObject({
      nextRunAt: "2026-08-01T01:30:00.000Z",
      lastRunAt: "2026-07-31T01:30:00.000Z",
    });
    store.close();
  });

  it("disables project automations when the project leaves the sidebar", async () => {
    const store = await createStore();
    store.upsertProject({
      id: "project-1",
      name: "Project",
      path: "D:\\Project",
      createdAt: "2026-07-30T01:00:00.000Z",
      updatedAt: "2026-07-30T01:00:00.000Z",
    });
    store.createAutomation(automation());
    store.removeProject("project-1");

    expect(store.getAutomation("automation-1")).toMatchObject({
      enabled: false,
    });
    expect(store.getAutomation("automation-1")?.nextRunAt).toBeUndefined();
    store.close();
  });

  it("deletes only a completed one-time automation with no next run", async () => {
    const store = await createStore();
    store.upsertProject({
      id: "project-1",
      name: "Project",
      path: "D:\\Project",
      createdAt: "2026-07-30T01:00:00.000Z",
      updatedAt: "2026-07-30T01:00:00.000Z",
    });
    store.createAutomation({
      ...automation(),
      schedule: {
        kind: "once",
        at: "2026-07-31T01:30:00.000Z",
        timeZone: "Asia/Shanghai",
      },
      enabled: false,
      nextRunAt: undefined,
    });
    store.createThread({
      id: "thread-once",
      projectId: "project-1",
      title: "One-time review",
      mode: "review",
      target: "local",
      status: "running",
      pinned: false,
      archived: false,
      createdAt: "2026-07-31T01:30:00.000Z",
      updatedAt: "2026-07-31T01:30:00.000Z",
    });
    store.claimAutomationRun(
      {
        id: "run-once",
        automationId: "automation-1",
        scheduledFor: "2026-07-31T01:30:00.000Z",
        trigger: "schedule",
        state: "running",
        threadId: "thread-once",
        createdAt: "2026-07-31T01:30:00.000Z",
        updatedAt: "2026-07-31T01:30:00.000Z",
      },
      { advanceSchedule: false },
    );

    expect(store.completeAutomationRunForThread("thread-once")).toMatchObject({
      run: { id: "run-once", state: "completed" },
      deletedAutomationId: "automation-1",
    });
    expect(store.listAutomations()).toEqual([]);
    expect(store.getAutomation("automation-1")?.deletedAt).toBeDefined();
    expect(store.getThread("thread-once")).toMatchObject({ archived: false });
    store.close();
  });

  it("keeps a recurring automation after its run completes", async () => {
    const store = await createStore();
    store.upsertProject({
      id: "project-1",
      name: "Project",
      path: "D:\\Project",
      createdAt: "2026-07-30T01:00:00.000Z",
      updatedAt: "2026-07-30T01:00:00.000Z",
    });
    store.createAutomation(automation());
    store.createThread({
      id: "thread-recurring",
      projectId: "project-1",
      title: "Recurring review",
      mode: "review",
      target: "local",
      status: "running",
      pinned: false,
      archived: false,
      createdAt: "2026-07-31T01:30:00.000Z",
      updatedAt: "2026-07-31T01:30:00.000Z",
    });
    store.claimAutomationRun(
      {
        id: "run-recurring",
        automationId: "automation-1",
        scheduledFor: "2026-07-31T01:30:00.000Z",
        trigger: "schedule",
        state: "running",
        threadId: "thread-recurring",
        createdAt: "2026-07-31T01:30:00.000Z",
        updatedAt: "2026-07-31T01:30:00.000Z",
      },
      {
        advanceSchedule: true,
        nextRunAt: "2026-08-01T01:30:00.000Z",
      },
    );

    expect(
      store.completeAutomationRunForThread("thread-recurring"),
    ).toMatchObject({
      run: { id: "run-recurring", state: "completed" },
    });
    expect(store.getAutomation("automation-1")?.deletedAt).toBeUndefined();
    expect(store.listAutomations()).toHaveLength(1);
    store.close();
  });
});

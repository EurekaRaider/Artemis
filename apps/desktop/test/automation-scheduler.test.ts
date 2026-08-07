import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import type { Automation } from "@artemis/protocol";
import { AutomationScheduler } from "../src/main/automation-scheduler.js";
import { AppStore } from "../src/main/store.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function storeWithProject(): Promise<AppStore> {
  const directory = await mkdtemp(join(tmpdir(), "artemis-scheduler-"));
  cleanup.push(directory);
  const store = new AppStore(join(directory, "state.sqlite"));
  store.upsertProject({
    id: "project-1",
    name: "Project",
    path: "D:\\Project",
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
  });
  return store;
}

function reviewAutomation(): Automation {
  return {
    id: "automation-1",
    projectId: "project-1",
    name: "Daily review",
    prompt: "Review the workspace.",
    mode: "review",
    target: "local",
    schedule: {
      kind: "weekly",
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      localTime: "09:30",
      timeZone: "Asia/Shanghai",
    },
    enabled: true,
    authorizationState: "not-required",
    nextRunAt: "2026-07-28T01:30:00.000Z",
    createdAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z",
  };
}

describe("AutomationScheduler", () => {
  it("coalesces missed runs and dispatches the latest occurrence once", async () => {
    const store = await storeWithProject();
    store.createAutomation(reviewAutomation());
    const launches: string[] = [];
    const scheduler = new AutomationScheduler({
      store,
      now: () => new Date("2026-07-30T04:00:00.000Z"),
      launch: async (_automation, _run, linkThread) => {
        launches.push("launched");
        store.createThread({
          id: "thread-1",
          projectId: "project-1",
          title: "Scheduled review",
          mode: "review",
          target: "local",
          status: "idle",
          pinned: false,
          archived: false,
          createdAt: "2026-07-30T04:00:00.000Z",
          updatedAt: "2026-07-30T04:00:00.000Z",
        });
        linkThread("thread-1");
      },
    });

    await scheduler.runDue();
    await scheduler.runDue();

    expect(launches).toEqual(["launched"]);
    expect(store.listAutomationRuns("automation-1")).toMatchObject([
      {
        scheduledFor: "2026-07-30T01:30:00.000Z",
        trigger: "catch-up",
        threadId: "thread-1",
      },
    ]);
    expect(store.getAutomation("automation-1")?.nextRunAt).toBe(
      "2026-07-31T01:30:00.000Z",
    );
    store.close();
  });

  it("does not start an unattended Code task without a current authorization", async () => {
    const store = await storeWithProject();
    store.createAutomation({
      ...reviewAutomation(),
      mode: "execute",
      target: "managed-worktree",
      authorizationState: "required",
    });
    let launched = false;
    const scheduler = new AutomationScheduler({
      store,
      now: () => new Date("2026-07-30T04:00:00.000Z"),
      launch: async () => {
        launched = true;
      },
    });

    await scheduler.runDue();

    expect(launched).toBe(false);
    expect(store.listAutomationRuns("automation-1")[0]).toMatchObject({
      state: "skipped",
      reason: "Automation authorization is required.",
    });
    store.close();
  });

  it("disables a one-time automation after its due occurrence is claimed", async () => {
    const store = await storeWithProject();
    store.createAutomation({
      ...reviewAutomation(),
      schedule: {
        kind: "once",
        at: "2026-07-30T03:00:00.000Z",
        timeZone: "Asia/Shanghai",
      },
      nextRunAt: "2026-07-30T03:00:00.000Z",
    });
    const scheduler = new AutomationScheduler({
      store,
      now: () => new Date("2026-07-30T04:00:00.000Z"),
      launch: async (_automation, _run, linkThread) => {
        store.createThread({
          id: "thread-once",
          projectId: "project-1",
          title: "One time",
          mode: "review",
          target: "local",
          status: "idle",
          pinned: false,
          archived: false,
          createdAt: "2026-07-30T04:00:00.000Z",
          updatedAt: "2026-07-30T04:00:00.000Z",
        });
        linkThread("thread-once");
      },
    });

    await scheduler.runDue();

    expect(store.getAutomation("automation-1")).toMatchObject({
      enabled: false,
    });
    expect(store.getAutomation("automation-1")?.nextRunAt).toBeUndefined();
    store.close();
  });
});

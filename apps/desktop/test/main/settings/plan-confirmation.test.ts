import { acceptedPlanPrompt } from "@artemis/protocol";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { AppStore } from "../../../src/main/settings/store.js";
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "artemis-plan-"));
  dirs.push(dir);
  const path = join(dir, "state.sqlite");
  const store = new AppStore(path);
  const now = new Date().toISOString();
  store.createThread({
    id: "t",
    title: "Plan test",
    mode: "plan",
    target: "local",
    status: "running",
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  });
  store.appendEvent(randomUUID(), "t", "p", {
    type: "turn.started",
    mode: "plan",
  });
  const plan = store.proposePlan("t", "p", {
    title: "Repair",
    markdown: "Goal: fix it.\nSteps: inspect, repair.\nAcceptance: tests pass.",
    actionable: true,
  });
  return { store, path, plan };
}
function accept(
  store: AppStore,
  plan: { planId: string; revision: number },
  mode: "work" | "codemode" = "work",
) {
  return store.appendEventsAndUpdateThread(
    "t",
    [
      {
        eventId: randomUUID(),
        turnId: "e",
        payload: { type: "turn.started", mode },
      },
    ],
    { mode, status: "running" },
    {
      threadId: "t",
      turnId: "e",
      text: acceptedPlanPrompt(
        store.plans("t").find((p) => p.planId === plan.planId)!,
      ),
      mode,
      source: "user",
      remote: false,
    },
    { ...plan, mode },
  );
}
it("rejects unfinished or failed plans and rolls back mode and checkpoint", async () => {
  const { store, plan } = await fixture();
  expect(() => accept(store, plan)).toThrow(/PLAN/);
  expect(store.getTurnCheckpoint("t")).toBeUndefined();
  store.appendEvent(randomUUID(), "t", "p", {
    type: "turn.failed",
    message: "broken",
  });
  store.updateThread("t", { status: "failed" });
  expect(() => accept(store, plan)).toThrow(/PLAN/);
  expect(store.getThread("t")?.mode).toBe("plan");
  store.close();
});
it("restores waiting plans; atomically accepts exactly one execution checkpoint", async () => {
  let { store, path, plan } = await fixture();
  store.appendEvent(randomUUID(), "t", "p", {
    type: "turn.completed",
    reason: "completed",
  });
  store.updateThread("t", { status: "idle" });
  store.close();
  store = new AppStore(path);
  expect(store.plans("t").at(-1)?.status).toBe("proposed");
  expect(store.getTurnCheckpoint("t")).toBeUndefined();
  accept(store, plan, "codemode");
  expect(() => accept(store, plan)).toThrow(/PLAN/);
  store.close();
  store = new AppStore(path);
  expect(store.getTurnCheckpoint("t")?.turnId).toBe("e");
  expect(store.plans("t").at(-1)?.executionMode).toBe("codemode");
  expect(
    store
      .getThreadEvents("t")
      .filter((e) => e.payload.type === "plan.accepted"),
  ).toHaveLength(1);
  store.close();
});
it("supersedes on revision submission, never accepts stale cards", async () => {
  const { store, plan } = await fixture();
  store.appendEvent(randomUUID(), "t", "p", {
    type: "turn.completed",
    reason: "completed",
  });
  store.updateThread("t", { status: "idle" });
  store.appendEventsAndUpdateThread(
    "t",
    [
      {
        eventId: randomUUID(),
        turnId: "p2",
        payload: { type: "turn.started", mode: "plan" },
      },
    ],
    { mode: "plan", status: "running" },
    {
      threadId: "t",
      turnId: "p2",
      text: "add tests",
      mode: "plan",
      source: "user",
      remote: false,
    },
  );
  expect(store.plans("t")[0]?.status).toBe("superseded");
  expect(() => accept(store, plan)).toThrow(/PLAN/);
  const revised = store.proposePlan("t", "p2", {
    title: "Repair + tests",
    markdown: "Entire revised plan",
    actionable: true,
  });
  expect(revised.revision).toBe(2);
  store.close();
});

it("refuses automation and goal continuation while awaiting explicit acceptance", async () => {
  const { store } = await fixture();
  store.appendEvent(randomUUID(), "t", "p", {
    type: "turn.completed",
    reason: "completed",
  });
  store.updateThread("t", { status: "idle" });
  for (const mode of ["plan", "work", "codemode"] as const)
    expect(() =>
      store.appendEventsAndUpdateThread(
        "t",
        [],
        { mode, status: "running" },
        {
          threadId: "t",
          turnId: "automatic",
          text: "Continue",
          mode,
          source: "goal-continuation",
          remote: false,
        },
      ),
    ).toThrow(/PLAN_REQUIRES/);
  expect(store.getTurnCheckpoint("t")).toBeUndefined();
  store.close();
});
it("refuses an accepted checkpoint containing only a reference to the plan", async () => {
  const { store, plan } = await fixture();
  store.appendEvent(randomUUID(), "t", "p", {
    type: "turn.completed",
    reason: "completed",
  });
  store.updateThread("t", { status: "idle" });
  expect(() =>
    store.appendEventsAndUpdateThread(
      "t",
      [],
      { mode: "work", status: "running" },
      {
        threadId: "t",
        turnId: "e",
        text: "Execute above",
        mode: "work",
        source: "user",
        remote: false,
      },
      { ...plan, mode: "work" },
    ),
  ).toThrow(/PLAN_ACCEPT/);
  expect(store.plans("t")[0]?.status).toBe("proposed");
  store.close();
});

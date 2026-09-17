import { expect, it } from "vitest";
import {
  ImDelegationWaits,
  type DelegationWait,
} from "../src/main/im-delegation-waits.js";

function fixture() {
  const records = new Map<string, DelegationWait>();
  const store = {
    list: () => [...records.values()],
    put: (w: DelegationWait) => records.set(w.id, structuredClone(w)),
  };
  return { records, store, waits: new ImDelegationWaits(store) };
}
const task = (id = "a", state = "running", attempt = "attempt-1") => ({
  id,
  state,
  threadId: "thread",
  direction: "outgoing",
  envelope: { id: attempt },
  result: state === "completed" ? "result" : "",
});
const register = (f: ReturnType<typeof fixture>) =>
  f.waits.register(
    "wait",
    "thread",
    "group",
    [task()],
    "Summarize results",
    "security",
  );
it("persists a wait across restart and ignores unrelated results and progress", () => {
  const f = fixture();
  register(f);
  const restored = new ImDelegationWaits(f.store);
  restored.update("group", [task(), task("other", "completed")]);
  expect(restored.active("thread")[0]?.state).toBe("waiting");
  restored.update("group", [task("a", "completed")]);
  expect(restored.active("thread")[0]).toMatchObject({
    state: "ready",
    results: [{ id: "a", result: "result" }],
  });
});
it("waits for all results, and wakes on failure", () => {
  const f = fixture();
  f.waits.register(
    "wait",
    "thread",
    "group",
    [task(), task("b")],
    "Continue",
    "security",
  );
  f.waits.update("group", [task("a", "completed"), task("b")]);
  expect(f.waits.active("thread")[0]?.state).toBe("waiting");
  f.waits.update("group", [task("a", "completed"), task("b", "failed")]);
  expect(f.waits.active("thread")[0]?.state).toBe("ready");
});
it("does not resurrect cancelled or consumed waits on duplicate and late results", () => {
  const f = fixture();
  register(f);
  f.waits.cancelTask("thread", "a");
  f.waits.update("group", [task("a", "completed")]);
  expect(f.waits.active("thread")).toEqual([]);
  f.waits.register("next", "thread", "group", [task()], "Continue", "security");
  f.waits.consume("next");
  f.waits.update("group", [task("a", "completed")]);
  expect(f.waits.active("thread")).toEqual([]);
});
it("binds the attempt as well as task ID and rejects foreign tasks", () => {
  const f = fixture();
  register(f);
  f.waits.update("group", [task("a", "completed", "attempt-2")]);
  expect(f.waits.active("thread")[0]?.state).toBe("waiting");
  expect(() =>
    f.waits.register(
      "bad",
      "other-thread",
      "group",
      [task()],
      "Continue",
      "security",
    ),
  ).toThrow();
});
it("accepts results that arrived before registration and deduplicates tool retries", () => {
  const f = fixture();
  f.waits.register(
    "wait",
    "thread",
    "group",
    [task("a", "completed")],
    "Continue",
    "security",
  );
  expect(f.waits.active("thread")[0]?.state).toBe("ready");
  f.waits.consume("wait");
  f.waits.register("wait", "thread", "group", [task()], "Continue", "security");
  expect(f.waits.active("thread")).toEqual([]);
});

it("wakes on the waiting deadline without claiming the remote task was cancelled", () => {
  const f = fixture();
  register(f);
  const wait = f.records.get("wait")!;
  f.store.put({ ...wait, deadline: Date.now() - 1 });
  f.waits.update("group", []);
  expect(f.waits.active("thread")[0]).toMatchObject({
    state: "ready",
    results: [
      {
        state: "timeout",
        result: expect.stringContaining("has not been cancelled"),
      },
    ],
  });
});

it("keeps a cancellation tombstone after dispatch and scopes cancellation to its task", () => {
  const f = fixture();
  register(f);
  f.waits.register(
    "other",
    "thread",
    "group",
    [task("b")],
    "Other",
    "security",
  );
  f.waits.consume("wait");
  expect(f.waits.cancelTask("thread", "a")).toContain("wait");
  f.waits.consume("wait");
  expect(f.records.get("wait")?.state).toBe("cancelled");
  expect(f.waits.active("thread").map((w) => w.id)).toEqual(["other"]);
  const restored = new ImDelegationWaits(f.store);
  restored.update("group", [task("a", "completed"), task("b")]);
  expect(restored.active("thread").map((w) => w.id)).toEqual(["other"]);
});

it("distinguishes fresh task heartbeats from stale unknown status and requires an explicit choice", () => {
  const f = fixture();
  const now = Date.now();
  register(f);
  const saved = f.records.get("wait")!;
  f.records.set("wait", { ...saved, heartbeatGraceUntil: now - 1 });
  f.waits.update("group", [{ ...task(), heartbeatAt: now }]);
  expect(f.waits.active("thread")[0]?.state).toBe("waiting");
  f.waits.update("group", [{ ...task(), heartbeatAt: now - 181_000 }]);
  expect(f.waits.active("thread")[0]?.results[0]).toMatchObject({
    state: "timeout",
  });
  f.waits.interrupt("wait");
  f.waits.update("group", [{ ...task(), heartbeatAt: now }]);
  expect(f.waits.active("thread")).toEqual([]);
  f.waits.continueWaiting("wait");
  f.waits.update("group", [{ ...task(), heartbeatAt: now - 181_000 }]);
  expect(f.waits.active("thread")[0]?.state).toBe("waiting");
});

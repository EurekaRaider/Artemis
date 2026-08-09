import { describe, expect, it } from "vitest";

import { AgentConcurrencyLimiter } from "../src/agent-concurrency.js";
import { ArtemisAgentHost } from "../src/runtime.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("AgentConcurrencyLimiter", () => {
  it("applies validated runtime limits while preserving one child slot", () => {
    const host = new ArtemisAgentHost(
      { request: async () => ({ approved: false }) },
      { emit() {} },
      { agentConcurrencyLimit: 2 },
    );
    expect(host.concurrencyStatus()).toMatchObject({
      active: 0,
      activeParents: 0,
      queued: 0,
      limit: 2,
    });
    expect(host.setConcurrencyLimit(64)).toMatchObject({ limit: 64 });
    expect(() => host.setConcurrencyLimit(1)).toThrow("2 to 64");
    expect(() => host.setConcurrencyLimit(65)).toThrow("2 to 64");
  });

  it("queues 64 logical members behind a 16-slot automatic ceiling", async () => {
    const limiter = new AgentConcurrencyLimiter(16);
    const gate = deferred();
    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 64 }, () =>
      limiter.run("child", async () => {
        active += 1;
        peak = Math.max(peak, active);
        await gate.promise;
        active -= 1;
      }),
    );

    await flush();
    expect(limiter.snapshot).toMatchObject({
      active: 16,
      queued: 48,
      limit: 16,
    });
    gate.resolve();
    await Promise.all(tasks);
    expect(peak).toBe(16);
    expect(limiter.snapshot).toMatchObject({ active: 0, queued: 0 });
  });

  it("reserves capacity for a child when parent turns are queued", async () => {
    const limiter = new AgentConcurrencyLimiter(10, 9);
    const parentGate = deferred();
    const childGate = deferred();
    const parents = Array.from({ length: 10 }, () =>
      limiter.run("parent", () => parentGate.promise),
    );
    let childStarted = false;
    const child = limiter.run("child", async () => {
      childStarted = true;
      await childGate.promise;
    });

    await flush();
    expect(childStarted).toBe(true);
    expect(limiter.snapshot).toMatchObject({
      active: 10,
      activeParents: 9,
      queued: 1,
    });
    childGate.resolve();
    parentGate.resolve();
    await Promise.all([...parents, child]);
  });

  it("removes a cancelled child while it is still queued", async () => {
    const limiter = new AgentConcurrencyLimiter(1, 1);
    const gate = deferred();
    const active = limiter.run("child", () => gate.promise);
    const controller = new AbortController();
    let queuedStarted = false;
    const queued = limiter.run(
      "child",
      async () => {
        queuedStarted = true;
      },
      controller.signal,
    );

    await flush();
    expect(limiter.snapshot).toMatchObject({ active: 1, queued: 1 });
    controller.abort();

    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    expect(queuedStarted).toBe(false);
    expect(limiter.snapshot).toMatchObject({ active: 1, queued: 0 });
    gate.resolve();
    await active;
  });

  it("raises the limit immediately and lowers it without cancelling active work", async () => {
    const limiter = new AgentConcurrencyLimiter(2, 1);
    const gates = [deferred(), deferred(), deferred()];
    const started: number[] = [];
    const tasks = gates.map((gate, index) =>
      limiter.run("child", async () => {
        started.push(index);
        await gate.promise;
      }),
    );

    await flush();
    expect(started).toEqual([0, 1]);
    expect(limiter.setLimits(3, 2)).toMatchObject({ active: 3, limit: 3 });
    await flush();
    expect(started).toEqual([0, 1, 2]);

    expect(limiter.setLimits(2, 1)).toMatchObject({ active: 3, limit: 2 });
    gates[0]!.resolve();
    await flush();
    expect(limiter.snapshot).toMatchObject({ active: 2, limit: 2 });
    gates[1]!.resolve();
    gates[2]!.resolve();
    await Promise.all(tasks);
  });

  it("lets a parent wait for four children with a two-slot limit", async () => {
    const limiter = new AgentConcurrencyLimiter(2, 1);
    let activeChildren = 0;
    let peakChildren = 0;
    const parent = limiter.run("parent", async () => {
      await Promise.all(
        Array.from({ length: 4 }, () =>
          limiter.run("child", async () => {
            activeChildren += 1;
            peakChildren = Math.max(peakChildren, activeChildren);
            await Promise.resolve();
            activeChildren -= 1;
          }),
        ),
      );
    });

    await parent;
    await flush();
    expect(peakChildren).toBe(1);
    expect(limiter.snapshot).toMatchObject({ active: 0, queued: 0, limit: 2 });
  });

  it("releases leases across a five-level delegation chain with a two-slot limit", async () => {
    const limiter = new AgentConcurrencyLimiter(2, 1);
    const visited: number[] = [];
    const delegate = (depth: number): Promise<void> =>
      limiter.run("child", async (lease) => {
        visited.push(depth);
        if (depth < 5) {
          await lease.suspend(() => delegate(depth + 1));
        }
      });

    await limiter.run("parent", (lease) => lease.suspend(() => delegate(1)));

    expect(visited).toEqual([1, 2, 3, 4, 5]);
    expect(limiter.snapshot).toMatchObject({
      active: 0,
      waiting: 0,
      queued: 0,
      limit: 2,
    });
  });

  it("round-robins queued work across task keys", async () => {
    const limiter = new AgentConcurrencyLimiter(1, 1);
    const gate = deferred();
    const first = limiter.run("child", () => gate.promise, undefined, "seed");
    const order: string[] = [];
    const queued = [
      limiter.run("child", async () => void order.push("a1"), undefined, "a"),
      limiter.run("child", async () => void order.push("a2"), undefined, "a"),
      limiter.run("child", async () => void order.push("b1"), undefined, "b"),
    ];

    await flush();
    gate.resolve();
    await first;
    await Promise.all(queued);
    expect(order).toEqual(["a1", "b1", "a2"]);
  });

  it("admits a queued root before filling the last slot with child work", async () => {
    const limiter = new AgentConcurrencyLimiter(1, 1);
    const gate = deferred();
    const activeChild = limiter.run(
      "child",
      () => gate.promise,
      undefined,
      "a",
    );
    const starts: string[] = [];
    const queuedChild = limiter.run(
      "child",
      async () => void starts.push("child"),
      undefined,
      "a",
    );
    const rootGate = deferred();
    const root = limiter.run(
      "parent",
      async () => {
        starts.push("root");
        await rootGate.promise;
      },
      undefined,
      "root",
    );

    limiter.setLimits(2, 1);
    await flush();
    expect(starts).toEqual(["root"]);
    rootGate.resolve();
    gate.resolve();
    await Promise.all([activeChild, queuedChild, root]);
    expect(starts).toEqual(["root", "child"]);
  });
});

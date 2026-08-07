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
    expect(host.setConcurrencyLimit(16)).toMatchObject({ limit: 16 });
    expect(() => host.setConcurrencyLimit(1)).toThrow("2 to 16");
    expect(() => host.setConcurrencyLimit(17)).toThrow("2 to 16");
  });

  it("never runs more than ten child agents", async () => {
    const limiter = new AgentConcurrencyLimiter(10);
    const gate = deferred();
    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 25 }, () =>
      limiter.run("child", async () => {
        active += 1;
        peak = Math.max(peak, active);
        await gate.promise;
        active -= 1;
      }),
    );

    await flush();
    expect(limiter.snapshot).toMatchObject({
      active: 10,
      queued: 15,
      limit: 10,
    });
    gate.resolve();
    await Promise.all(tasks);
    expect(peak).toBe(10);
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
});

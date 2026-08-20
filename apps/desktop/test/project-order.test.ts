import { describe, expect, it } from "vitest";

import {
  createProjectOrderPersistenceQueue,
  orderProjectsByPreference,
  reorderProjectIds,
} from "../src/renderer/project-order.js";

const projects = [
  { id: "alpha", name: "Alpha" },
  { id: "beta", name: "Beta" },
  { id: "gamma", name: "Gamma" },
];

describe("project sidebar order", () => {
  it("keeps the default order until a persisted preference exists", () => {
    expect(orderProjectsByPreference(projects, undefined)).toEqual(projects);
    expect(
      orderProjectsByPreference(projects, ["gamma", "alpha"]).map(
        (project) => project.id,
      ),
    ).toEqual(["gamma", "alpha", "beta"]);
  });

  it("moves projects before or after the indicated drop edge", () => {
    expect(
      reorderProjectIds(["alpha", "beta", "gamma"], "gamma", "alpha", "before"),
    ).toEqual(["gamma", "alpha", "beta"]);
    expect(
      reorderProjectIds(["alpha", "beta", "gamma"], "alpha", "beta", "after"),
    ).toEqual(["beta", "alpha", "gamma"]);
  });

  it("ignores invalid and no-op drag targets", () => {
    expect(
      reorderProjectIds(
        ["alpha", "beta", "gamma"],
        "missing",
        "beta",
        "before",
      ),
    ).toEqual(["alpha", "beta", "gamma"]);
    expect(
      reorderProjectIds(["alpha", "beta", "gamma"], "beta", "beta", "after"),
    ).toEqual(["alpha", "beta", "gamma"]);
  });

  it("serializes rapid saves and applies only the newest response", async () => {
    let activeSaves = 0;
    let maximumActiveSaves = 0;
    const releaseSave: Array<() => void> = [];
    const savedOrders: string[][] = [];
    const appliedOrders: string[][] = [];
    const queue = createProjectOrderPersistenceQueue({
      save: async (order) => {
        activeSaves += 1;
        maximumActiveSaves = Math.max(maximumActiveSaves, activeSaves);
        savedOrders.push(order);
        await new Promise<void>((resolve) => releaseSave.push(resolve));
        activeSaves -= 1;
        return order;
      },
      onPersisted: (order) => appliedOrders.push(order),
      onRejected: () => undefined,
    });
    queue.initialize(["alpha", "beta", "gamma"]);

    const first = queue.persist(
      ["beta", "alpha", "gamma"],
      ["alpha", "beta", "gamma"],
    );
    const second = queue.persist(
      ["beta", "gamma", "alpha"],
      ["beta", "alpha", "gamma"],
    );
    await Promise.resolve();

    expect(savedOrders).toEqual([["beta", "alpha", "gamma"]]);
    releaseSave.shift()?.();
    await first;
    expect(savedOrders).toEqual([
      ["beta", "alpha", "gamma"],
      ["beta", "gamma", "alpha"],
    ]);
    releaseSave.shift()?.();
    await second;

    expect(maximumActiveSaves).toBe(1);
    expect(appliedOrders).toEqual([["beta", "gamma", "alpha"]]);
  });

  it("rolls the newest failed save back to the last persisted order", async () => {
    const appliedOrders: string[][] = [];
    const rejectedOrders: string[][] = [];
    let saves = 0;
    const queue = createProjectOrderPersistenceQueue({
      save: async (order) => {
        saves += 1;
        if (saves === 2) throw new Error("disk unavailable");
        return order;
      },
      onPersisted: (order) => appliedOrders.push(order),
      onRejected: (order) => rejectedOrders.push(order),
    });
    queue.initialize(["alpha", "beta", "gamma"]);

    const first = queue.persist(
      ["beta", "alpha", "gamma"],
      ["alpha", "beta", "gamma"],
    );
    const second = queue.persist(
      ["beta", "gamma", "alpha"],
      ["beta", "alpha", "gamma"],
    );
    await Promise.all([first, second]);

    expect(appliedOrders).toEqual([]);
    expect(rejectedOrders).toEqual([["beta", "alpha", "gamma"]]);
  });
});

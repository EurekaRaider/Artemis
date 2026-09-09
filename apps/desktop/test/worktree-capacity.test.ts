import { describe, expect, it } from "vitest";
import { WorktreeCapacity } from "../src/main/worktree-capacity.js";

describe("global worktree capacity", () => {
  it("rejects duplicate concurrent creation without releasing its reserved slot", () => {
    const capacity = new WorktreeCapacity();
    capacity.reserve("same-task", []);
    expect(() => capacity.reserve("same-task", [])).toThrow("already exists");
    for (let i = 0; i < 9; i++) capacity.reserve(`other-${i}`, []);
    expect(() => capacity.reserve("extra", [])).toThrow("WORKTREE_LIMIT");
  });

  it("allows ten reservations across projects and blocks the eleventh", () => {
    const capacity = new WorktreeCapacity();
    const releases = Array.from({ length: 10 }, (_, i) =>
      capacity.reserve(`project-${i}/task`, []),
    );
    expect(() => capacity.reserve("extra", [])).toThrow("WORKTREE_LIMIT");
    releases[0]!();
    expect(() => capacity.reserve("retry", [])).not.toThrow();
  });
  it("does not double count persisted reservations and frees deleted slots", () => {
    const capacity = new WorktreeCapacity();
    capacity.reserve("one", []);
    const ids = ["one", ...Array.from({ length: 8 }, (_, i) => `task-${i}`)];
    capacity.reserve("ten", ids);
    expect(() => capacity.reserve("extra", [...ids, "ten"])).toThrow(
      "WORKTREE_LIMIT",
    );
    expect(() => capacity.reserve("after-cleanup", ids)).not.toThrow();
  });
});

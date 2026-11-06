import { describe, expect, it, vi } from "vitest";
import type { Thread } from "@artemis/protocol";
import { AppStore } from "../../../src/main/settings/store.js";

function thread(id: string): Thread {
  const now = new Date().toISOString();
  return {
    id,
    title: id,
    mode: "plan",
    target: "local",
    status: "running",
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
}

describe("AppStore repository boundaries", () => {
  it("rolls back project and conversation writes in the same plugin transaction", () => {
    const store = new AppStore(":memory:");
    const now = new Date().toISOString();
    try {
      expect(() =>
        store.commitPluginStateTransaction(() => {
          store.upsertProject({
            id: "project",
            name: "Project",
            path: "/transaction-project",
            createdAt: now,
            updatedAt: now,
          });
          store.createThread({ ...thread("task"), projectId: "project" });
          store.appendEvent("event", "task", "turn", {
            type: "turn.started",
            mode: "plan",
          });
          throw new Error("abort transaction");
        }),
      ).toThrow("abort transaction");
      expect(store.getProject("project")).toBeUndefined();
      expect(store.getThread("task")).toBeUndefined();
      expect(store.getThreadEvents("task")).toEqual([]);
    } finally {
      store.close();
    }
  });

  it("uses the current facade method when one repository calls another", () => {
    const store = new AppStore(":memory:");
    try {
      store.createThread(thread("task"));
      const lookup = vi
        .spyOn(store, "getThread")
        .mockReturnValue({ ...thread("task"), mode: "work" });
      expect(() =>
        store.proposePlan("task", "turn", {
          title: "Plan",
          markdown: "Do the work",
          actionable: true,
        }),
      ).toThrow("PLAN_MODE_REQUIRED");
      expect(lookup).toHaveBeenCalledWith("task");
      lookup.mockRestore();
      expect(
        store.proposePlan("task", "turn", {
          title: "Plan",
          markdown: "Do the work",
          actionable: true,
        }).sourceTurnId,
      ).toBe("turn");
    } finally {
      store.close();
    }
  });
});

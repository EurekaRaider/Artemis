import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";
import {
  createImStateRepository,
  initializeReceiptIndexes,
  queueNativeDeletions,
} from "../../../src/main/im/im-state-repository.js";

it("decodes only actionable receipts and queues each deleted native task once", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(
      "CREATE TABLE im_state(namespace TEXT, id TEXT, value TEXT, version INTEGER DEFAULT 1, PRIMARY KEY(namespace,id))",
    );
    const decodeState = vi.fn(JSON.parse);
    const state = createImStateRepository({ db, decodeState } as Parameters<
      typeof createImStateRepository
    >[0]);
    state.put("receipts", "p", { request: { id: "p" }, state: "pending" });
    state.put("receipts", "d", {
      request: { id: "d", nativeTaskId: "n" },
      threadId: "gone",
      state: "done",
    });
    state.put("receipts", "x", {
      request: { id: "x" },
      threadId: "gone",
      state: "done",
    });
    initializeReceiptIndexes(db);
    expect(state.receipts("pending")).toHaveLength(1);
    expect(decodeState).toHaveBeenCalledTimes(1);
    queueNativeDeletions(db, "gone");
    queueNativeDeletions(db, "gone");
    expect(state.list("pending-native-deletions")).toEqual([
      { invocationId: "d", threadId: "gone" },
    ]);
    expect(state.get("receipts", "d")).toBeDefined();
  } finally {
    db.close();
  }
});

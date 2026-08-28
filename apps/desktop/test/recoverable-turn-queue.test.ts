import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { RecoverableTurnQueues } from "../src/main/recoverable-turn-queue.js";

const screenshot = {
  name: "screenshot.png",
  mimeType: "image/png" as const,
  data: "iVBORw==",
};

describe("recoverable turn queues", () => {
  it("restores the mirrored queue before marking a crashed Host turn failed", () => {
    const mainSource = readFileSync(
      fileURLToPath(new URL("../src/main/main.ts", import.meta.url)),
      "utf8",
    );
    const start = mainSource.indexOf(
      "function interruptTurnsAfterAgentHostExit",
    );
    const end = mainSource.indexOf("function restartAgentHost", start);
    const recovery = mainSource.slice(start, end);

    expect(recovery.indexOf('type: "queue.recovered"')).toBeGreaterThan(-1);
    expect(recovery.indexOf('type: "queue.updated"')).toBeGreaterThan(
      recovery.indexOf('type: "queue.recovered"'),
    );
    expect(recovery.indexOf('type: "turn.failed"')).toBeGreaterThan(
      recovery.indexOf('type: "queue.updated"'),
    );
  });

  it("preserves original attachments across queue moves and host recovery", () => {
    const queues = new RecoverableTurnQueues();
    queues.add("thread-1", "followUp", "inspect screenshot", [screenshot]);

    queues.reconcile("thread-1", ["inspect screenshot"], []);
    queues.reconcile("thread-1", [], []);

    expect(queues.recover("thread-1", ["inspect screenshot"])).toEqual([
      { text: "inspect screenshot", attachments: [screenshot] },
    ]);
  });

  it("restores only the queue that was still active when the host exited", () => {
    const queues = new RecoverableTurnQueues();
    queues.add("thread-1", "steering", "already consumed", [screenshot]);
    queues.add("thread-1", "followUp", "still queued");
    queues.reconcile("thread-1", [], ["still queued"]);

    expect(queues.recover("thread-1")).toEqual([{ text: "still queued" }]);
    expect(queues.recover("thread-1")).toEqual([]);
  });

  it("removes a request that the Agent Host rejected before enqueueing", () => {
    const queues = new RecoverableTurnQueues();
    const id = queues.add("thread-1", "followUp", "rejected", [screenshot]);

    queues.remove("thread-1", id);

    expect(queues.recover("thread-1")).toEqual([]);
  });
});

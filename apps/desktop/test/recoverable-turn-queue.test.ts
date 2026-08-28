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

  it("preserves source attachments across follow-up edit, delete, and reorder", () => {
    const queues = new RecoverableTurnQueues();
    const secondScreenshot = { ...screenshot, data: "c2Vjb25k" };
    queues.add("thread-1", "followUp", "First", [screenshot]);
    queues.add("thread-1", "followUp", "Second", [secondScreenshot]);
    queues.add("thread-1", "followUp", "Delete me");

    queues.replaceFollowUp(
      "thread-1",
      ["First", "Second", "Delete me"],
      [
        { sourceIndex: 1, text: "Edited second" },
        { sourceIndex: 0, text: "First" },
      ],
      (text) => text,
    );
    queues.reconcile("thread-1", [], ["Edited second", "First"]);

    expect(queues.recover("thread-1")).toEqual([
      { text: "Edited second", attachments: [secondScreenshot] },
      { text: "First", attachments: [screenshot] },
    ]);
  });

  it("rolls back a prepared replacement only while its revision is current", () => {
    const queues = new RecoverableTurnQueues();
    queues.add("thread-1", "followUp", "First", [screenshot]);
    const rollback = queues.replaceFollowUp(
      "thread-1",
      ["First"],
      [{ sourceIndex: 0, text: "Edited" }],
      (text) => text,
    );

    queues.rollbackFollowUp(rollback);
    expect(queues.recover("thread-1")).toEqual([
      { text: "First", attachments: [screenshot] },
    ]);
  });

  it("keeps PromptFile recovery data separate from Pi's expanded queue text", () => {
    const queues = new RecoverableTurnQueues();
    const file = {
      type: "file" as const,
      name: "notes.txt",
      mimeType: "text/plain",
      content: "evidence",
    };
    const runtimeTextFor = (text: string) => `${text}\n\n[file:evidence]`;
    queues.add(
      "thread-1",
      "followUp",
      "Inspect notes",
      [file],
      runtimeTextFor("Inspect notes"),
    );

    expect(
      queues.reconcile("thread-1", [], [runtimeTextFor("Inspect notes")]),
    ).toEqual({ steering: [], followUp: ["Inspect notes"] });
    const replacement = queues.replaceFollowUp(
      "thread-1",
      ["Inspect notes"],
      [{ sourceIndex: 0, text: "Summarize notes" }],
      runtimeTextFor,
    );

    expect(replacement.runtimeExpectedFollowUp).toEqual([
      runtimeTextFor("Inspect notes"),
    ]);
    expect(replacement.runtimeFollowUp).toEqual([
      { sourceIndex: 0, text: runtimeTextFor("Summarize notes") },
    ]);
    expect(
      queues.reconcile("thread-1", [], [runtimeTextFor("Summarize notes")]),
    ).toEqual({ steering: [], followUp: ["Summarize notes"] });
    expect(
      queues.runtimeFollowUpSnapshot("thread-1", ["Summarize notes"]),
    ).toEqual([runtimeTextFor("Summarize notes")]);
    expect(
      queues.recover("thread-1", [runtimeTextFor("Summarize notes")]),
    ).toEqual([{ text: "Summarize notes", attachments: [file] }]);
  });
});

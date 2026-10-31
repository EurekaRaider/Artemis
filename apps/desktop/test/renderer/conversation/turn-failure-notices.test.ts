import { describe, expect, it } from "vitest";
import { createThreadViewState } from "@artemis/protocol";

import {
  latestFailedTurnPrompt,
  reduceTurnFailureNotices,
} from "../../../src/renderer/conversation/turn-failure-notices.js";

describe("turn failure notices", () => {
  it("offers only the last user prompt owned by the latest failed turn", () => {
    const state = createThreadViewState("thread");
    state.turnOrder = ["old", "failed"];
    state.turns = {
      old: {
        id: "old",
        mode: "work",
        status: "completed",
        order: ["user:old"],
      },
      failed: {
        id: "failed",
        mode: "work",
        status: "failed",
        order: ["user:first", "user:latest", "part:reply"],
      },
    };
    state.userMessages = {
      old: { id: "old", text: "Unrelated earlier work" },
      first: { id: "first", text: "Original prompt" },
      latest: { id: "latest", text: "Latest failed-turn prompt" },
    };
    expect(latestFailedTurnPrompt(state)).toBe("Latest failed-turn prompt");
    state.turns.failed!.order = [];
    expect(latestFailedTurnPrompt(state)).toBeUndefined();
    state.turns.failed!.status = "completed";
    expect(latestFailedTurnPrompt(state)).toBeUndefined();
    expect(latestFailedTurnPrompt(undefined)).toBeUndefined();
  });
  it("keeps the latest failure isolated by thread", () => {
    const first = reduceTurnFailureNotices(
      {},
      {
        type: "failed",
        threadId: "thread-a",
        message: "first",
      },
    );
    const second = reduceTurnFailureNotices(first, {
      type: "failed",
      threadId: "thread-b",
      message: "other",
    });
    const latest = reduceTurnFailureNotices(second, {
      type: "failed",
      threadId: "thread-a",
      message: "latest",
    });

    expect(latest).toEqual({
      "thread-a": "latest",
      "thread-b": "other",
    });
  });

  it("clears only the started or dismissed thread", () => {
    const notices = { "thread-a": "failed", "thread-b": "also failed" };
    expect(
      reduceTurnFailureNotices(notices, {
        type: "started",
        threadId: "thread-a",
      }),
    ).toEqual({ "thread-b": "also failed" });
    expect(
      reduceTurnFailureNotices(notices, {
        type: "dismiss",
        threadId: "thread-b",
      }),
    ).toEqual({ "thread-a": "failed" });
  });
});

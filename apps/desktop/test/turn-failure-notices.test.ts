import { describe, expect, it } from "vitest";

import { reduceTurnFailureNotices } from "../src/renderer/turn-failure-notices.js";

describe("turn failure notices", () => {
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

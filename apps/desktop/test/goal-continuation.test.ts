import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  GOAL_CONTINUATION_RETRY_DELAY_MILLISECONDS,
  goalFailureDisposition,
} from "../src/main/goal-continuation.js";

describe("Goal continuation failure policy", () => {
  it("does not bypass the three-turn blocker recorder in main-process recovery", () => {
    const mainSource = readFileSync(
      fileURLToPath(new URL("../src/main/main.ts", import.meta.url)),
      "utf8",
    );

    expect(mainSource).not.toContain(".markThreadGoalBlocked(");
  });

  it("keeps transient infrastructure failures retryable instead of blocking", () => {
    expect(
      goalFailureDisposition({
        type: "turn.failed",
        code: "AGENT_HOST_INTERRUPTED",
        message: "Agent Host restarted",
      }),
    ).toBe("retry");
    expect(
      goalFailureDisposition({
        type: "turn.failed",
        code: "MODEL_STREAM_STALLED",
        message: "Model stream stalled",
      }),
    ).toBe("retry");
    expect(GOAL_CONTINUATION_RETRY_DELAY_MILLISECONDS).toBe(5_000);
  });

  it("reserves usage-limited for quota and rate-limit failures", () => {
    expect(
      goalFailureDisposition({
        type: "turn.failed",
        code: "RATE_LIMITED",
        message: "Provider is temporarily unavailable",
      }),
    ).toBe("usage-limited");
    expect(
      goalFailureDisposition({
        type: "turn.failed",
        message: "429 quota exceeded",
      }),
    ).toBe("usage-limited");
  });
});

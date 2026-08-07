import { describe, expect, it } from "vitest";

import {
  PendingUserInputRegistry,
  USER_INPUT_TIMEOUT_MILLISECONDS,
} from "../src/main/user-input-policy.js";

const options = [
  {
    label: "Measure first",
    description: "Build a baseline before changing code.",
    recommended: true,
  },
  {
    label: "Implement now",
    description: "Start with the suspected hotspot.",
    recommended: false,
  },
];

describe("PendingUserInputRegistry", () => {
  it("uses the single recommended option for the five-minute fallback", () => {
    const registry = new PendingUserInputRegistry<{
      workerRequestId: string;
    }>();
    registry.register({
      requestId: "input-1",
      nonce: "1234567890abcdef",
      options,
      value: { workerRequestId: "worker-1" },
    });

    expect(USER_INPUT_TIMEOUT_MILLISECONDS).toBe(300_000);
    expect(registry.consumeRecommended("input-1", "1234567890abcdef")).toEqual({
      value: { workerRequestId: "worker-1" },
      answer: "Measure first",
      selectedOption: 0,
    });
    expect(registry.size).toBe(0);
  });

  it("accepts a custom answer and rejects an option that was not offered", () => {
    const registry = new PendingUserInputRegistry<string>();
    registry.register({
      requestId: "input-1",
      nonce: "1234567890abcdef",
      options,
      value: "pending",
    });
    expect(() =>
      registry.consume({
        requestId: "input-1",
        nonce: "1234567890abcdef",
        selectedOption: 2,
      }),
    ).toThrow(/not offered/i);
    expect(registry.size).toBe(1);

    expect(
      registry.consume({
        requestId: "input-1",
        nonce: "1234567890abcdef",
        customAnswer: "Keep both targets",
      }),
    ).toMatchObject({ answer: "Keep both targets" });
  });

  it("rejects missing recommendations and cancels only matching tasks", () => {
    const registry = new PendingUserInputRegistry<{ threadId: string }>();
    expect(() =>
      registry.register({
        requestId: "invalid",
        nonce: "1234567890abcdef",
        options: options.map((option) => ({
          ...option,
          recommended: false,
        })),
        value: { threadId: "thread-1" },
      }),
    ).toThrow(/exactly one/i);

    for (const [requestId, threadId] of [
      ["input-1", "thread-1"],
      ["input-2", "thread-2"],
    ]) {
      registry.register({
        requestId,
        nonce: `nonce-${requestId}-123456`,
        options,
        value: { threadId },
      });
    }
    expect(
      registry.cancelWhere((value) => value.threadId === "thread-1"),
    ).toHaveLength(1);
    expect(registry.size).toBe(1);
  });
});

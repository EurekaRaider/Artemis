import { describe, expect, it } from "vitest";

import {
  PendingMultiUserInputRegistry,
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

describe("PendingMultiUserInputRegistry", () => {
  const questionOptions = (recommendedLabel: string) => [
    {
      label: recommendedLabel,
      description: `Choose ${recommendedLabel}.`,
      recommended: true,
    },
    {
      label: "Alternative",
      description: "The other path.",
      recommended: false,
    },
  ];

  const multiQuestions = [
    { questionId: "q1", options: questionOptions("Ship now") },
    { questionId: "q2", options: questionOptions("Ship later") },
  ];

  it("registers per-question snapshots and validates each question", () => {
    const registry = new PendingMultiUserInputRegistry<{ threadId: string }>();
    registry.register({
      requestId: "multi-1",
      nonce: "multi-nonce-000001",
      questions: multiQuestions,
      value: { threadId: "thread-1" },
    });
    expect(registry.size).toBe(1);

    expect(() =>
      registry.register({
        requestId: "multi-1",
        nonce: "multi-nonce-000002",
        questions: multiQuestions,
        value: { threadId: "thread-1" },
      }),
    ).toThrow(/already pending/i);

    expect(() =>
      registry.register({
        requestId: "multi-2",
        nonce: "multi-nonce-000003",
        questions: [
          { questionId: "q1", options: questionOptions("Ship now") },
          {
            questionId: "q2",
            options: questionOptions("Ship now").map((option) => ({
              ...option,
              recommended: false,
            })),
          },
        ],
        value: { threadId: "thread-2" },
      }),
    ).toThrow(/exactly one/i);

    expect(() =>
      registry.register({
        requestId: "multi-3",
        nonce: "multi-nonce-000004",
        questions: [
          { questionId: "q1", options: questionOptions("Ship now") },
          { questionId: "q1", options: questionOptions("Ship now") },
        ],
        value: { threadId: "thread-3" },
      }),
    ).toThrow(/unique/i);

    expect(registry.size).toBe(1);
  });

  it("consumes one question at a time by question id and nonce", () => {
    const registry = new PendingMultiUserInputRegistry<string>();
    registry.register({
      requestId: "multi-1",
      nonce: "multi-nonce-000001",
      questions: multiQuestions,
      value: "pending",
    });

    expect(() =>
      registry.consumeQuestion({
        requestId: "multi-1",
        nonce: "wrong-nonce-00001",
        questionId: "q1",
        selectedOptionLabel: "Ship now",
      }),
    ).toThrow(/nonce/i);

    expect(() =>
      registry.consumeQuestion({
        requestId: "multi-1",
        nonce: "multi-nonce-000001",
        questionId: "missing",
        selectedOptionLabel: "Ship now",
      }),
    ).toThrow(/not offered/i);

    expect(() =>
      registry.consumeQuestion({
        requestId: "multi-1",
        nonce: "multi-nonce-000001",
        questionId: "q1",
        selectedOptionLabel: "Never offered",
      }),
    ).toThrow(/not offered/i);

    const first = registry.consumeQuestion({
      requestId: "multi-1",
      nonce: "multi-nonce-000001",
      questionId: "q1",
      selectedOptionLabel: "Ship now",
    });
    expect(first).toMatchObject({
      questionId: "q1",
      answer: "Ship now",
      selectedOptionLabel: "Ship now",
      value: "pending",
    });
    expect(first.final).toBeUndefined();

    expect(() =>
      registry.consumeQuestion({
        requestId: "multi-1",
        nonce: "multi-nonce-000001",
        questionId: "q1",
        selectedOptionLabel: "Ship now",
      }),
    ).toThrow(/no longer pending/i);
    expect(registry.size).toBe(1);
  });

  it("resolves questions independently and aggregates the final answers", () => {
    const registry = new PendingMultiUserInputRegistry<{ turnId: string }>();
    registry.register({
      requestId: "multi-1",
      nonce: "multi-nonce-000001",
      questions: multiQuestions,
      value: { turnId: "turn-1" },
    });

    const timedOut = registry.consumeRecommendedQuestion(
      "multi-1",
      "multi-nonce-000001",
      "q1",
    );
    expect(timedOut).toMatchObject({
      questionId: "q1",
      answer: "Ship now",
      selectedOptionLabel: "Ship now",
    });
    expect(timedOut.final).toBeUndefined();
    expect(registry.size).toBe(1);

    const custom = registry.consumeQuestion({
      requestId: "multi-1",
      nonce: "multi-nonce-000001",
      questionId: "q2",
      customAnswer: "Both targets",
    });
    expect(custom).toMatchObject({
      questionId: "q2",
      answer: "Both targets",
      customAnswer: "Both targets",
    });
    expect(custom.final?.answers).toEqual([
      {
        questionId: "q1",
        answer: "Ship now",
        selectedOptionLabel: "Ship now",
      },
      {
        questionId: "q2",
        answer: "Both targets",
        customAnswer: "Both targets",
      },
    ]);
    expect(registry.size).toBe(0);
  });

  it("cancels only matching multi-question requests", () => {
    const registry = new PendingMultiUserInputRegistry<{ threadId: string }>();
    for (const [requestId, threadId] of [
      ["multi-1", "thread-1"],
      ["multi-2", "thread-2"],
    ]) {
      registry.register({
        requestId,
        nonce: `multi-nonce-${requestId}`,
        questions: multiQuestions,
        value: { threadId },
      });
    }
    expect(
      registry.cancelWhere((value) => value.threadId === "thread-1"),
    ).toEqual([
      {
        requestId: "multi-1",
        nonce: "multi-nonce-multi-1",
        value: { threadId: "thread-1" },
      },
    ]);
    expect(registry.size).toBe(1);
  });
});

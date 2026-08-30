import { describe, expect, it } from "vitest";

import {
  PendingMultiUserInputRegistry,
  PendingUserInputRegistry,
  USER_INPUT_TIMEOUT_MILLISECONDS,
  prepareMultiQuestionUserInputRegistration,
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
    {
      questionId: "q1",
      options: questionOptions("Ship now"),
      expiresAt: "2999-01-01T00:00:00.000Z",
    },
    {
      questionId: "q2",
      options: questionOptions("Ship later"),
      expiresAt: "2999-01-01T00:00:00.000Z",
    },
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
        source: "user",
      }),
    ).toThrow(/nonce/i);

    expect(() =>
      registry.consumeQuestion({
        requestId: "multi-1",
        nonce: "multi-nonce-000001",
        questionId: "missing",
        selectedOptionLabel: "Ship now",
        source: "user",
      }),
    ).toThrow(/not offered/i);

    expect(() =>
      registry.consumeQuestion({
        requestId: "multi-1",
        nonce: "multi-nonce-000001",
        questionId: "q1",
        selectedOptionLabel: "Never offered",
        source: "user",
      }),
    ).toThrow(/not offered/i);

    const first = registry.consumeQuestion({
      requestId: "multi-1",
      nonce: "multi-nonce-000001",
      questionId: "q1",
      selectedOptionLabel: "Ship now",
      source: "user",
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
        source: "user",
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
      source: "user",
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
        source: "timeout",
      },
      {
        questionId: "q2",
        answer: "Both targets",
        customAnswer: "Both targets",
        source: "user",
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

  it("peeks per-question expiry deadlines without consuming them", () => {
    const registry = new PendingMultiUserInputRegistry<string>();
    registry.register({
      requestId: "multi-1",
      nonce: "multi-nonce-000001",
      questions: multiQuestions,
      value: "pending",
    });
    expect(registry.getQuestionExpiresAt("multi-1", "q1")).toBe(
      "2999-01-01T00:00:00.000Z",
    );
    expect(registry.getQuestionExpiresAt("multi-1", "missing")).toBeUndefined();
    expect(registry.getQuestionExpiresAt("gone", "q1")).toBeUndefined();
    expect(registry.size).toBe(1);
  });
});

describe("prepareMultiQuestionUserInputRegistration", () => {
  const twoOptions = [
    {
      label: "Ship it",
      description: "Release the build.",
      recommended: true,
    },
    {
      label: "Hold",
      description: "Wait one more day.",
      recommended: false,
    },
  ];
  const validQuestions = [
    {
      questionId: "q1",
      question: "Ship on Friday?",
      options: twoOptions,
    },
    {
      questionId: "q2",
      question: "Notify users first?",
      options: twoOptions,
    },
  ];
  const baseRequest = {
    approvalId: "multi-approve-1",
    header: "Scope",
    questions: validQuestions,
  };
  const activeTurn = {
    threadExists: true,
    turnCancelling: false,
    turnActive: true,
    modeMatches: true,
    duplicatePending: false,
  };
  const assembly = {
    nonce: "0123456789abcdef",
    now: Date.parse("2026-08-30T00:00:00.000Z"),
  };
  const prepare = prepareMultiQuestionUserInputRegistration;

  it("rejects requests that the active task turn does not own", () => {
    for (const context of [
      { ...activeTurn, threadExists: false },
      { ...activeTurn, turnCancelling: true },
      { ...activeTurn, turnActive: false },
      { ...activeTurn, modeMatches: false },
    ]) {
      expect(prepare(baseRequest, context, assembly)).toEqual({
        ok: false,
        reason: "User input requires the active task turn.",
      });
    }
  });

  it("rejects invalid question counts, ids, and option shapes", () => {
    const cases: Array<typeof validQuestions> = [
      [],
      [
        validQuestions[0]!,
        validQuestions[1]!,
        { questionId: "q3", question: "Third?", options: twoOptions },
        { questionId: "q4", question: "Fourth?", options: twoOptions },
      ],
      [
        { ...validQuestions[0]!, questionId: "q1" },
        { ...validQuestions[1]!, questionId: "q1" },
      ],
      [
        {
          questionId: "q1",
          question: "One option?",
          options: [twoOptions[0]!],
        },
      ],
      [
        {
          questionId: "q1",
          question: "Four options?",
          options: [
            ...twoOptions,
            { label: "Third", description: "Also fine.", recommended: false },
            { label: "Fourth", description: "Too many.", recommended: false },
          ],
        },
      ],
      [
        {
          questionId: "q1",
          question: "No recommendation?",
          options: twoOptions.map((option) => ({
            ...option,
            recommended: false,
          })),
        },
      ],
      [
        {
          questionId: "q1",
          question: "Two recommendations?",
          options: twoOptions.map((option) => ({
            ...option,
            recommended: true,
          })),
        },
      ],
      [{ questionId: "", question: "Empty id?", options: twoOptions }],
    ];
    for (const questions of cases) {
      expect(
        prepare({ ...baseRequest, questions }, activeTurn, assembly),
      ).toEqual({
        ok: false,
        reason:
          "User input requires one to three unique questions with two or three options and one recommendation each.",
      });
    }
  });

  it("rejects payloads the frozen protocol schema refuses", () => {
    const result = prepare(
      { ...baseRequest, header: "0123456789012" },
      activeTurn,
      assembly,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it("rejects duplicate pending requests", () => {
    expect(
      prepare(baseRequest, { ...activeTurn, duplicatePending: true }, assembly),
    ).toEqual({
      ok: false,
      reason: "User input is already pending.",
    });
  });

  it("freezes the payload with per-question expiry from the assembly clock", () => {
    expect(prepare(baseRequest, activeTurn, assembly)).toEqual({
      ok: true,
      payload: {
        type: "user-input.requested",
        kind: "multi-question",
        requestId: "multi-approve-1",
        nonce: "0123456789abcdef",
        header: "Scope",
        questions: [
          { ...validQuestions[0]!, expiresAt: "2026-08-30T00:05:00.000Z" },
          { ...validQuestions[1]!, expiresAt: "2026-08-30T00:05:00.000Z" },
        ],
      },
    });
  });
});

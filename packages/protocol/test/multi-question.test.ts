import { describe, expect, it } from "vitest";

import {
  PROTOCOL_VERSION,
  agentPayloadSchema,
  reduceAgentEvent,
  reduceAgentEvents,
  type AgentEvent,
  type MultiQuestionUserInputState,
} from "../src/index.js";

const NONCE = "1234567890abcdef";
const REQUESTED_AT = "2026-08-02T10:00:00.000Z";
const EXPIRES_AT = "2026-08-02T10:15:00.000Z";
const AFTER_EXPIRY = "2026-08-02T10:15:00.001Z";

function event(
  eventId: string,
  seq: number,
  payload: AgentEvent["payload"],
  timestamp: string = REQUESTED_AT,
): AgentEvent {
  return {
    protocolVersion: PROTOCOL_VERSION,
    eventId,
    threadId: "thread-1",
    turnId: "turn-1",
    seq,
    timestamp,
    payload,
  };
}

function question(questionId: string, overrides: Record<string, unknown> = {}) {
  return {
    questionId,
    question: `Question ${questionId}`,
    options: [
      {
        label: `option-${questionId}-a`,
        description: `First option for ${questionId}`,
        recommended: true,
      },
      {
        label: `option-${questionId}-b`,
        description: `Second option for ${questionId}`,
        recommended: false,
      },
    ],
    expiresAt: EXPIRES_AT,
    ...overrides,
  };
}

function multiRequested(
  requestId: string,
  questions: Array<ReturnType<typeof question>>,
) {
  return {
    type: "user-input.requested" as const,
    kind: "multi-question" as const,
    requestId,
    nonce: NONCE,
    header: "Scope",
    questions,
  };
}

function multiResolved(
  requestId: string,
  questionId: string,
  answer: { selectedOptionLabel?: string; customAnswer?: string },
  source: "user" | "timeout" | "cancelled" = "user",
) {
  return {
    type: "user-input.resolved" as const,
    kind: "multi-question" as const,
    requestId,
    nonce: NONCE,
    questionId,
    source,
    ...answer,
  };
}

const SINGLE_QUESTION = "Which target should be optimized first?";
const SINGLE_OPTIONS = [
  {
    label: "Whole sweep",
    description: "Optimize end-to-end runtime.",
    recommended: true,
  },
  {
    label: "Single point",
    description: "Optimize latency for one point.",
    recommended: false,
  },
];

function singleRequested(
  requestId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    type: "user-input.requested" as const,
    requestId,
    nonce: NONCE,
    header: "Scope",
    question: SINGLE_QUESTION,
    options: SINGLE_OPTIONS,
    expiresAt: EXPIRES_AT,
    ...overrides,
  };
}

function legacyKindlessResolved(
  requestId: string,
  source: "user" | "timeout" | "cancelled",
) {
  return {
    type: "user-input.resolved" as const,
    requestId,
    nonce: NONCE,
    answer: source === "user" ? "all of them" : "",
    source,
  };
}

function asMulti(input: unknown): MultiQuestionUserInputState {
  return input as MultiQuestionUserInputState;
}

describe("multi-question user input contract", () => {
  it("accepts 1-3 question requested payloads through the versioned union", () => {
    for (const questionCount of [1, 2, 3]) {
      const payload = multiRequested(
        `input-${questionCount}`,
        Array.from({ length: questionCount }, (_, index) =>
          question(`q${index + 1}`),
        ),
      );
      const result = agentPayloadSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        const data = result.data as Record<string, unknown>;
        expect(data.kind).toBe("multi-question");
        expect(data.questions).toHaveLength(questionCount);
      }
    }
  });

  it("rejects invalid multi-question requested payloads fail closed", () => {
    const invalid: Array<{ label: string; payload: Record<string, unknown> }> =
      [
        {
          label: "empty questions",
          payload: multiRequested("input-1", []),
        },
        {
          label: "more questions than the cap",
          payload: multiRequested("input-1", [
            question("q1"),
            question("q2"),
            question("q3"),
            question("q4"),
          ]),
        },
        {
          label: "duplicate questionId",
          payload: multiRequested("input-1", [question("q1"), question("q1")]),
        },
        {
          label: "missing questionId",
          payload: multiRequested("input-1", [
            question("q1", { questionId: "" }),
          ]),
        },
        {
          label: "no recommended option",
          payload: multiRequested("input-1", [
            question("q1", {
              options: [
                {
                  label: "a",
                  description: "First",
                  recommended: false,
                },
                {
                  label: "b",
                  description: "Second",
                  recommended: false,
                },
              ],
            }),
          ]),
        },
        {
          label: "two recommended options",
          payload: multiRequested("input-1", [
            question("q1", {
              options: [
                {
                  label: "a",
                  description: "First",
                  recommended: true,
                },
                {
                  label: "b",
                  description: "Second",
                  recommended: true,
                },
              ],
            }),
          ]),
        },
        {
          label: "too few options",
          payload: multiRequested("input-1", [
            question("q1", {
              options: [
                {
                  label: "a",
                  description: "Only",
                  recommended: true,
                },
              ],
            }),
          ]),
        },
        {
          label: "too many options",
          payload: multiRequested("input-1", [
            question("q1", {
              options: [
                {
                  label: "a",
                  description: "First",
                  recommended: true,
                },
                {
                  label: "b",
                  description: "Second",
                  recommended: false,
                },
                {
                  label: "c",
                  description: "Third",
                  recommended: false,
                },
                {
                  label: "d",
                  description: "Fourth",
                  recommended: false,
                },
              ],
            }),
          ]),
        },
        {
          label: "invalid expiry",
          payload: multiRequested("input-1", [
            question("q1", { expiresAt: "not-a-datetime" }),
          ]),
        },
        {
          label: "questions without the kind discriminator",
          payload: (() => {
            const payload = multiRequested("input-1", [question("q1")]);
            const { kind: _kind, ...withoutKind } = payload;
            return withoutKind;
          })(),
        },
      ];
    for (const { label, payload } of invalid) {
      expect(agentPayloadSchema.safeParse(payload).success, label).toBe(false);
    }
  });

  it("rejects multi-question resolutions that are not exactly one answer", () => {
    const invalid: Array<{ label: string; payload: Record<string, unknown> }> =
      [
        {
          label: "both selected option and custom answer",
          payload: multiResolved("input-1", "q1", {
            selectedOptionLabel: "option-q1-a",
            customAnswer: "A different answer",
          }),
        },
        {
          label: "neither selected option nor custom answer",
          payload: multiResolved("input-1", "q1", {}),
        },
        {
          label: "empty questionId",
          payload: multiResolved("input-1", "", {
            selectedOptionLabel: "option-q1-a",
          }),
        },
        {
          label: "unknown kind discriminator",
          payload: {
            ...multiResolved("input-1", "q1", {
              selectedOptionLabel: "option-q1-a",
            }),
            kind: "multi",
          },
        },
      ];
    for (const { label, payload } of invalid) {
      expect(agentPayloadSchema.safeParse(payload).success, label).toBe(false);
    }
  });

  it("replays legacy single-question payloads as single-question state", () => {
    const legacyRequest = {
      type: "user-input.requested",
      requestId: "legacy-1",
      nonce: NONCE,
      header: "Scope",
      question: "Which target should be optimized first?",
      options: [
        {
          label: "Whole sweep",
          description: "Optimize end-to-end runtime.",
          recommended: true,
        },
        {
          label: "Single point",
          description: "Optimize latency for one point.",
          recommended: false,
        },
      ],
      expiresAt: EXPIRES_AT,
    };
    const parsed = agentPayloadSchema.safeParse(legacyRequest);
    expect(parsed.success).toBe(true);

    const state = reduceAgentEvents("thread-1", [
      event("legacy-requested", 1, legacyRequest as AgentEvent["payload"]),
      event("legacy-resolved", 2, {
        type: "user-input.resolved",
        requestId: "legacy-1",
        nonce: NONCE,
        answer: "Whole sweep",
        selectedOption: 0,
        source: "user",
      }),
    ]);
    const input = state.userInputs["legacy-1"];
    expect(input).toMatchObject({
      status: "answered",
      answer: "Whole sweep",
      question: "Which target should be optimized first?",
      expiresAt: EXPIRES_AT,
    });
    expect(state.status).toBe("running");
  });

  it("treats duplicate event delivery as idempotent", () => {
    const requested = event(
      "dup-1",
      1,
      multiRequested("input-1", [
        question("q1"),
        question("q2"),
      ]) as AgentEvent["payload"],
    );
    const first = reduceAgentEvents("thread-1", [requested]);
    const second = reduceAgentEvent(first, requested);
    expect(second).toBe(first);

    const resolved = event(
      "dup-2",
      2,
      multiResolved("input-1", "q1", {
        selectedOptionLabel: "option-q1-a",
      }) as AgentEvent["payload"],
    );
    const third = reduceAgentEvent(second, resolved);
    expect(reduceAgentEvent(third, resolved)).toBe(third);
  });

  it("no-ops identical re-requests and fails closed on changed question sets", () => {
    const state = reduceAgentEvents("thread-1", [
      event(
        "req-1",
        1,
        multiRequested("input-1", [
          question("q1"),
          question("q2"),
        ]) as AgentEvent["payload"],
      ),
      event(
        "ans-1",
        2,
        multiResolved("input-1", "q1", {
          selectedOptionLabel: "option-q1-a",
        }) as AgentEvent["payload"],
      ),
    ]);
    expect(asMulti(state.userInputs["input-1"]).answers["q1"]?.status).toBe(
      "answered",
    );

    const reordered = reduceAgentEvent(
      state,
      event(
        "req-2",
        3,
        multiRequested("input-1", [
          question("q2"),
          question("q1"),
        ]) as AgentEvent["payload"],
      ),
    );
    expect(asMulti(reordered.userInputs["input-1"]).answers["q1"]?.status).toBe(
      "answered",
    );

    const changed = reduceAgentEvent(
      state,
      event(
        "req-3",
        4,
        multiRequested("input-1", [
          question("q2"),
          question("q3"),
        ]) as AgentEvent["payload"],
      ),
    );
    expect(changed.userInputs["input-1"]).toBe(state.userInputs["input-1"]);
    expect(changed.status).toBe(state.status);
  });

  it("fails closed on repeated resolution of the same question", () => {
    const state = reduceAgentEvents("thread-1", [
      event(
        "req-1",
        1,
        multiRequested("input-1", [
          question("q1"),
          question("q2"),
        ]) as AgentEvent["payload"],
      ),
      event(
        "ans-1",
        2,
        multiResolved("input-1", "q1", {
          selectedOptionLabel: "option-q1-a",
        }) as AgentEvent["payload"],
      ),
    ]);
    const repeated = reduceAgentEvent(
      state,
      event(
        "ans-1b",
        3,
        multiResolved("input-1", "q1", {
          customAnswer: "A different answer",
        }) as AgentEvent["payload"],
      ),
    );
    expect(asMulti(repeated.userInputs["input-1"]).answers["q1"]).toMatchObject(
      { status: "answered", answer: "option-q1-a" },
    );
    expect(repeated.status).toBe(state.status);
  });

  it("drops multi-question resolutions that arrive before the request", () => {
    const state = reduceAgentEvents("thread-1", [
      event(
        "ans-early",
        1,
        multiResolved("input-1", "q1", {
          selectedOptionLabel: "option-q1-a",
        }) as AgentEvent["payload"],
      ),
    ]);
    expect(state.userInputs["input-1"]).toBeUndefined();
    // A discarded resolution no longer recalculates thread status, so a
    // fresh thread stays idle instead of being flipped to running.
    expect(state.status).toBe("idle");
  });

  it("fails closed on answers that arrive after the question expiry", () => {
    const requested = multiRequested("input-1", [question("q1")]);
    const base = reduceAgentEvents("thread-1", [
      event("req-1", 1, requested as AgentEvent["payload"]),
    ]);

    const expired = reduceAgentEvent(
      base,
      event(
        "ans-late",
        2,
        multiResolved("input-1", "q1", { selectedOptionLabel: "option-q1-a" }),
        AFTER_EXPIRY,
      ) as AgentEvent,
    );
    expect(asMulti(expired.userInputs["input-1"]).answers["q1"]?.status).toBe(
      "pending",
    );
    expect(expired.status).toBe("waiting-user-input");

    const onDeadline = reduceAgentEvent(
      base,
      event(
        "ans-edge",
        2,
        multiResolved("input-1", "q1", { selectedOptionLabel: "option-q1-a" }),
        EXPIRES_AT,
      ) as AgentEvent,
    );
    expect(
      asMulti(onDeadline.userInputs["input-1"]).answers["q1"]?.status,
    ).toBe("answered");
  });

  it("applies timeout resolutions that fire after the deadline", () => {
    const base = reduceAgentEvents("thread-1", [
      event(
        "req-1",
        1,
        multiRequested("input-1", [question("q1")]) as AgentEvent["payload"],
      ),
    ]);

    const timedOut = reduceAgentEvent(
      base,
      event(
        "ans-timeout",
        2,
        multiResolved(
          "input-1",
          "q1",
          { selectedOptionLabel: "option-q1-a" },
          "timeout",
        ) as AgentEvent["payload"],
        AFTER_EXPIRY,
      ),
    );
    const input = asMulti(timedOut.userInputs["input-1"]);
    expect(input.answers["q1"]?.status).toBe("timed-out");
    expect(input.status).toBe("timed-out");
    expect(timedOut.status).not.toBe("waiting-user-input");
  });

  it("drops timeout resolutions that fire before the question deadline", () => {
    // Review repro: requested at 10:00:00 with a 10:15:00 deadline — a
    // shape-valid timeout stamped 10:14:59 must not steal the user's
    // remaining answer time.
    const base = reduceAgentEvents("thread-1", [
      event(
        "req-1",
        1,
        multiRequested("input-1", [
          question("q1"),
          question("q2"),
        ]) as AgentEvent["payload"],
      ),
    ]);
    expect(base.status).toBe("waiting-user-input");

    const early = reduceAgentEvent(
      base,
      event(
        "ans-timeout-early",
        2,
        multiResolved(
          "input-1",
          "q1",
          { selectedOptionLabel: "option-q1-a" },
          "timeout",
        ) as AgentEvent["payload"],
        "2026-08-02T10:14:59.000Z",
      ),
    );
    expect(early.userInputs["input-1"]).toBe(base.userInputs["input-1"]);
    expect(asMulti(early.userInputs["input-1"]).answers["q1"]?.status).toBe(
      "pending",
    );
    expect(asMulti(early.userInputs["input-1"]).answers["q2"]?.status).toBe(
      "pending",
    );
    expect(asMulti(early.userInputs["input-1"]).status).toBe("pending");
    expect(early.status).toBe("waiting-user-input");

    // Unparseable event timestamps fail closed: the question stays pending.
    const malformed = reduceAgentEvent(
      base,
      event(
        "ans-timeout-nan",
        3,
        multiResolved(
          "input-1",
          "q1",
          { selectedOptionLabel: "option-q1-a" },
          "timeout",
        ) as AgentEvent["payload"],
        "not-a-datetime",
      ),
    );
    expect(asMulti(malformed.userInputs["input-1"]).answers["q1"]?.status).toBe(
      "pending",
    );
    expect(malformed.status).toBe("waiting-user-input");
  });

  it("applies timeout resolutions from the deadline instant onward", () => {
    const build = () =>
      reduceAgentEvents("thread-1", [
        event(
          "req-1",
          1,
          multiRequested("input-1", [question("q1")]) as AgentEvent["payload"],
        ),
      ]);

    const onDeadline = reduceAgentEvent(
      build(),
      event(
        "ans-timeout-edge",
        2,
        multiResolved(
          "input-1",
          "q1",
          { selectedOptionLabel: "option-q1-a" },
          "timeout",
        ) as AgentEvent["payload"],
        EXPIRES_AT,
      ),
    );
    expect(
      asMulti(onDeadline.userInputs["input-1"]).answers["q1"]?.status,
    ).toBe("timed-out");
    expect(onDeadline.status).not.toBe("waiting-user-input");

    const afterDeadline = reduceAgentEvent(
      build(),
      event(
        "ans-timeout-after",
        2,
        multiResolved(
          "input-1",
          "q1",
          { selectedOptionLabel: "option-q1-a" },
          "timeout",
        ) as AgentEvent["payload"],
        AFTER_EXPIRY,
      ),
    );
    expect(
      asMulti(afterDeadline.userInputs["input-1"]).answers["q1"]?.status,
    ).toBe("timed-out");
    expect(afterDeadline.status).not.toBe("waiting-user-input");
  });

  it("applies cancelled resolutions after the deadline without persisting answers", () => {
    const base = reduceAgentEvents("thread-1", [
      event(
        "req-1",
        1,
        multiRequested("input-1", [question("q1")]) as AgentEvent["payload"],
      ),
    ]);

    const cancelled = reduceAgentEvent(
      base,
      event(
        "ans-cancelled",
        2,
        multiResolved(
          "input-1",
          "q1",
          { customAnswer: "Picked but cancelled" },
          "cancelled",
        ) as AgentEvent["payload"],
        AFTER_EXPIRY,
      ),
    );
    const input = asMulti(cancelled.userInputs["input-1"]);
    // Cancelled questions close bare — status:cancelled carries no answer,
    // mirroring the legacy translation path.
    expect(input.answers["q1"]).toEqual({ status: "cancelled" });
    expect(input.status).toBe("cancelled");
    expect(cancelled.status).not.toBe("waiting-user-input");
  });

  it("drops multi-question resolutions whose nonce does not match the request", () => {
    const base = reduceAgentEvents("thread-1", [
      event(
        "req-1",
        1,
        multiRequested("input-1", [
          question("q1"),
          question("q2"),
        ]) as AgentEvent["payload"],
      ),
    ]);

    const wrongNonce = reduceAgentEvent(
      base,
      event("ans-wrong-nonce", 2, {
        ...multiResolved("input-1", "q1", {
          selectedOptionLabel: "option-q1-a",
        }),
        nonce: "ffffffffffffffff",
      } as AgentEvent["payload"]),
    );
    expect(wrongNonce.userInputs["input-1"]).toBe(base.userInputs["input-1"]);
    expect(
      asMulti(wrongNonce.userInputs["input-1"]).answers["q1"]?.status,
    ).toBe("pending");
    expect(
      asMulti(wrongNonce.userInputs["input-1"]).answers["q2"]?.status,
    ).toBe("pending");
    expect(wrongNonce.status).toBe("waiting-user-input");

    const correctNonce = reduceAgentEvent(
      wrongNonce,
      event(
        "ans-correct-nonce",
        3,
        multiResolved("input-1", "q1", {
          selectedOptionLabel: "option-q1-a",
        }) as AgentEvent["payload"],
      ),
    );
    expect(
      asMulti(correctNonce.userInputs["input-1"]).answers["q1"]?.status,
    ).toBe("answered");
  });

  it("keeps thread status when a wrong-nonce resolution replays after the turn closed", () => {
    const closed = reduceAgentEvents("thread-1", [
      event(
        "req-1",
        1,
        multiRequested("input-1", [question("q1")]) as AgentEvent["payload"],
      ),
      event(
        "ans-1",
        2,
        multiResolved("input-1", "q1", {
          selectedOptionLabel: "option-q1-a",
        }) as AgentEvent["payload"],
      ),
      event("turn-1", 3, {
        type: "turn.completed",
        reason: "completed",
      } as AgentEvent["payload"]),
    ]);
    expect(closed.status).toBe("idle");

    const replay = reduceAgentEvent(
      closed,
      event("ans-wrong-nonce-replay", 4, {
        ...multiResolved("input-1", "q1", {
          selectedOptionLabel: "option-q1-b",
        }),
        nonce: "ffffffffffffffff",
      } as AgentEvent["payload"]),
    );
    expect(replay.userInputs["input-1"]).toBe(closed.userInputs["input-1"]);
    expect(replay.status).toBe("idle");
  });

  it("keeps the thread idle when a correct-nonce duplicate answer replays after the turn closed", () => {
    // P1-2 regression: the nonce matches the request, but the question was
    // already answered before turn.completed — the duplicate must not
    // resurrect thread state or overwrite the collected answer.
    const closed = reduceAgentEvents("thread-1", [
      event(
        "req-1",
        1,
        multiRequested("input-1", [question("q1")]) as AgentEvent["payload"],
      ),
      event(
        "ans-1",
        2,
        multiResolved("input-1", "q1", {
          selectedOptionLabel: "option-q1-a",
        }) as AgentEvent["payload"],
      ),
      event("turn-1", 3, {
        type: "turn.completed",
        reason: "completed",
      } as AgentEvent["payload"]),
    ]);
    expect(closed.status).toBe("idle");

    const replay = reduceAgentEvent(
      closed,
      event(
        "ans-duplicate",
        4,
        multiResolved("input-1", "q1", {
          customAnswer: "A different answer",
        }) as AgentEvent["payload"],
      ),
    );
    expect(replay.status).toBe("idle");
    expect(replay.userInputs["input-1"]).toBe(closed.userInputs["input-1"]);
    expect(asMulti(replay.userInputs["input-1"]).answers["q1"]).toMatchObject({
      status: "answered",
      answer: "option-q1-a",
    });
  });

  it("fails closed on answers for an unknown question or option", () => {
    const state = reduceAgentEvents("thread-1", [
      event(
        "req-1",
        1,
        multiRequested("input-1", [question("q1")]) as AgentEvent["payload"],
      ),
    ]);
    const unknownQuestion = reduceAgentEvent(
      state,
      event(
        "ans-unknown-q",
        2,
        multiResolved("input-1", "q9", {
          selectedOptionLabel: "option-q1-a",
        }) as AgentEvent["payload"],
      ),
    );
    expect(unknownQuestion.userInputs["input-1"]?.status).toBe("pending");

    const unknownOption = reduceAgentEvent(
      state,
      event(
        "ans-unknown-option",
        3,
        multiResolved("input-1", "q1", {
          selectedOptionLabel: "not-an-option",
        }) as AgentEvent["payload"],
      ),
    );
    expect(unknownOption.userInputs["input-1"]?.status).toBe("pending");
    expect(
      asMulti(unknownOption.userInputs["input-1"]).answers["q1"]?.status,
    ).toBe("pending");
  });

  it("tracks per-question answers across a three-question request", () => {
    const state = reduceAgentEvents("thread-1", [
      event(
        "req-1",
        1,
        multiRequested("input-1", [
          question("q1"),
          question("q2"),
          question("q3"),
        ]) as AgentEvent["payload"],
      ),
      event(
        "ans-1",
        2,
        multiResolved("input-1", "q1", {
          selectedOptionLabel: "option-q1-a",
        }) as AgentEvent["payload"],
      ),
    ]);
    const partiallyAnswered = asMulti(state.userInputs["input-1"]);
    expect(partiallyAnswered.answers["q1"]?.status).toBe("answered");
    expect(partiallyAnswered.answers["q2"]?.status).toBe("pending");
    expect(partiallyAnswered.answers["q3"]?.status).toBe("pending");
    expect(partiallyAnswered.status).toBe("pending");
    expect(state.status).toBe("waiting-user-input");
    expect(partiallyAnswered.question).toBe("Question q2");

    const timedOut = reduceAgentEvent(
      state,
      event(
        "ans-2",
        3,
        multiResolved(
          "input-1",
          "q2",
          { selectedOptionLabel: "option-q2-a" },
          "timeout",
        ) as AgentEvent["payload"],
        // Real timeout timers fire after the deadline, so model the real
        // timing: the resolution lands at least 1ms past expiresAt.
        AFTER_EXPIRY,
      ),
    );
    expect(asMulti(timedOut.userInputs["input-1"]).answers["q2"]?.status).toBe(
      "timed-out",
    );
    expect(timedOut.status).toBe("waiting-user-input");

    const completed = reduceAgentEvent(
      timedOut,
      event(
        "ans-3",
        4,
        multiResolved("input-1", "q3", {
          customAnswer: "A custom answer",
        }) as AgentEvent["payload"],
      ),
    );
    const finished = asMulti(completed.userInputs["input-1"]);
    expect(finished.answers["q3"]).toMatchObject({
      status: "answered",
      answer: "A custom answer",
    });
    expect(finished.status).toBe("timed-out");
    expect(completed.status).toBe("running");
  });

  it("keeps per-question state independent of answer arrival order", () => {
    const state = reduceAgentEvents("thread-1", [
      event(
        "req-1",
        1,
        multiRequested("input-1", [
          question("q1"),
          question("q2"),
          question("q3"),
        ]) as AgentEvent["payload"],
      ),
      event(
        "ans-3",
        2,
        multiResolved("input-1", "q3", {
          selectedOptionLabel: "option-q3-b",
        }) as AgentEvent["payload"],
      ),
      event(
        "ans-1",
        3,
        multiResolved("input-1", "q1", {
          customAnswer: "First custom",
        }) as AgentEvent["payload"],
      ),
    ]);
    const input = asMulti(state.userInputs["input-1"]);
    expect(input.answers["q1"]).toMatchObject({
      status: "answered",
      answer: "First custom",
    });
    expect(input.answers["q2"]?.status).toBe("pending");
    expect(input.answers["q3"]).toMatchObject({
      status: "answered",
      selectedOptionLabel: "option-q3-b",
    });
    expect(input.status).toBe("pending");
    expect(state.status).toBe("waiting-user-input");
  });

  it("round-trips multi-question payloads through JSON persistence", () => {
    const requested = multiRequested("input-1", [
      question("q1"),
      question("q2"),
    ]);
    const persisted = JSON.parse(
      JSON.stringify(event("req-1", 1, requested as AgentEvent["payload"])),
    ) as AgentEvent;
    const parsed = agentPayloadSchema.safeParse(persisted.payload);
    expect(parsed.success).toBe(true);

    const state = reduceAgentEvents("thread-1", [persisted]);
    const input = asMulti(state.userInputs["input-1"]);
    expect(input.questions).toHaveLength(2);
    expect(input.answers["q1"]?.status).toBe("pending");
    expect(input.answers["q2"]?.status).toBe("pending");
    expect(input.status).toBe("pending");
    expect(state.status).toBe("waiting-user-input");
  });
  it("translates legacy kind-less cancellations into whole-card closes", () => {
    // Crash recovery (store.ts) synthesizes { answer: "", source: "cancelled" }
    // without a kind discriminator; the reducer must translate it into closing
    // every still-pending question instead of dropping the event and leaving
    // the card suspended forever.
    const base = reduceAgentEvents("thread-1", [
      event(
        "req-1",
        1,
        multiRequested("input-1", [
          question("q1"),
          question("q2"),
          question("q3"),
        ]) as AgentEvent["payload"],
      ),
      event(
        "ans-1",
        2,
        multiResolved("input-1", "q1", {
          selectedOptionLabel: "option-q1-a",
        }) as AgentEvent["payload"],
      ),
    ]);
    expect(base.status).toBe("waiting-user-input");

    const recovered = reduceAgentEvent(
      base,
      event(
        "legacy-cancel",
        3,
        legacyKindlessResolved("input-1", "cancelled") as AgentEvent["payload"],
      ),
    );
    const input = asMulti(recovered.userInputs["input-1"]);
    expect(input.answers["q1"]).toMatchObject({
      status: "answered",
      answer: "option-q1-a",
    });
    expect(input.answers["q2"]).toMatchObject({ status: "cancelled" });
    expect(input.answers["q3"]).toMatchObject({ status: "cancelled" });
    expect(input.status).toBe("cancelled");
    expect("answer" in input).toBe(false);
    expect(recovered.status).toBe("running");

    const late = reduceAgentEvent(
      recovered,
      event(
        "ans-late",
        4,
        multiResolved("input-1", "q2", {
          selectedOptionLabel: "option-q2-a",
        }) as AgentEvent["payload"],
      ),
    );
    expect(late.userInputs["input-1"]).toBe(recovered.userInputs["input-1"]);
    expect(late.status).toBe("running");
  });

  it("translates turn cancellations and kind-less timeouts the same way", () => {
    const base = reduceAgentEvents("thread-1", [
      event(
        "req-1",
        1,
        multiRequested("input-1", [
          question("q1"),
          question("q2"),
          question("q3"),
        ]) as AgentEvent["payload"],
      ),
      event(
        "ans-1",
        2,
        multiResolved("input-1", "q2", {
          selectedOptionLabel: "option-q2-a",
        }) as AgentEvent["payload"],
      ),
    ]);

    // The turn-cancellation path (main.ts) emits the same kind-less
    // cancelled shape as crash recovery.
    const turnCancelled = reduceAgentEvent(
      base,
      event(
        "turn-cancel",
        3,
        legacyKindlessResolved("input-1", "cancelled") as AgentEvent["payload"],
        AFTER_EXPIRY,
      ),
    );
    let input = asMulti(turnCancelled.userInputs["input-1"]);
    expect(input.answers["q1"]?.status).toBe("cancelled");
    expect(input.answers["q2"]).toMatchObject({
      status: "answered",
      answer: "option-q2-a",
    });
    expect(input.answers["q3"]?.status).toBe("cancelled");
    expect(input.status).toBe("cancelled");
    expect(turnCancelled.status).toBe("running");

    // Kind-less timeouts map to timed-out even though they fire after the
    // deadline by design.
    const timedOut = reduceAgentEvent(
      base,
      event(
        "legacy-timeout",
        4,
        legacyKindlessResolved("input-1", "timeout") as AgentEvent["payload"],
        AFTER_EXPIRY,
      ),
    );
    input = asMulti(timedOut.userInputs["input-1"]);
    expect(input.answers["q1"]?.status).toBe("timed-out");
    expect(input.answers["q3"]?.status).toBe("timed-out");
    expect(input.answers["q2"]?.status).toBe("answered");
    expect(input.status).toBe("timed-out");
    expect(timedOut.status).toBe("running");
  });

  it("closes only expired questions when a kind-less timeout fires between deadlines", () => {
    // Two questions with different deadlines: the kind-less timeout lands
    // after q1's deadline but before q2's, so only q1 may close. The card
    // aggregate stays pending and the thread keeps waiting.
    const base = reduceAgentEvents("thread-1", [
      event(
        "req-1",
        1,
        multiRequested("input-1", [
          question("q1", { expiresAt: "2026-08-02T10:05:00.000Z" }),
          question("q2", { expiresAt: EXPIRES_AT }),
        ]) as AgentEvent["payload"],
      ),
    ]);
    expect(base.status).toBe("waiting-user-input");

    const between = reduceAgentEvent(
      base,
      event(
        "legacy-timeout-between",
        2,
        legacyKindlessResolved("input-1", "timeout") as AgentEvent["payload"],
        "2026-08-02T10:05:00.001Z",
      ),
    );
    const input = asMulti(between.userInputs["input-1"]);
    expect(input.answers["q1"]?.status).toBe("timed-out");
    expect(input.answers["q2"]?.status).toBe("pending");
    expect(input.status).toBe("pending");
    expect(between.status).toBe("waiting-user-input");

    // Review repro through the translation path: a timeout one second after
    // the request closes nothing while every deadline is still ahead.
    const premature = reduceAgentEvent(
      base,
      event(
        "legacy-timeout-early",
        3,
        legacyKindlessResolved("input-1", "timeout") as AgentEvent["payload"],
        "2026-08-02T10:00:01.000Z",
      ),
    );
    expect(premature.userInputs["input-1"]).toBe(base.userInputs["input-1"]);
    expect(asMulti(premature.userInputs["input-1"]).status).toBe("pending");
    expect(premature.status).toBe("waiting-user-input");

    // Unparseable event timestamps fail closed and close nothing.
    const malformed = reduceAgentEvent(
      base,
      event(
        "legacy-timeout-nan",
        4,
        legacyKindlessResolved("input-1", "timeout") as AgentEvent["payload"],
        "not-a-datetime",
      ),
    );
    expect(asMulti(malformed.userInputs["input-1"]).answers["q1"]?.status).toBe(
      "pending",
    );
    expect(malformed.status).toBe("waiting-user-input");
  });

  it("drops kind-less cancellations bound to a different nonce", () => {
    const base = reduceAgentEvents("thread-1", [
      event(
        "req-1",
        1,
        multiRequested("input-1", [
          question("q1"),
          question("q2"),
        ]) as AgentEvent["payload"],
      ),
    ]);
    const forged = reduceAgentEvent(
      base,
      event("legacy-cancel-forged", 2, {
        ...legacyKindlessResolved("input-1", "cancelled"),
        nonce: "ffffffffffffffff",
      } as AgentEvent["payload"]),
    );
    expect(forged.userInputs["input-1"]).toBe(base.userInputs["input-1"]);
    expect(asMulti(forged.userInputs["input-1"]).status).toBe("pending");
    expect(forged.status).toBe("waiting-user-input");
  });

  it("still drops kind-less user answers against multi-question state", () => {
    const base = reduceAgentEvents("thread-1", [
      event(
        "req-1",
        1,
        multiRequested("input-1", [
          question("q1"),
          question("q2"),
        ]) as AgentEvent["payload"],
      ),
    ]);
    const userAnswer = reduceAgentEvent(
      base,
      event(
        "legacy-user",
        2,
        legacyKindlessResolved("input-1", "user") as AgentEvent["payload"],
      ),
    );
    expect(userAnswer.userInputs["input-1"]).toBe(base.userInputs["input-1"]);
    expect(
      asMulti(userAnswer.userInputs["input-1"]).answers["q1"]?.status,
    ).toBe("pending");
    expect(userAnswer.status).toBe("waiting-user-input");
  });

  it("keeps multi-question state when a legacy kind-less requested reuses the requestId", () => {
    const base = reduceAgentEvents("thread-1", [
      event(
        "req-1",
        1,
        multiRequested("input-1", [
          question("q1"),
          question("q2"),
        ]) as AgentEvent["payload"],
      ),
      event(
        "ans-1",
        2,
        multiResolved("input-1", "q1", {
          selectedOptionLabel: "option-q1-a",
        }) as AgentEvent["payload"],
      ),
    ]);
    const legacyReplay = reduceAgentEvent(
      base,
      event("legacy-req", 3, {
        type: "user-input.requested",
        requestId: "input-1",
        nonce: NONCE,
        header: "Scope",
        question: "Which target should be optimized first?",
        options: [
          {
            label: "Whole sweep",
            description: "Optimize end-to-end runtime.",
            recommended: true,
          },
          {
            label: "Single point",
            description: "Optimize latency for one point.",
            recommended: false,
          },
        ],
        expiresAt: EXPIRES_AT,
      } as AgentEvent["payload"]),
    );
    const input = asMulti(legacyReplay.userInputs["input-1"]);
    expect(input.questions).toHaveLength(2);
    expect(input.answers["q1"]?.status).toBe("answered");
    expect(input.answers["q2"]?.status).toBe("pending");
    expect(input.status).toBe("pending");
    expect(legacyReplay.status).toBe("waiting-user-input");
  });

  it("fails closed when a re-request swaps content under the same question IDs", () => {
    const base = reduceAgentEvents("thread-1", [
      event(
        "req-1",
        1,
        multiRequested("input-1", [question("q1")]) as AgentEvent["payload"],
      ),
    ]);

    const swappedOptions = reduceAgentEvent(
      base,
      event(
        "req-2",
        2,
        multiRequested("input-1", [
          question("q1", {
            options: [
              {
                label: "swapped-a",
                description: "Swapped first option",
                recommended: true,
              },
              {
                label: "swapped-b",
                description: "Swapped second option",
                recommended: false,
              },
            ],
          }),
        ]) as AgentEvent["payload"],
      ),
    );
    expect(swappedOptions.userInputs["input-1"]).toBe(
      base.userInputs["input-1"],
    );

    const swappedExpiry = reduceAgentEvent(
      base,
      event(
        "req-3",
        3,
        multiRequested("input-1", [
          question("q1", { expiresAt: "2026-08-02T11:15:00.000Z" }),
        ]) as AgentEvent["payload"],
      ),
    );
    expect(swappedExpiry.userInputs["input-1"]).toBe(
      base.userInputs["input-1"],
    );
    expect(
      asMulti(swappedExpiry.userInputs["input-1"]).questions[0]?.expiresAt,
    ).toBe(EXPIRES_AT);
  });

  it("does not let newline-embedded question IDs collide with distinct sets", () => {
    const base = reduceAgentEvents("thread-1", [
      event(
        "req-1",
        1,
        multiRequested("input-1", [
          question("a"),
          question("b"),
        ]) as AgentEvent["payload"],
      ),
      event(
        "ans-1",
        2,
        multiResolved("input-1", "a", {
          selectedOptionLabel: "option-a-a",
        }) as AgentEvent["payload"],
      ),
    ]);
    const colliding = reduceAgentEvent(
      base,
      event(
        "req-2",
        3,
        multiRequested("input-1", [question("a\nb")]) as AgentEvent["payload"],
      ),
    );
    const input = asMulti(colliding.userInputs["input-1"]);
    expect(input.questions.map((entry) => entry.questionId)).toEqual([
      "a",
      "b",
    ]);
    expect(input.answers["a"]?.status).toBe("answered");
  });

  it("fails closed when expiry timestamps cannot be parsed", () => {
    const malformedExpiry = reduceAgentEvents("thread-1", [
      event(
        "req-1",
        1,
        multiRequested("input-1", [
          question("q1", { expiresAt: "not-a-datetime" }),
        ]) as AgentEvent["payload"],
      ),
    ]);
    const answered = reduceAgentEvent(
      malformedExpiry,
      event(
        "ans-1",
        2,
        multiResolved("input-1", "q1", {
          selectedOptionLabel: "option-q1-a",
        }) as AgentEvent["payload"],
      ),
    );
    expect(asMulti(answered.userInputs["input-1"]).answers["q1"]?.status).toBe(
      "pending",
    );

    const validExpiry = reduceAgentEvents("thread-1", [
      event(
        "req-2",
        1,
        multiRequested("input-1", [question("q1")]) as AgentEvent["payload"],
      ),
    ]);
    const malformedEventTime = reduceAgentEvent(
      validExpiry,
      event(
        "ans-2",
        2,
        multiResolved("input-1", "q1", {
          selectedOptionLabel: "option-q1-a",
        }) as AgentEvent["payload"],
        "not-a-datetime",
      ),
    );
    expect(
      asMulti(malformedEventTime.userInputs["input-1"]).answers["q1"]?.status,
    ).toBe("pending");
  });

  it("keeps the thread idle when late multi resolutions are discarded", () => {
    const buildClosed = () =>
      reduceAgentEvents("thread-1", [
        event(
          "req-1",
          1,
          multiRequested("input-1", [
            question("q1"),
            question("q2"),
          ]) as AgentEvent["payload"],
        ),
        event(
          "ans-1",
          2,
          multiResolved("input-1", "q1", {
            selectedOptionLabel: "option-q1-a",
          }) as AgentEvent["payload"],
        ),
        event("turn-1", 3, {
          type: "turn.completed",
          reason: "completed",
        } as AgentEvent["payload"]),
      ]);

    const lateResolutions = [
      {
        label: "expired user answer",
        payload: multiResolved("input-1", "q2", {
          selectedOptionLabel: "option-q2-a",
        }),
        timestamp: AFTER_EXPIRY,
      },
      {
        label: "unknown question id",
        payload: multiResolved("input-1", "q9", {
          selectedOptionLabel: "option-q2-a",
        }),
        timestamp: REQUESTED_AT,
      },
      {
        label: "already answered question",
        payload: multiResolved("input-1", "q1", {
          customAnswer: "A different answer",
        }),
        timestamp: REQUESTED_AT,
      },
    ];
    for (const { label, payload, timestamp } of lateResolutions) {
      const closed = buildClosed();
      expect(closed.status, label).toBe("idle");
      const replayed = reduceAgentEvent(
        closed,
        event(`late-${label}`, 4, payload as AgentEvent["payload"], timestamp),
      );
      expect(replayed.status, label).toBe("idle");
      expect(replayed.userInputs["input-1"], label).toBe(
        closed.userInputs["input-1"],
      );
    }
  });

  it("fails closed on re-requests carrying a different nonce or header", () => {
    const base = reduceAgentEvents("thread-1", [
      event(
        "req-1",
        1,
        multiRequested("input-1", [
          question("q1"),
          question("q2"),
        ]) as AgentEvent["payload"],
      ),
      event(
        "ans-1",
        2,
        multiResolved("input-1", "q1", {
          selectedOptionLabel: "option-q1-a",
        }) as AgentEvent["payload"],
      ),
    ]);

    const differentNonce = reduceAgentEvent(
      base,
      event("req-2", 3, {
        ...multiRequested("input-1", [question("q1"), question("q2")]),
        nonce: "ffffffffffffffff",
      } as AgentEvent["payload"]),
    );
    expect(differentNonce.userInputs["input-1"]).toBe(
      base.userInputs["input-1"],
    );
    expect(
      asMulti(differentNonce.userInputs["input-1"]).answers["q1"]?.status,
    ).toBe("answered");

    // The state's nonce stays authoritative: the replayed nonce never
    // resolves the card, the original nonce still does.
    const replayedNonceResolution = reduceAgentEvent(
      differentNonce,
      event("ans-2", 4, {
        ...multiResolved("input-1", "q2", {
          selectedOptionLabel: "option-q2-a",
        }),
        nonce: "ffffffffffffffff",
      } as AgentEvent["payload"]),
    );
    expect(
      asMulti(replayedNonceResolution.userInputs["input-1"]).answers["q2"]
        ?.status,
    ).toBe("pending");
    const originalNonceResolution = reduceAgentEvent(
      replayedNonceResolution,
      event(
        "ans-3",
        5,
        multiResolved("input-1", "q2", {
          selectedOptionLabel: "option-q2-a",
        }) as AgentEvent["payload"],
      ),
    );
    expect(
      asMulti(originalNonceResolution.userInputs["input-1"]).answers["q2"]
        ?.status,
    ).toBe("answered");

    const differentHeader = reduceAgentEvent(
      base,
      event("req-3", 6, {
        ...multiRequested("input-1", [question("q1"), question("q2")]),
        header: "Timing",
      } as AgentEvent["payload"]),
    );
    expect(differentHeader.userInputs["input-1"]).toBe(
      base.userInputs["input-1"],
    );
    expect(asMulti(differentHeader.userInputs["input-1"]).header).toBe("Scope");
  });

  it("aggregates mixed per-question statuses with a deterministic priority", () => {
    const answeredPlusCancelled = reduceAgentEvents("thread-1", [
      event(
        "req-1",
        1,
        multiRequested("input-1", [
          question("q1"),
          question("q2"),
        ]) as AgentEvent["payload"],
      ),
      event(
        "ans-1",
        2,
        multiResolved("input-1", "q1", {
          selectedOptionLabel: "option-q1-a",
        }) as AgentEvent["payload"],
      ),
      event(
        "cancel-1",
        3,
        multiResolved(
          "input-1",
          "q2",
          { selectedOptionLabel: "option-q2-a" },
          "cancelled",
        ) as AgentEvent["payload"],
      ),
    ]);
    expect(asMulti(answeredPlusCancelled.userInputs["input-1"]).status).toBe(
      "cancelled",
    );

    const timedOutPlusCancelled = reduceAgentEvents("thread-1", [
      event(
        "req-2",
        1,
        multiRequested("input-2", [
          question("q1"),
          question("q2"),
        ]) as AgentEvent["payload"],
      ),
      event(
        "timeout-1",
        2,
        multiResolved(
          "input-2",
          "q1",
          { selectedOptionLabel: "option-q1-a" },
          "timeout",
        ) as AgentEvent["payload"],
        // Real timeout timers fire after the deadline; keep this aggregate
        // case on the valid side of the reverse gate.
        AFTER_EXPIRY,
      ),
      event(
        "cancel-1",
        3,
        multiResolved(
          "input-2",
          "q2",
          { selectedOptionLabel: "option-q2-a" },
          "cancelled",
        ) as AgentEvent["payload"],
      ),
    ]);
    expect(asMulti(timedOutPlusCancelled.userInputs["input-2"]).status).toBe(
      "timed-out",
    );
  });

  it("ignores multi-question resolutions aimed at single-question requests", () => {
    const base = reduceAgentEvents("thread-1", [
      event("req-1", 1, singleRequested("input-1") as AgentEvent["payload"]),
    ]);
    expect(base.status).toBe("waiting-user-input");

    const misrouted = reduceAgentEvent(
      base,
      event(
        "ans-1",
        2,
        multiResolved("input-1", "q1", {
          selectedOptionLabel: "option-q1-a",
        }) as AgentEvent["payload"],
      ),
    );
    expect(misrouted.userInputs["input-1"]).toBe(base.userInputs["input-1"]);
    expect(misrouted.userInputs["input-1"]?.status).toBe("pending");
    expect("questions" in (misrouted.userInputs["input-1"] ?? {})).toBe(false);
    expect(misrouted.status).toBe("waiting-user-input");
  });

  it("rejects single-question requests that smuggle questions but strips unknown legacy keys", () => {
    const hybrid = agentPayloadSchema.safeParse({
      ...singleRequested("input-1"),
      questions: [question("q1")],
    });
    expect(hybrid.success).toBe(false);

    const kindlessSingle = agentPayloadSchema.safeParse({
      ...singleRequested("input-2"),
      kind: "single-question",
      questions: [question("q1")],
    });
    expect(kindlessSingle.success).toBe(false);

    for (const payload of [
      { ...singleRequested("input-3"), legacyExtra: "tolerated" },
      {
        ...multiRequested("input-4", [question("q1")]),
        legacyExtra: "tolerated",
      },
      {
        ...multiResolved("input-4", "q1", {
          selectedOptionLabel: "option-q1-a",
        }),
        legacyExtra: "tolerated",
      },
      {
        type: "user-input.resolved",
        requestId: "input-3",
        nonce: NONCE,
        answer: "Whole sweep",
        source: "user",
        legacyExtra: "tolerated",
      },
    ]) {
      const parsed = agentPayloadSchema.safeParse(payload);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect("legacyExtra" in (parsed.data as object)).toBe(false);
      }
    }
  });

  it("rejects single-question requests carrying an explicit undefined questions key", () => {
    // IPC structured clone preserves explicit undefined keys, so a payload
    // that skipped every producer-side normalization arrives exactly like
    // this; zod keeps the declared key in the parse output, so key presence
    // (not the value) must drive the rejection.
    expect(
      agentPayloadSchema.safeParse({
        ...singleRequested("input-1"),
        questions: undefined,
      }).success,
    ).toBe(false);
    expect(
      agentPayloadSchema.safeParse({
        ...singleRequested("input-2"),
        kind: "single-question",
        questions: undefined,
      }).success,
    ).toBe(false);
  });

  it("keeps bypassed explicit undefined questions keys single-question in the reducer", () => {
    // Reducer defense-in-depth: a payload poured straight past the schema
    // (legacy replay or a direct write) must not poison the stored state —
    // the key is stripped on store and a kind-less resolution still
    // resolves single-question instead of hitting the multi-question
    // translation path.
    const state = reduceAgentEvents("thread-1", [
      event(
        "req-1",
        1,
        singleRequested("input-undef", {
          questions: undefined,
        }) as AgentEvent["payload"],
      ),
      event("ans-1", 2, {
        type: "user-input.resolved",
        requestId: "input-undef",
        nonce: NONCE,
        answer: "Whole sweep",
        selectedOption: 0,
        source: "user",
      }),
    ]);
    const input = state.userInputs["input-undef"];
    expect(input).toMatchObject({
      status: "answered",
      answer: "Whole sweep",
    });
    expect("questions" in (input as object)).toBe(false);
    expect(state.status).toBe("running");
  });

  it("fails closed when a re-request meets a polluted undefined questions key", () => {
    const state = reduceAgentEvents("thread-1", [
      event(
        "req-1",
        1,
        singleRequested("input-undef", {
          questions: undefined,
        }) as AgentEvent["payload"],
      ),
    ]);
    const after = reduceAgentEvent(
      state,
      event(
        "req-2",
        2,
        multiRequested("input-undef", [
          question("q1"),
        ]) as AgentEvent["payload"],
      ),
    );
    // No TypeError from the fingerprint path; the authoritative
    // single-question state survives untouched.
    expect(after.userInputs["input-undef"]?.status).toBe("pending");
    expect(after.userInputs["input-undef"]?.question).toBe(SINGLE_QUESTION);
    expect(after.status).toBe("waiting-user-input");
  });

  it("carries the kind discriminant on user input states", () => {
    const state = reduceAgentEvents("thread-1", [
      event(
        "req-legacy",
        1,
        singleRequested("legacy-1") as AgentEvent["payload"],
      ),
      event(
        "req-single",
        2,
        singleRequested("single-1", {
          kind: "single-question",
        }) as AgentEvent["payload"],
      ),
      event(
        "req-multi",
        3,
        multiRequested("multi-1", [question("q1")]) as AgentEvent["payload"],
      ),
    ]);
    expect(state.userInputs["legacy-1"]?.kind).toBeUndefined();
    expect(state.userInputs["single-1"]?.kind).toBe("single-question");
    expect(state.userInputs["multi-1"]?.kind).toBe("multi-question");
  });
});

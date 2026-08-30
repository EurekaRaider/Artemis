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
  answer: { selectedOption?: string; customAnswer?: string },
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
            selectedOption: "option-q1-a",
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
            selectedOption: "option-q1-a",
          }),
        },
        {
          label: "unknown kind discriminator",
          payload: {
            ...multiResolved("input-1", "q1", {
              selectedOption: "option-q1-a",
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
        selectedOption: "option-q1-a",
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
          selectedOption: "option-q1-a",
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
          selectedOption: "option-q1-a",
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
          selectedOption: "option-q1-a",
        }) as AgentEvent["payload"],
      ),
    ]);
    expect(state.userInputs["input-1"]).toBeUndefined();
    expect(state.status).toBe("running");
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
        multiResolved("input-1", "q1", { selectedOption: "option-q1-a" }),
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
        multiResolved("input-1", "q1", { selectedOption: "option-q1-a" }),
        EXPIRES_AT,
      ) as AgentEvent,
    );
    expect(
      asMulti(onDeadline.userInputs["input-1"]).answers["q1"]?.status,
    ).toBe("answered");
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
          selectedOption: "option-q1-a",
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
          selectedOption: "not-an-option",
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
          selectedOption: "option-q1-a",
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
          { selectedOption: "option-q2-a" },
          "timeout",
        ) as AgentEvent["payload"],
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
          selectedOption: "option-q3-b",
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
      selectedOption: "option-q3-b",
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
  it("drops legacy kind-less resolutions against multi-question state", () => {
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
    const cancelled = reduceAgentEvent(
      base,
      event("legacy-cancel", 2, {
        type: "user-input.resolved",
        requestId: "input-1",
        nonce: NONCE,
        answer: "",
        source: "cancelled",
      } as AgentEvent["payload"]),
    );
    const input = asMulti(cancelled.userInputs["input-1"]);
    expect(input.status).toBe("pending");
    expect(input.answers["q1"]?.status).toBe("pending");
    expect(input.answers["q2"]?.status).toBe("pending");
    expect(cancelled.status).toBe("waiting-user-input");

    const late = reduceAgentEvent(
      cancelled,
      event(
        "ans-late",
        3,
        multiResolved("input-1", "q1", {
          selectedOption: "option-q1-a",
        }) as AgentEvent["payload"],
      ),
    );
    expect(asMulti(late.userInputs["input-1"]).answers["q1"]?.status).toBe(
      "answered",
    );
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
          selectedOption: "option-q1-a",
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
          selectedOption: "option-a-a",
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
          selectedOption: "option-q1-a",
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
          selectedOption: "option-q1-a",
        }) as AgentEvent["payload"],
        "not-a-datetime",
      ),
    );
    expect(
      asMulti(malformedEventTime.userInputs["input-1"]).answers["q1"]?.status,
    ).toBe("pending");
  });
});

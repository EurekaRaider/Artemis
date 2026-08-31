import { describe, expect, it } from "vitest";

import { PROTOCOL_VERSION, type AgentEvent } from "@artemis/protocol";
import {
  deriveRunPresentation,
  formatRunDuration,
} from "../src/renderer/run-presentation.js";

function event(
  eventId: string,
  turnId: string,
  timestamp: string,
  payload: AgentEvent["payload"],
): AgentEvent {
  return {
    protocolVersion: PROTOCOL_VERSION,
    eventId,
    threadId: "thread-1",
    turnId,
    seq: Number(eventId),
    timestamp,
    payload,
  };
}

describe("deriveRunPresentation", () => {
  it("times the latest started turn while it is running", () => {
    const events = [
      event("1", "turn-old", "2026-07-27T01:00:00.000Z", {
        type: "turn.started",
        mode: "plan",
      }),
      event("2", "turn-old", "2026-07-27T01:00:03.000Z", {
        type: "turn.completed",
        reason: "completed",
      }),
      event("3", "turn-latest", "2026-07-27T02:00:00.000Z", {
        type: "turn.started",
        mode: "plan",
      }),
      event("4", "turn-latest", "2026-07-27T02:00:01.000Z", {
        type: "message.part.delta",
        partId: "assistant:text",
        partType: "text",
        delta: "Working",
      }),
    ];

    expect(
      deriveRunPresentation(events, Date.parse("2026-07-27T02:00:12.000Z")),
    ).toMatchObject({
      status: "running",
      elapsedMs: 12_000,
    });
  });

  it("keeps elapsed time live while the latest turn waits for approval", () => {
    const events = [
      event("1", "turn-1", "2026-07-27T02:00:00.000Z", {
        type: "turn.started",
        mode: "execute",
      }),
      event("2", "turn-1", "2026-07-27T02:00:02.000Z", {
        type: "approval.requested",
        approvalId: "approval-1",
        nonce: "0123456789abcdef",
        summary: "Write README.md",
        paths: ["README.md"],
        network: [],
        risk: "medium",
        allowedScopes: ["once"],
      }),
    ];

    expect(
      deriveRunPresentation(events, Date.parse("2026-07-27T02:00:05.000Z")),
    ).toMatchObject({
      status: "waiting-approval",
      elapsedMs: 5_000,
    });
  });

  it("distinguishes a workflow choice from execution approval", () => {
    const events = [
      event("1", "turn-1", "2026-07-27T02:00:00.000Z", {
        type: "turn.started",
        mode: "execute",
      }),
      event("2", "turn-1", "2026-07-27T02:00:02.000Z", {
        type: "user-input.requested",
        requestId: "input-1",
        nonce: "0123456789abcdef",
        header: "Target",
        question: "Which target should be optimized?",
        options: [
          {
            label: "Sweep",
            description: "Optimize the whole sweep.",
            recommended: true,
          },
          {
            label: "Latency",
            description: "Optimize a single point.",
            recommended: false,
          },
        ],
        expiresAt: "2026-07-27T02:05:02.000Z",
      }),
    ];

    expect(
      deriveRunPresentation(events, Date.parse("2026-07-27T02:00:05.000Z")),
    ).toMatchObject({ status: "waiting-user-input", elapsedMs: 5_000 });
  });

  it("ignores terminal events that do not match the latest turn", () => {
    const events = [
      event("1", "turn-latest", "2026-07-27T02:00:00.000Z", {
        type: "turn.started",
        mode: "plan",
      }),
      event("2", "turn-other", "2026-07-27T02:00:04.000Z", {
        type: "turn.completed",
        reason: "completed",
      }),
    ];

    expect(
      deriveRunPresentation(events, Date.parse("2026-07-27T02:00:09.000Z")),
    ).toMatchObject({
      status: "running",
      elapsedMs: 9_000,
    });
  });

  it.each([
    {
      name: "completed",
      terminal: {
        type: "turn.completed",
        reason: "completed",
      } as const,
      status: "completed",
    },
    {
      name: "failed",
      terminal: {
        type: "turn.failed",
        message: "Provider failed",
      } as const,
      status: "failed",
    },
  ])(
    "freezes elapsed time when the latest turn has $name",
    ({ terminal, status }) => {
      const events = [
        event("1", "turn-1", "2026-07-27T02:00:00.000Z", {
          type: "turn.started",
          mode: "plan",
        }),
        event("2", "turn-1", "2026-07-27T02:00:12.500Z", terminal),
      ];

      expect(
        deriveRunPresentation(events, Date.parse("2026-07-27T03:00:00.000Z")),
      ).toMatchObject({
        status,
        elapsedMs: 12_500,
      });
    },
  );
});

describe("formatRunDuration", () => {
  it.each([
    [0, "0:00"],
    [5_000, "0:05"],
    [65_000, "1:05"],
    [3_665_000, "1:01:05"],
  ])("formats %i milliseconds as %s", (milliseconds, expected) => {
    expect(formatRunDuration(milliseconds)).toBe(expected);
  });
});

describe("deriveRunPresentation multi-question aggregation (D#76 PR10C obligation 2)", () => {
  const multiQuestion = (questionId: string) => ({
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
    expiresAt: "2026-08-02T10:15:00.000Z",
  });

  const multiResolved = (questionId: string) => ({
    type: "user-input.resolved" as const,
    kind: "multi-question" as const,
    requestId: "multi-1",
    nonce: "0123456789abcdef",
    questionId,
    selectedOptionLabel: `option-${questionId}-a`,
    source: "user" as const,
  });

  it("keeps waiting on user input while any question of a multi-question card is unanswered", () => {
    const events = [
      event("1", "turn-1", "2026-08-02T10:00:00.000Z", {
        type: "turn.started",
        mode: "execute",
      }),
      event("2", "turn-1", "2026-08-02T10:00:02.000Z", {
        type: "user-input.requested",
        kind: "multi-question",
        requestId: "multi-1",
        nonce: "0123456789abcdef",
        header: "Scope",
        questions: [
          multiQuestion("q1"),
          multiQuestion("q2"),
          multiQuestion("q3"),
        ],
      }),
      event("3", "turn-1", "2026-08-02T10:00:05.000Z", multiResolved("q1")),
    ];

    // RED anchor (D#76 PR10C §5, obligation 2): the first per-question
    // resolution must not settle the whole multi-question card — q2/q3 are
    // still pending, so the turn keeps waiting for user input.
    expect(
      deriveRunPresentation(events, Date.parse("2026-08-02T10:00:09.000Z")),
    ).toMatchObject({ status: "waiting-user-input" });

    const allResolved = [
      ...events,
      event("4", "turn-1", "2026-08-02T10:00:07.000Z", multiResolved("q2")),
      event("5", "turn-1", "2026-08-02T10:00:08.000Z", multiResolved("q3")),
    ];
    expect(
      deriveRunPresentation(
        allResolved,
        Date.parse("2026-08-02T10:00:09.000Z"),
      ),
    ).toMatchObject({ status: "running" });
  });

  it("keeps the legacy single-question resolve semantics unchanged", () => {
    const events = [
      event("1", "turn-1", "2026-08-02T10:00:00.000Z", {
        type: "turn.started",
        mode: "execute",
      }),
      event("2", "turn-1", "2026-08-02T10:00:02.000Z", {
        type: "user-input.requested",
        requestId: "single-1",
        nonce: "0123456789abcdef",
        header: "Target",
        question: "Which target should be optimized?",
        options: [
          {
            label: "Sweep",
            description: "Optimize the whole sweep.",
            recommended: true,
          },
          {
            label: "Latency",
            description: "Optimize a single point.",
            recommended: false,
          },
        ],
        expiresAt: "2026-08-02T10:05:02.000Z",
      }),
      event("3", "turn-1", "2026-08-02T10:00:05.000Z", {
        type: "user-input.resolved",
        requestId: "single-1",
        nonce: "0123456789abcdef",
        answer: "Sweep",
        selectedOption: 0,
        source: "user",
      }),
    ];
    expect(
      deriveRunPresentation(events, Date.parse("2026-08-02T10:00:09.000Z")),
    ).toMatchObject({ status: "running" });
  });
});

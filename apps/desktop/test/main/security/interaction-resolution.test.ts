import { describe, expect, it } from "vitest";
import {
  approvalResolutionSchema,
  reduceAgentEvents,
  PROTOCOL_VERSION,
  type AgentEvent,
  userInputResolutionSchema,
} from "@artemis/protocol";
import { PendingApprovalRegistry } from "../../../src/main/security/approval-policy.js";
import {
  PendingUserInputRegistry,
  PendingMultiUserInputRegistry,
} from "../../../src/main/security/user-input-policy.js";
const nonce = "1234567890abcdef";
const options = [
  { label: "A", description: "First", recommended: true },
  { label: "B", description: "Second", recommended: false },
];
describe("interaction decisions", () => {
  it("never grants permission for skipped or feedback decisions", () => {
    for (const extra of [
      { skipped: true },
      { feedback: "Use a different command" },
    ]) {
      const resolution = {
        approvalId: "a",
        nonce,
        approved: true,
        scope: "once" as const,
        ...extra,
      };
      expect(approvalResolutionSchema.safeParse(resolution).success).toBe(
        false,
      );
      const registry = new PendingApprovalRegistry<string>();
      registry.register({
        approvalId: "a",
        nonce,
        allowedScopes: ["once"],
        value: "pending",
      });
      expect(() => registry.consume(resolution)).toThrow();
      expect(registry.size).toBe(1);
    }
  });
  it("skips single questions without selecting the recommendation", () => {
    const registry = new PendingUserInputRegistry<string>();
    registry.register({ requestId: "q", nonce, options, value: "pending" });
    const decision = userInputResolutionSchema.parse({
      requestId: "q",
      nonce,
      skipped: true,
    });
    expect(registry.consume(decision)).toEqual({
      value: "pending",
      answer: "",
      skipped: true,
    });
    expect(registry.size).toBe(0);
  });
  it("skips one question without closing the other questions", () => {
    const registry = new PendingMultiUserInputRegistry<string>();
    registry.register({
      requestId: "q",
      nonce,
      value: "pending",
      questions: ["one", "two"].map((questionId) => ({
        questionId,
        options,
        expiresAt: "2030-01-01T00:00:00Z",
      })),
    });
    const result = registry.consumeQuestion({
      requestId: "q",
      nonce,
      questionId: "one",
      source: "user",
      skipped: true,
    });
    expect(result.skipped).toBe(true);
    expect(result.final).toBeUndefined();
    expect(registry.size).toBe(1);
  });
  it("rejects mixed skip and answer without consuming the request", () => {
    expect(
      userInputResolutionSchema.safeParse({
        requestId: "q",
        nonce,
        skipped: true,
        selectedOption: 0,
      }).success,
    ).toBe(false);
  });
});

function event(seq: number, payload: AgentEvent["payload"]): AgentEvent {
  return {
    protocolVersion: PROTOCOL_VERSION,
    eventId: `event-${seq}`,
    threadId: "t",
    turnId: "turn",
    seq,
    timestamp: "2026-09-20T00:00:00Z",
    payload,
  };
}
it("replays skipped questions without selecting an answer or closing the next question", () => {
  const requested = event(1, {
    type: "user-input.requested",
    kind: "multi-question",
    requestId: "q",
    nonce,
    header: "Details",
    questions: ["one", "two"].map((questionId) => ({
      questionId,
      question: questionId,
      options,
      expiresAt: "2030-01-01T00:00:00Z",
    })),
  });
  const skipped = event(2, {
    type: "user-input.resolved",
    kind: "multi-question",
    requestId: "q",
    nonce,
    questionId: "one",
    skipped: true,
    source: "user",
  });
  const state = reduceAgentEvents("t", [requested, skipped, skipped]);
  expect(state.status).toBe("waiting-user-input");
  expect(state.userInputs.q).toMatchObject({
    status: "pending",
    answers: {
      one: { status: "answered", skipped: true },
      two: { status: "pending" },
    },
  });
  const completed = reduceAgentEvents("t", [
    requested,
    skipped,
    event(3, {
      type: "user-input.resolved",
      kind: "multi-question",
      requestId: "q",
      nonce,
      questionId: "two",
      selectedOptionLabel: "A",
      source: "user",
    }),
  ]);
  expect(completed.status).toBe("running");
  expect(completed.userInputs.q?.status).toBe("answered");
});
it("preserves feedback and skipped single decisions in persisted summaries", () => {
  const state = reduceAgentEvents("t", [
    event(1, {
      type: "approval.requested",
      approvalId: "a",
      nonce,
      summary: "Create commit",
      command: "git commit",
      paths: [],
      network: [],
      risk: "low",
      allowedScopes: ["once"],
    }),
    event(2, {
      type: "approval.resolved",
      approvalId: "a",
      nonce,
      approved: false,
      scope: "once",
      feedback: "Only inspect status",
    }),
    event(3, {
      type: "user-input.requested",
      requestId: "q",
      nonce,
      header: "Details",
      question: "Which?",
      options,
      expiresAt: "2030-01-01T00:00:00Z",
    }),
    event(4, {
      type: "user-input.resolved",
      requestId: "q",
      nonce,
      source: "user",
      answer: "",
      skipped: true,
    }),
  ]);
  expect(state.approvals.a).toMatchObject({
    status: "denied",
    feedback: "Only inspect status",
    scope: "once",
  });
  expect(state.userInputs.q).toMatchObject({
    status: "answered",
    skipped: true,
    answer: "",
  });
  expect(state.status).toBe("running");
});

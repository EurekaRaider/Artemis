import { describe, expect, it } from "vitest";

import { PROTOCOL_VERSION, type AgentEvent } from "@artemis/protocol";
import { deriveTaskPlan } from "../src/renderer/task-plan.js";

function event(
  eventId: string,
  turnId: string | undefined,
  payload: AgentEvent["payload"],
): AgentEvent {
  return {
    protocolVersion: PROTOCOL_VERSION,
    eventId,
    threadId: "thread-1",
    turnId,
    seq: Number(eventId),
    timestamp: `2026-07-27T02:00:${eventId.padStart(2, "0")}.000Z`,
    payload,
  };
}

describe("deriveTaskPlan", () => {
  it("uses the latest valid update from the active turn", () => {
    const events = [
      event("1", "turn-1", { type: "turn.started", mode: "execute" }),
      event("2", "turn-1", {
        type: "tool.started",
        toolCallId: "plan-1",
        toolName: "update_plan",
        input: {
          steps: [
            { step: "Inspect selectors", status: "completed" },
            { step: "Add menu behavior", status: "in_progress" },
            { step: "Build", status: "pending" },
          ],
        },
      }),
      event("3", "turn-1", {
        type: "tool.completed",
        toolCallId: "plan-1",
        output: "Plan updated",
        isError: false,
      }),
    ];

    expect(deriveTaskPlan(events, true)).toEqual({
      currentIndex: 1,
      steps: [
        { step: "Inspect selectors", status: "completed" },
        { step: "Add menu behavior", status: "in_progress" },
        { step: "Build", status: "pending" },
      ],
    });
  });

  it("does not show a plan from an earlier turn", () => {
    const events = [
      event("1", "turn-1", { type: "turn.started", mode: "execute" }),
      event("2", "turn-1", {
        type: "tool.started",
        toolCallId: "plan-1",
        toolName: "update_plan",
        input: {
          steps: [{ step: "Old work", status: "in_progress" }],
        },
      }),
      event("3", "turn-2", { type: "turn.started", mode: "review" }),
    ];

    expect(deriveTaskPlan(events, true)).toBeUndefined();
  });

  it("hides a stale plan as soon as its turn is no longer active", () => {
    const events = [
      event("1", "turn-1", { type: "turn.started", mode: "execute" }),
      event("2", "turn-1", {
        type: "tool.started",
        toolCallId: "plan-1",
        toolName: "update_plan",
        input: {
          steps: [
            { step: "Inspect", status: "completed" },
            { step: "Build", status: "completed" },
          ],
        },
      }),
    ];

    expect(deriveTaskPlan(events, false)).toBeUndefined();
  });

  it("marks the active step failed when the current turn fails", () => {
    const events = [
      event("1", "turn-1", { type: "turn.started", mode: "execute" }),
      event("2", "turn-1", {
        type: "tool.started",
        toolCallId: "plan-1",
        toolName: "update_plan",
        input: {
          steps: [
            { step: "Inspect", status: "completed" },
            { step: "Build", status: "in_progress" },
          ],
        },
      }),
      event("3", "turn-1", {
        type: "turn.failed",
        message: "Build failed",
      }),
    ];

    expect(deriveTaskPlan(events, true)).toEqual({
      currentIndex: 1,
      steps: [
        { step: "Inspect", status: "completed" },
        { step: "Build", status: "failed" },
      ],
    });
  });

  it("hides the active plan when its turn is cancelled", () => {
    const activePlan = [
      event("1", "turn-1", { type: "turn.started", mode: "execute" }),
      event("2", "turn-1", {
        type: "tool.started",
        toolCallId: "plan-1",
        toolName: "update_plan",
        input: {
          steps: [
            { step: "Inspect", status: "completed" },
            { step: "Build", status: "in_progress" },
          ],
        },
      }),
    ];
    const cancelled = {
      type: "turn.completed",
      reason: "cancelled",
    } as const;

    expect(
      deriveTaskPlan([...activePlan, event("3", "turn-1", cancelled)], true),
    ).toBeUndefined();
    expect(
      deriveTaskPlan([...activePlan, event("3", undefined, cancelled)], true),
    ).toBeUndefined();
  });

  it("ignores a rejected update and keeps the previous valid plan", () => {
    const events = [
      event("1", "turn-1", { type: "turn.started", mode: "plan" }),
      event("2", "turn-1", {
        type: "tool.started",
        toolCallId: "plan-good",
        toolName: "update_plan",
        input: {
          steps: [{ step: "Inspect", status: "in_progress" }],
        },
      }),
      event("3", "turn-1", {
        type: "tool.completed",
        toolCallId: "plan-good",
        isError: false,
      }),
      event("4", "turn-1", {
        type: "tool.started",
        toolCallId: "plan-bad",
        toolName: "update_plan",
        input: {
          steps: [{ step: "Invalid", status: "in_progress" }],
        },
      }),
      event("5", "turn-1", {
        type: "tool.completed",
        toolCallId: "plan-bad",
        output: "Rejected",
        isError: true,
      }),
    ];

    expect(deriveTaskPlan(events, true)?.steps).toEqual([
      { step: "Inspect", status: "in_progress" },
    ]);
  });
});

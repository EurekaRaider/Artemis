import { describe, expect, it } from "vitest";

import {
  PROTOCOL_VERSION,
  automationEventSchema,
  automationSchema,
  createAutomationViewState,
  reduceAutomationEvent,
} from "../src/index.js";

const automation = automationSchema.parse({
  id: "automation-1",
  projectId: "project-1",
  name: "Daily review",
  prompt: "Review the current workspace.",
  mode: "review",
  target: "local",
  schedule: {
    kind: "weekly",
    daysOfWeek: [1, 2, 3, 4, 5],
    localTime: "09:30",
    timeZone: "Asia/Shanghai",
  },
  enabled: true,
  authorizationState: "not-required",
  nextRunAt: "2026-07-31T01:30:00.000Z",
  createdAt: "2026-07-30T01:00:00.000Z",
  updatedAt: "2026-07-30T01:00:00.000Z",
});

describe("automation protocol", () => {
  it("accepts the supported local schedule and target boundary", () => {
    expect(automation.schedule.kind).toBe("weekly");
    expect(() =>
      automationSchema.parse({
        ...automation,
        target: "permanent-worktree",
      }),
    ).toThrow();
    expect(() =>
      automationSchema.parse({
        ...automation,
        schedule: {
          kind: "weekly",
          daysOfWeek: [1, 1],
          localTime: "09:30",
          timeZone: "Asia/Shanghai",
        },
      }),
    ).toThrow();
  });

  it("reduces replayed update events idempotently", () => {
    const event = automationEventSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      eventId: "event-1",
      timestamp: "2026-07-30T01:00:00.000Z",
      payload: { type: "automation.upserted", automation },
    });
    const once = reduceAutomationEvent(createAutomationViewState(), event);
    const replayed = reduceAutomationEvent(once, event);

    expect(replayed).toEqual(once);
    expect(Object.keys(replayed.automations)).toEqual(["automation-1"]);
  });
});

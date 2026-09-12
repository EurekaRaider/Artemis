import { describe, expect, it } from "vitest";
import {
  agentEventSchema,
  PROTOCOL_VERSION,
  createThreadViewState,
  reduceAgentEvent,
} from "../src/index.js";

describe("notification state protocol", () => {
  it("accepts versioned read updates, ignores duplicate and stale revisions, and preserves task state", () => {
    const event = agentEventSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      eventId: "read",
      threadId: "task",
      seq: 4,
      timestamp: "2026-09-12T00:00:00Z",
      payload: {
        type: "thread.notification.updated",
        state: {
          revision: 2,
          seq: 3,
          unread: false,
          kind: "approval-required",
        },
      },
    });
    const initial = createThreadViewState("task");
    const read = reduceAgentEvent(initial, event);
    expect(read.notification?.unread).toBe(false);
    expect(reduceAgentEvent(read, event)).toBe(read);
    const stale = reduceAgentEvent(read, {
      ...event,
      eventId: "older",
      payload: {
        type: "thread.notification.updated",
        state: { revision: 1, seq: 3, unread: true, kind: "approval-required" },
      },
    });
    expect(stale.notification).toEqual(read.notification);
    expect(stale.status).toBe(initial.status);
    expect(stale.approvals).toEqual(initial.approvals);
    expect(initial.notification).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";

import {
  PROTOCOL_VERSION,
  PiAdapter,
  createThreadViewState,
  reduceAgentEvent,
  type AgentEvent,
} from "../src/index.js";

describe("Pi queued-message protocol", () => {
  it("adapts Pi queue_update into a versioned event and reducer queue state", () => {
    const adapter = new PiAdapter("turn-1");
    const payloads = adapter.adapt({
      type: "queue_update",
      steering: ["Redirect the current turn"],
      followUp: ["Run the focused tests next"],
    } as Parameters<PiAdapter["adapt"]>[0]);

    expect(payloads).toEqual([
      {
        type: "queue.updated",
        steering: ["Redirect the current turn"],
        followUp: ["Run the focused tests next"],
      },
    ]);

    const event = {
      protocolVersion: PROTOCOL_VERSION,
      eventId: "queue-1",
      threadId: "thread-1",
      turnId: "turn-1",
      seq: 7,
      timestamp: "2026-07-30T00:00:00.000Z",
      payload: payloads[0]!,
    } satisfies AgentEvent;
    const state = reduceAgentEvent(createThreadViewState("thread-1"), event);

    expect(event.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(state).toMatchObject({
      queue: {
        steering: ["Redirect the current turn"],
        followUp: ["Run the focused tests next"],
      },
      lastSeq: 7,
      seenEventIds: { "queue-1": true },
    });
  });

  it("ignores the persisted initial user start but emits a later queued user message", () => {
    const adapter = new PiAdapter("turn-1");

    expect(
      adapter.adapt({
        type: "message_start",
        message: {
          id: "initial-user",
          role: "user",
          content: "Initial prompt already persisted by main",
        },
      }),
    ).toEqual([]);
    expect(
      adapter.adapt({
        type: "message_start",
        message: {
          id: "queued-user",
          role: "user",
          content: [{ type: "text", text: "Run the focused tests next" }],
        },
      }),
    ).toEqual([
      {
        type: "user.message",
        messageId: "queued-user",
        text: "Run the focused tests next",
      },
    ]);
  });
});

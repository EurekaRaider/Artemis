import { describe, expect, it } from "vitest";

import {
  agentEventSchema,
  agentPayloadSchema,
  PROTOCOL_VERSION,
  PiAdapter,
} from "../src/index.js";

describe("assistant token usage protocol", () => {
  it("maps real Pi assistant usage into a replayable versioned event", () => {
    const adapter = new PiAdapter("turn-usage");
    const payloads = adapter.adapt({
      type: "message_end",
      message: {
        id: "message-usage",
        role: "assistant",
        content: [{ type: "text", text: "Finished." }],
        usage: {
          input: 800,
          output: 200,
          cacheRead: 100,
          cacheWrite: 50,
          totalTokens: 1_150,
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
          },
        },
      },
    });
    const usage = payloads.find(
      (payload) => payload.type === "assistant.usage",
    );

    expect(usage).toEqual({
      type: "assistant.usage",
      inputTokens: 800,
      outputTokens: 200,
      cacheReadTokens: 100,
      cacheWriteTokens: 50,
      totalTokens: 1_150,
    });

    expect(
      agentEventSchema.parse({
        protocolVersion: PROTOCOL_VERSION,
        eventId: "usage-event-1",
        threadId: "thread-1",
        turnId: "turn-usage",
        seq: 4,
        timestamp: "2026-07-26T04:00:00.000Z",
        payload: usage,
      }),
    ).toEqual(
      expect.objectContaining({
        protocolVersion: PROTOCOL_VERSION,
        eventId: "usage-event-1",
        payload: usage,
      }),
    );
  });

  it("rejects incomplete or negative assistant usage counts", () => {
    expect(
      agentPayloadSchema.safeParse({
        type: "assistant.usage",
        inputTokens: 800,
        outputTokens: 200,
        cacheReadTokens: 100,
        cacheWriteTokens: 50,
        totalTokens: 1_150,
      }).success,
    ).toBe(true);
    expect(
      agentPayloadSchema.safeParse({
        type: "assistant.usage",
        inputTokens: 800,
        outputTokens: 200,
        cacheReadTokens: 100,
        cacheWriteTokens: 50,
      }).success,
    ).toBe(false);
    expect(
      agentPayloadSchema.safeParse({
        type: "assistant.usage",
        inputTokens: 800,
        outputTokens: -1,
        cacheReadTokens: 100,
        cacheWriteTokens: 50,
        totalTokens: 949,
      }).success,
    ).toBe(false);
  });

  it("emits usage at most once when the same explicit assistant end is replayed", () => {
    const adapter = new PiAdapter("turn-replayed-usage");
    const messageEnd = {
      type: "message_end" as const,
      message: {
        id: "message-replayed-usage",
        role: "assistant",
        content: [{ type: "text", text: "Finished once." }],
        usage: {
          input: 90,
          output: 10,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 100,
        },
      },
    };

    const payloads = [
      ...adapter.adapt(messageEnd),
      ...adapter.adapt(messageEnd),
    ];

    expect(
      payloads.filter((payload) => payload.type === "assistant.usage"),
    ).toEqual([
      {
        type: "assistant.usage",
        inputTokens: 90,
        outputTokens: 10,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 100,
      },
    ]);
  });
});

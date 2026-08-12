import { describe, expect, it } from "vitest";

import {
  agentEventSchema,
  agentPayloadSchema,
  createThreadViewState,
  PROTOCOL_VERSION,
  PiAdapter,
  reduceAgentEvent,
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

  it("preserves optional cache reporting and automatic policy metadata", () => {
    const adapter = new PiAdapter("turn-cache-reporting");
    const payload = adapter
      .adapt({
        type: "message_end",
        message: {
          role: "assistant",
          content: [],
          usage: {
            input: 400,
            output: 100,
            cacheRead: 500,
            cacheWrite: 0,
            totalTokens: 1_000,
            cacheReadReported: true,
            cacheWriteReported: false,
          },
        },
      })
      .find((candidate) => candidate.type === "assistant.usage");

    expect(payload).toMatchObject({
      cacheReadReported: true,
      cacheWriteReported: false,
    });
    expect(
      agentPayloadSchema.parse({
        ...payload,
        cachePolicy: "explicit-30m",
        cachePolicyReason: "official-gpt-5.6",
        cacheKeyFingerprint: "0123456789abcdef",
        systemPromptFingerprint: "fedcba9876543210",
        toolSchemaFingerprint: "0011223344556677",
        stablePrefixTokens: 1_024,
        cacheKeyRequestsPerMinute: 2,
        cacheKeyRateWarning: false,
      }),
    ).toMatchObject({ cachePolicy: "explicit-30m" });
  });

  it("aggregates reporting coverage and policy calls while replaying old events", () => {
    const usageEvent = (eventId: string, payload: Record<string, unknown>) => ({
      protocolVersion: PROTOCOL_VERSION,
      eventId,
      threadId: "thread-1",
      turnId: "turn-1",
      seq: Number(eventId.at(-1)),
      timestamp: "2026-08-12T00:00:00.000Z",
      payload: {
        type: "assistant.usage",
        inputTokens: 100,
        outputTokens: 10,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 110,
        ...payload,
      },
    });
    const oldState = reduceAgentEvent(
      createThreadViewState("thread-1"),
      usageEvent("usage-1", {}) as never,
    );
    const state = reduceAgentEvent(
      oldState,
      usageEvent("usage-2", {
        cacheReadReported: true,
        cacheWriteReported: true,
        cachePolicy: "long",
      }) as never,
    );

    expect(state.assistantUsage).toMatchObject({
      usageEvents: 2,
      cacheReadReportedEvents: 1,
      cacheWriteReportedEvents: 1,
      cachePolicies: {
        disabled: 0,
        short: 0,
        long: 1,
        "explicit-30m": 0,
      },
    });
  });
});

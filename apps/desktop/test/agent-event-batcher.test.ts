import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentHostEvent } from "@artemis/protocol";

import { AgentEventBatcher } from "../src/agent/agent-event-batcher.js";

function delta(value: string): AgentHostEvent {
  return {
    threadId: "thread-1",
    turnId: "turn-1",
    payload: {
      type: "message.part.delta",
      partId: "assistant:text",
      partType: "text",
      delta: value,
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("AgentEventBatcher", () => {
  it("delivers the first visible delta immediately and coalesces later text at 32 ms", () => {
    vi.useFakeTimers();
    const deliveries: AgentHostEvent[][] = [];
    const batcher = new AgentEventBatcher((events) => deliveries.push(events));

    batcher.push(delta("首"));
    batcher.push(delta("字"));
    batcher.push(delta("节"));
    expect(deliveries).toHaveLength(1);
    vi.advanceTimersByTime(31);
    expect(deliveries).toHaveLength(1);
    vi.advanceTimersByTime(1);

    expect(deliveries).toHaveLength(2);
    expect(
      deliveries
        .flatMap((events) => events)
        .map((event) =>
          event.payload.type === "message.part.delta"
            ? event.payload.delta
            : "",
        ),
    ).toEqual(["首", "字节"]);
  });

  it("flushes text before tools and terminal turn events without reordering", () => {
    vi.useFakeTimers();
    const deliveries: AgentHostEvent[][] = [];
    const batcher = new AgentEventBatcher((events) => deliveries.push(events));

    batcher.push(delta("A"));
    batcher.push(delta("B"));
    batcher.push({
      threadId: "thread-1",
      turnId: "turn-1",
      payload: {
        type: "tool.started",
        toolCallId: "tool-1",
        toolName: "read",
        input: {},
      },
    });
    batcher.push({
      threadId: "thread-1",
      turnId: "turn-1",
      payload: { type: "turn.completed", reason: "completed" },
    });

    expect(
      deliveries.flatMap((events) => events).map((event) => event.payload.type),
    ).toEqual([
      "message.part.delta",
      "message.part.delta",
      "tool.started",
      "turn.completed",
    ]);
  });

  it("flushes a buffered delta as soon as it reaches 512 characters", () => {
    vi.useFakeTimers();
    const deliveries: AgentHostEvent[][] = [];
    const batcher = new AgentEventBatcher((events) => deliveries.push(events));

    batcher.push(delta("first"));
    batcher.push(delta("x".repeat(511)));
    expect(deliveries).toHaveLength(1);
    batcher.push(delta("y"));
    expect(deliveries).toHaveLength(2);
    expect(
      deliveries[1]?.[0]?.payload.type === "message.part.delta"
        ? deliveries[1][0].payload.delta.length
        : 0,
    ).toBe(512);
  });
});

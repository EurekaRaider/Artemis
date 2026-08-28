import { describe, expect, it } from "vitest";

import {
  PROTOCOL_VERSION,
  PiAdapter,
  reduceAgentEvents,
  type AgentEvent,
} from "../src/index.js";

describe("PiAdapter", () => {
  it("does not surface legacy internal agent messages as user messages", () => {
    const adapter = new PiAdapter("turn-1");

    expect(
      adapter.adapt({
        type: "message_start",
        message: { id: "initial", role: "user", content: "Run the task." },
      }),
    ).toEqual([]);
    expect(
      adapter.adapt({
        type: "message_start",
        message: {
          id: "handoff",
          role: "user",
          content: "[agent-team handoff] child-1: Internal result.",
        },
      }),
    ).toEqual([]);
    expect(
      adapter.adapt({
        type: "message_start",
        message: {
          id: "user-steer",
          role: "user",
          content: "Please also check the tests.",
        },
      }),
    ).toEqual([
      {
        type: "user.message",
        messageId: "user-steer",
        text: "Please also check the tests.",
      },
    ]);
  });

  it("ignores unhandled lifecycle events", () => {
    const adapter = new PiAdapter("turn-1");
    const event = {
      type: "agent_start",
    } as unknown as Parameters<PiAdapter["adapt"]>[0];

    expect(adapter.adapt(event)).toEqual([]);
  });

  it("maps text and thinking deltas without inventing reasoning", () => {
    const adapter = new PiAdapter("turn-1");

    expect(
      adapter.adapt({
        type: "message_update",
        message: { id: "message-1" },
        assistantMessageEvent: { type: "text_delta", delta: "Hello" },
      }),
    ).toEqual([
      {
        type: "message.part.delta",
        partId: "message-1:text",
        partType: "text",
        delta: "Hello",
      },
    ]);
    expect(
      adapter.adapt({
        type: "message_update",
        assistantMessageEvent: { type: "message_end" },
      }),
    ).toEqual([]);
  });

  it("emits one content-free thinking activity without reasoning text", () => {
    const adapter = new PiAdapter("turn-1");

    expect(
      adapter.adapt({
        type: "message_update",
        message: { id: "message-1", role: "assistant" },
        assistantMessageEvent: {
          type: "thinking_delta",
          delta: "private reasoning",
        },
      }),
    ).toEqual([{ type: "turn.activity", phase: "thinking" }]);
    expect(
      adapter.adapt({
        type: "message_update",
        message: { id: "message-1", role: "assistant" },
        assistantMessageEvent: {
          type: "thinking_delta",
          delta: " more reasoning",
        },
      }),
    ).toEqual([]);
    expect(
      adapter.adapt({
        type: "message_end",
        message: {
          id: "message-1",
          role: "assistant",
          content: [
            { type: "thinking", thinking: "private reasoning more reasoning" },
          ],
        },
      }),
    ).toEqual([]);
  });

  it("maps Pi retry progress and supersedes a failed partial answer", () => {
    const adapter = new PiAdapter("turn-1");

    adapter.adapt({
      type: "message_update",
      message: { id: "attempt-1", role: "assistant" },
      assistantMessageEvent: { type: "text_delta", delta: "Partial" },
    });
    adapter.adapt({
      type: "message_end",
      message: {
        id: "attempt-1",
        role: "assistant",
        content: [{ type: "text", text: "Partial" }],
        stopReason: "error",
        errorMessage: "getaddrinfo ENOTFOUND api.example.invalid",
      },
    });

    expect(
      adapter.adapt({
        type: "auto_retry_start",
        attempt: 1,
        maxAttempts: 3,
        delayMs: 2_000,
        errorMessage: "getaddrinfo ENOTFOUND api.example.invalid",
      }),
    ).toEqual([
      {
        type: "message.superseded",
        messageId: "attempt-1",
        attemptId: "turn-1:retry:1",
      },
      {
        type: "turn.activity",
        phase: "reconnecting",
        kind: "connection",
        attempt: 1,
        maxAttempts: 3,
        delayMs: 2_000,
        attemptId: "turn-1:retry:1",
      },
    ]);
    expect(
      adapter.adapt({ type: "auto_retry_end", success: true, attempt: 1 }),
    ).toEqual([
      {
        type: "turn.activity",
        phase: "recovered",
        attemptId: "turn-1:retry:1",
      },
    ]);
  });

  it("does not settle while agent_end says a retry will follow", () => {
    const adapter = new PiAdapter("turn-1");
    expect(adapter.adapt({ type: "agent_end", willRetry: true })).toEqual([]);
    expect(adapter.adapt({ type: "agent_settled" })).toEqual([]);
  });

  it("recovers final assistant text when a compatible proxy emits no deltas", () => {
    const adapter = new PiAdapter("turn-1");

    expect(
      adapter.adapt({
        type: "message_start",
        message: { role: "assistant", content: [] },
      }),
    ).toEqual([]);
    expect(
      adapter.adapt({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Returned through the proxy." }],
        },
      }),
    ).toEqual([
      {
        type: "message.part.delta",
        partId: "turn-1:text",
        partType: "text",
        delta: "Returned through the proxy.",
      },
    ]);
  });

  it("uses final assistant content only to complete missing stream deltas", () => {
    const adapter = new PiAdapter("turn-1");

    expect(
      adapter.adapt({
        type: "message_start",
        message: { role: "assistant", content: [] },
      }),
    ).toEqual([]);
    expect(
      adapter.adapt({
        type: "message_update",
        message: { role: "assistant", content: [] },
        assistantMessageEvent: { type: "text_delta", delta: "Return" },
      }),
    ).toHaveLength(1);
    expect(
      adapter.adapt({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Returned once." }],
        },
      }),
    ).toEqual([
      {
        type: "message.part.delta",
        partId: "turn-1:text",
        partType: "text",
        delta: "ed once.",
      },
    ]);
  });

  it("fails the turn when Pi reports a backend model error", () => {
    const adapter = new PiAdapter("turn-1");

    expect(
      adapter.adapt({
        type: "message_end",
        message: {
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage: "Unable to connect to the model provider.",
        },
      }),
    ).toEqual([]);
    expect(adapter.adapt({ type: "agent_settled" })).toEqual([
      {
        type: "turn.failed",
        message: "Unable to connect to the model provider.",
      },
    ]);
  });

  it("does not fail a turn when Pi recovers from a transient model error", () => {
    const adapter = new PiAdapter("turn-1");

    expect(
      adapter.adapt({
        type: "message_end",
        message: {
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage: "Temporary provider error.",
        },
      }),
    ).toEqual([]);
    expect(
      adapter.adapt({
        type: "message_end",
        message: {
          id: "recovered-response",
          role: "assistant",
          content: [{ type: "text", text: "Recovered response." }],
          stopReason: "stop",
        },
      }),
    ).toEqual([
      {
        type: "message.part.delta",
        partId: "recovered-response:text",
        partType: "text",
        delta: "Recovered response.",
      },
    ]);
    expect(adapter.adapt({ type: "agent_settled" })).toEqual([
      {
        type: "turn.completed",
        reason: "completed",
        finalPartId: "recovered-response:text",
      },
    ]);
  });

  it("selects only the settled stop or length message as the final answer", () => {
    const adapter = new PiAdapter("turn-1");

    adapter.adapt({
      type: "message_end",
      message: {
        id: "tool-round",
        role: "assistant",
        content: [{ type: "text", text: "I will inspect the file." }],
        stopReason: "toolUse",
      },
    });
    adapter.adapt({
      type: "message_end",
      message: {
        id: "final-round",
        role: "assistant",
        content: [{ type: "text", text: "The task is complete." }],
        stopReason: "length",
      },
    });

    expect(adapter.adapt({ type: "agent_settled" })).toEqual([
      {
        type: "turn.completed",
        reason: "completed",
        finalPartId: "final-round:text",
      },
    ]);
  });

  it("fails instead of completing when the provider returns no assistant content", () => {
    const adapter = new PiAdapter("turn-1");

    expect(
      adapter.adapt({
        type: "message_start",
        message: { role: "assistant", content: [] },
      }),
    ).toEqual([]);
    expect(
      adapter.adapt({
        type: "message_end",
        message: { role: "assistant", content: [] },
      }),
    ).toEqual([]);
    expect(adapter.adapt({ type: "agent_settled" })).toEqual([
      {
        type: "turn.failed",
        message:
          "The model returned no assistant content. Verify that the provider API protocol matches the endpoint.",
      },
    ]);
  });

  it("maps tool lifecycle events", () => {
    const adapter = new PiAdapter("turn-1");

    expect(
      adapter.adapt({
        type: "tool_execution_start",
        toolCallId: "tool-1",
        toolName: "read",
        args: { path: "README.md" },
      }),
    ).toEqual([
      {
        type: "tool.started",
        toolCallId: "tool-1",
        toolName: "read",
        input: { path: "README.md" },
      },
    ]);
    expect(
      adapter.adapt({
        type: "tool_execution_end",
        toolCallId: "tool-1",
        result: { content: [{ type: "text", text: "done" }] },
        isError: false,
      }),
    ).toEqual([
      {
        type: "tool.completed",
        toolCallId: "tool-1",
        output: "done",
        isError: false,
      },
    ]);
  });

  it("maps observed shell results to terminal output without execution metadata", () => {
    const adapter = new PiAdapter("turn-1");
    adapter.adapt({
      type: "tool_execution_start",
      toolCallId: "bash-1",
      toolName: "shell",
      args: { command: "ls" },
    });

    expect(
      adapter.adapt({
        type: "tool_execution_end",
        toolCallId: "bash-1",
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                executionId: "execution-1",
                command: "ls",
                status: "completed",
                health: "healthy",
                outputDelta: "README.md\npackage.json\n",
              }),
            },
          ],
          details: {
            executionId: "execution-1",
            command: "ls",
            status: "completed",
            health: "healthy",
            outputDelta: "README.md\npackage.json\n",
          },
        },
        isError: false,
      }),
    ).toEqual([
      {
        type: "tool.completed",
        toolCallId: "bash-1",
        output: "README.md\npackage.json\n",
        isError: false,
      },
    ]);
  });

  it("keeps tools between anonymous assistant messages in timeline order", () => {
    const adapter = new PiAdapter("turn-1");
    const payloads = [
      ...adapter.adapt({
        type: "message_start",
        message: { role: "assistant", content: [] },
      }),
      ...adapter.adapt({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "Before" },
      }),
      ...adapter.adapt({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Before" }],
        },
      }),
      ...adapter.adapt({
        type: "tool_execution_start",
        toolCallId: "tool-1",
        toolName: "bash",
        args: { command: "pwd" },
      }),
      ...adapter.adapt({
        type: "tool_execution_end",
        toolCallId: "tool-1",
        result: "done",
        isError: false,
      }),
      ...adapter.adapt({
        type: "message_start",
        message: { role: "assistant", content: [] },
      }),
      ...adapter.adapt({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "After" },
      }),
      ...adapter.adapt({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "After" }],
        },
      }),
    ];
    const events = payloads.map(
      (payload, index) =>
        ({
          protocolVersion: PROTOCOL_VERSION,
          eventId: `event-${index}`,
          threadId: "thread-1",
          turnId: "turn-1",
          seq: index,
          timestamp: "2026-07-30T00:00:00.000Z",
          payload,
        }) satisfies AgentEvent,
    );

    expect(reduceAgentEvents("thread-1", events).order).toEqual([
      "part:turn-1:text",
      "tool:tool-1",
      "part:turn-1:assistant:2:text",
    ]);
  });

  it("waits for Pi to settle before completing a turn", () => {
    const adapter = new PiAdapter("turn-1");

    expect(adapter.adapt({ type: "agent_end" })).toEqual([]);
    expect(adapter.adapt({ type: "agent_settled" })).toEqual([
      { type: "turn.completed", reason: "completed" },
    ]);
  });
});

import { describe, expect, it } from "vitest";

import {
  PROTOCOL_VERSION,
  createThreadViewState,
  reduceAgentEventBatch,
  reduceAgentEvent,
  reduceAgentEvents,
  type AgentEvent,
} from "../src/index.js";

function event(
  eventId: string,
  seq: number,
  payload: AgentEvent["payload"],
): AgentEvent {
  return {
    protocolVersion: PROTOCOL_VERSION,
    eventId,
    threadId: "thread-1",
    turnId: "turn-1",
    seq,
    timestamp: "2026-07-26T00:00:00.000Z",
    payload,
  };
}

describe("reduceAgentEvent", () => {
  it("tracks content-free turn activity until visible work starts", () => {
    const thinking = reduceAgentEvents("thread-1", [
      event("start", 1, { type: "turn.started", mode: "execute" }),
      event("thinking", 2, { type: "turn.activity", phase: "thinking" }),
    ]);

    expect(thinking.activity).toEqual({ phase: "thinking" });
    expect(thinking.order).toEqual([]);

    const visible = reduceAgentEvent(
      thinking,
      event("text", 3, {
        type: "message.part.delta",
        partId: "assistant:text",
        partType: "text",
        delta: "Ready",
      }),
    );
    expect(visible.activity).toBeUndefined();
  });

  it("merges text deltas without retaining completed reasoning", () => {
    const state = reduceAgentEvents("thread-1", [
      event("1", 1, {
        type: "message.part.delta",
        partId: "assistant:text",
        partType: "text",
        delta: "Arte",
      }),
      event("2", 2, {
        type: "message.part.delta",
        partId: "assistant:thinking",
        partType: "thinking",
        delta: "Checking",
      }),
      event("3", 3, {
        type: "message.part.delta",
        partId: "assistant:text",
        partType: "text",
        delta: "mis",
      }),
    ]);

    expect(state.order).toEqual(["part:assistant:text"]);
    expect(state.messageParts["assistant:text"]?.text).toBe("Artemis");
    expect(state.messageParts["assistant:thinking"]).toBeUndefined();
  });

  it("never adds reasoning markers to the timeline", () => {
    const reasoning = reduceAgentEvents("thread-1", [
      event("start", 1, { type: "turn.started", mode: "execute" }),
      event("thinking", 2, {
        type: "message.part.delta",
        partId: "assistant:thinking",
        partType: "thinking",
        delta: "private chain of thought",
      }),
    ]);

    expect(reasoning.order).toEqual([]);
    expect(reasoning.messageParts["assistant:thinking"]).toBeUndefined();

    const completed = reduceAgentEvent(
      reasoning,
      event("complete", 3, {
        type: "turn.completed",
        reason: "completed",
      }),
    );
    expect(completed.order).not.toContain("part:assistant:thinking");
    expect(completed.messageParts["assistant:thinking"]).toBeUndefined();
  });

  it("replays legacy same-id text around a tool in its original position", () => {
    const state = reduceAgentEvents("thread-1", [
      event("before", 1, {
        type: "message.part.delta",
        partId: "assistant:text",
        partType: "text",
        delta: "Before",
      }),
      event("tool-start", 2, {
        type: "tool.started",
        toolCallId: "tool-1",
        toolName: "bash",
        input: { command: "pwd" },
      }),
      event("tool-end", 3, {
        type: "tool.completed",
        toolCallId: "tool-1",
        output: "done",
        isError: false,
      }),
      event("after", 4, {
        type: "message.part.delta",
        partId: "assistant:text",
        partType: "text",
        delta: "After",
      }),
    ]);

    expect(state.order).toEqual([
      "part:assistant:text",
      "tool:tool-1",
      "part:assistant:text::after-tool::tool-1",
    ]);
    expect(state.messageParts["assistant:text"]?.text).toBe("Before");
    expect(state.messageParts["assistant:text::after-tool::tool-1"]?.text).toBe(
      "After",
    );
  });

  it("deduplicates replayed events", () => {
    const delta = event("same-event", 1, {
      type: "message.part.delta",
      partId: "assistant:text",
      partType: "text",
      delta: "once",
    });
    const once = reduceAgentEvent(createThreadViewState("thread-1"), delta);
    const replayed = reduceAgentEvent(once, delta);

    expect(replayed).toBe(once);
    expect(replayed.messageParts["assistant:text"]?.text).toBe("once");
  });

  it("tracks approval and resolution state", () => {
    const state = reduceAgentEvents("thread-1", [
      event("approval", 1, {
        type: "approval.requested",
        approvalId: "approval-1",
        nonce: "nonce-1",
        summary: "Write README.md",
        paths: ["README.md"],
        network: [],
        risk: "medium",
        allowedScopes: ["once", "session"],
      }),
      event("resolved", 2, {
        type: "approval.resolved",
        approvalId: "approval-1",
        nonce: "nonce-1",
        approved: true,
        scope: "once",
      }),
    ]);

    expect(state.approvals["approval-1"]?.status).toBe("approved");
    expect(state.status).toBe("running");
  });

  it("queues user decisions and keeps waiting until each question resolves", () => {
    const option = (label: string, recommended: boolean) => ({
      label,
      description: `${label} impact`,
      recommended,
    });
    const state = reduceAgentEvents("thread-1", [
      event("input-1", 1, {
        type: "user-input.requested",
        requestId: "input-1",
        nonce: "1234567890abcdef",
        header: "Target",
        question: "What should be optimized?",
        options: [option("Sweep", true), option("Latency", false)],
        expiresAt: "2026-08-02T10:15:00.000Z",
      }),
      event("input-2", 2, {
        type: "user-input.requested",
        requestId: "input-2",
        nonce: "abcdef1234567890",
        header: "Platform",
        question: "Which platform should be targeted?",
        options: [option("macOS", true), option("Windows", false)],
        expiresAt: "2026-08-02T10:15:00.000Z",
      }),
      event("answer-1", 3, {
        type: "user-input.resolved",
        requestId: "input-1",
        nonce: "1234567890abcdef",
        answer: "Sweep",
        selectedOption: 0,
        source: "user",
      }),
    ]);

    expect(state.status).toBe("waiting-user-input");
    expect(state.userInputs["input-1"]).toMatchObject({
      status: "answered",
      answer: "Sweep",
    });
    expect(state.userInputs["input-2"]?.status).toBe("pending");

    const timedOut = reduceAgentEvent(
      state,
      event("answer-2", 4, {
        type: "user-input.resolved",
        requestId: "input-2",
        nonce: "abcdef1234567890",
        answer: "macOS",
        selectedOption: 0,
        source: "timeout",
      }),
    );
    expect(timedOut.status).toBe("running");
    expect(timedOut.userInputs["input-2"]?.status).toBe("timed-out");
  });

  it("keeps the latest live child-agent activity in one timeline entry", () => {
    const state = reduceAgentEvents("thread-1", [
      event("child-queued", 1, {
        type: "child-agent.status",
        agentId: "child-1",
        label: "Review audio stages",
        status: "queued",
        task: "Audit the audio processing stages.",
      }),
      event("child-running", 2, {
        type: "child-agent.status",
        agentId: "child-1",
        label: "Review audio stages",
        status: "running",
        health: "healthy",
        startedAt: "2026-07-26T00:00:00.000Z",
        updatedAt: "2026-07-26T00:00:01.000Z",
        lastActivityAt: "2026-07-26T00:00:01.000Z",
        currentTool: "read",
        currentToolStartedAt: "2026-07-26T00:00:01.000Z",
        attempt: 1,
        activityDelta: "Reading bark_",
      }),
      event("child-progress", 3, {
        type: "child-agent.status",
        agentId: "child-1",
        label: "Review audio stages",
        status: "running",
        activityDelta: "filterbank.cpp",
      }),
      event("child-completed", 4, {
        type: "child-agent.status",
        agentId: "child-1",
        label: "Review audio stages",
        status: "completed",
        output: "Found a hot path.",
      }),
    ]);

    expect(state.order).toEqual(["child:child-1"]);
    expect(state.childAgents["child-1"]).toMatchObject({
      status: "completed",
      task: "Audit the audio processing stages.",
      activity: "Reading bark_filterbank.cpp",
      output: "Found a hot path.",
      startedAt: "2026-07-26T00:00:00.000Z",
      lastActivityAt: "2026-07-26T00:00:01.000Z",
      attempt: 1,
    });
  });

  it("rebuilds an idempotent team workspace from status and message events", () => {
    const messages = [
      event("team-forming", 1, {
        type: "agent-team.status",
        teamId: "team-1",
        mission: "Implement team collaboration.",
        status: "forming",
        memberAgentIds: [],
        requiredAgentIds: [],
        maxMembers: 4,
        updatedAt: "2026-08-06T00:00:00.000Z",
      }),
      event("team-running", 2, {
        type: "agent-team.status",
        teamId: "team-1",
        mission: "Implement team collaboration.",
        status: "running",
        memberAgentIds: ["child-1"],
        requiredAgentIds: ["child-1"],
        maxMembers: 4,
        updatedAt: "2026-08-06T00:00:01.000Z",
      }),
      event("team-message", 3, {
        type: "agent-team.message",
        teamId: "team-1",
        messageId: "message-1",
        sequence: 1,
        fromAgentId: "child-1",
        recipient: "parent",
        kind: "handoff",
        content: "Protocol changes are ready for integration.",
        createdAt: "2026-08-06T00:00:02.000Z",
      }),
    ];
    const state = reduceAgentEventBatch(
      reduceAgentEvents("thread-1", messages),
      [messages[2]!],
    );

    expect(state.agentTeams["team-1"]).toMatchObject({
      status: "running",
      memberAgentIds: ["child-1"],
    });
    expect(state.agentTeamMessageOrder).toEqual(["message-1"]);
    expect(state.agentTeamMessages["message-1"]?.content).toContain(
      "ready for integration",
    );
  });

  it("records tool runtime and last activity timestamps", () => {
    const state = reduceAgentEvents("thread-1", [
      event("tool-started", 1, {
        type: "tool.started",
        toolCallId: "tool-1",
        toolName: "bash",
      }),
      {
        ...event("tool-updated", 2, {
          type: "tool.updated",
          toolCallId: "tool-1",
          output: "working",
        }),
        timestamp: "2026-07-26T00:00:05.000Z",
      },
    ]);

    expect(state.tools["tool-1"]).toMatchObject({
      startedAt: "2026-07-26T00:00:00.000Z",
      lastActivityAt: "2026-07-26T00:00:05.000Z",
    });
  });

  it("keeps the latest replayable context usage snapshot", () => {
    const state = reduceAgentEvents("thread-1", [
      event("usage-before", 1, {
        type: "context.usage",
        tokens: 61_000,
        contextWindow: 258_000,
        compacting: false,
      }),
      event("usage-compacting", 2, {
        type: "context.usage",
        tokens: 233_000,
        contextWindow: 258_000,
        compacting: true,
      }),
    ]);

    expect(state.contextUsage).toEqual({
      tokens: 233_000,
      contextWindow: 258_000,
      compacting: true,
    });
  });

  it("retains a post-compaction estimate until reported usage replaces it", () => {
    const estimated = reduceAgentEvents("thread-1", [
      event("usage-estimated", 1, {
        type: "context.usage",
        tokens: 74_000,
        contextWindow: 258_000,
        compacting: false,
        estimated: true,
        source: "compaction-estimate",
        providerInputTokens: 61_000,
        breakdown: {
          systemPromptTokens: 12_000,
          systemToolTokens: 18_000,
          mcpToolTokens: 4_000,
          customAgentTokens: 0,
          memoryFileTokens: 8_000,
          skillTokens: 4_000,
          messageTokens: 28_000,
          freeSpaceTokens: 158_200,
          autocompactBufferTokens: 25_800,
        },
      }),
      event("usage-unknown", 2, {
        type: "context.usage",
        tokens: null,
        contextWindow: 258_000,
        compacting: false,
        breakdown: {
          systemPromptTokens: 10,
          systemToolTokens: 10,
          mcpToolTokens: 10,
          customAgentTokens: 0,
          memoryFileTokens: 10,
          skillTokens: 10,
          messageTokens: 10,
          freeSpaceTokens: 10,
          autocompactBufferTokens: 10,
        },
      }),
    ]);

    expect(estimated.contextUsage).toEqual({
      tokens: 74_000,
      contextWindow: 258_000,
      compacting: false,
      estimated: true,
      source: "compaction-estimate",
      providerInputTokens: 61_000,
      breakdown: {
        systemPromptTokens: 12_000,
        systemToolTokens: 18_000,
        mcpToolTokens: 4_000,
        customAgentTokens: 0,
        memoryFileTokens: 8_000,
        skillTokens: 4_000,
        messageTokens: 28_000,
        freeSpaceTokens: 158_200,
        autocompactBufferTokens: 25_800,
      },
    });

    const reported = reduceAgentEvent(
      estimated,
      event("usage-reported", 3, {
        type: "context.usage",
        tokens: 81_000,
        contextWindow: 258_000,
        compacting: false,
      }),
    );
    expect(reported.contextUsage).toEqual({
      tokens: 81_000,
      contextWindow: 258_000,
      compacting: false,
    });
  });

  it("keeps context compaction progress in timeline order", () => {
    const state = reduceAgentEvents("thread-1", [
      event("usage-before", 1, {
        type: "context.usage",
        tokens: 61_000,
        contextWindow: 258_000,
        compacting: false,
      }),
      event("message-before", 2, {
        type: "user.message",
        messageId: "message-before",
        text: "Before compact",
      }),
      event("compact-start", 3, {
        type: "context.usage",
        tokens: 233_000,
        contextWindow: 258_000,
        compacting: true,
      }),
      event("compact-still-running", 4, {
        type: "context.usage",
        tokens: 233_000,
        contextWindow: 258_000,
        compacting: true,
      }),
      event("compact-end", 5, {
        type: "context.usage",
        tokens: 74_000,
        contextWindow: 258_000,
        compacting: false,
      }),
      event("message-after", 6, {
        type: "user.message",
        messageId: "message-after",
        text: "After compact",
      }),
      event("compact-second-start", 7, {
        type: "context.usage",
        tokens: 229_000,
        contextWindow: 258_000,
        compacting: true,
      }),
      event("compact-second-end", 8, {
        type: "context.usage",
        tokens: 72_000,
        contextWindow: 258_000,
        compacting: false,
      }),
    ]);

    expect(state.order).toEqual([
      "user:message-before",
      "compaction:compact-start",
      "user:message-after",
      "compaction:compact-second-start",
    ]);
    expect(state.contextCompactions).toEqual({
      "compact-start": {
        id: "compact-start",
        status: "completed",
      },
      "compact-second-start": {
        id: "compact-second-start",
        status: "completed",
      },
    });
  });

  it("ignores events for another thread", () => {
    const state = createThreadViewState("thread-1");
    const foreign = {
      ...event("foreign", 1, {
        type: "turn.completed",
        reason: "completed",
      }),
      threadId: "thread-2",
    } satisfies AgentEvent;

    expect(reduceAgentEvent(state, foreign)).toBe(state);
  });

  it("replays long streaming histories without quadratic state cloning", () => {
    const events = Array.from({ length: 10_000 }, (_, index) =>
      event(`delta-${index}`, index, {
        type: "message.part.delta",
        partId: "assistant:text",
        partType: "text",
        delta: "x",
      }),
    );

    const state = reduceAgentEvents("thread-1", events);

    expect(state.messageParts["assistant:text"]?.text).toHaveLength(10_000);
    expect(state.order).toEqual(["part:assistant:text"]);
    expect(Object.keys(state.seenEventIds)).toHaveLength(10_000);
  });

  it("applies a live event batch with one immutable state update", () => {
    const original = reduceAgentEvents("thread-1", [
      event("first", 1, {
        type: "message.part.delta",
        partId: "assistant:text",
        partType: "text",
        delta: "Arte",
      }),
    ]);

    const state = reduceAgentEventBatch(original, [
      event("second", 2, {
        type: "message.part.delta",
        partId: "assistant:text",
        partType: "text",
        delta: "mis",
      }),
      event("completed", 3, {
        type: "turn.completed",
        reason: "completed",
      }),
    ]);

    expect(state.messageParts["assistant:text"]?.text).toBe("Artemis");
    expect(state.status).toBe("idle");
    expect(original.messageParts["assistant:text"]?.text).toBe("Arte");
    expect(original.seenEventIds.second).toBeUndefined();
  });
});

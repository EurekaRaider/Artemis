// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import {
  createThreadViewState,
  PROTOCOL_VERSION,
  reduceAgentEventBatch,
  type AgentEvent,
} from "@artemis/protocol";
import { Timeline } from "../../../src/renderer/conversation/timeline.js";
import "../../fixtures/renderer-test-utils.js";

function event(
  seq: number,
  payload: AgentEvent["payload"],
  turnId?: string,
): AgentEvent {
  return {
    protocolVersion: PROTOCOL_VERSION,
    eventId: String(seq),
    seq,
    threadId: "thread",
    timestamp: "2026-01-01T00:00:00Z",
    turnId,
    payload,
  };
}

const usage = {
  type: "context.usage",
  tokens: 42,
  contextWindow: 32000,
} as const;
const props = {
  installedPlugins: [],
  installedSkills: [],
  locale: "zh-CN" as const,
  onExternalLink: vi.fn(),
  onFileLink: vi.fn(),
  onFileLinkContextMenu: vi.fn(),
  onOpenChildAgent: vi.fn(),
  onOpenTurnReview: vi.fn(),
  onCopyText: vi.fn(),
  onEditUserMessage: undefined,
  onResolve: vi.fn(),
  onResolveUserInput: vi.fn(),
  onUndoTurnChanges: vi.fn(),
};

it("keeps standalone compactions between the same prompts during live updates and replay", () => {
  const history = [
    event(1, { ...usage, compacting: true }),
    event(2, { ...usage, compacting: false }),
    event(
      3,
      { type: "user.message", messageId: "one", text: "第一条消息" },
      "one",
    ),
    event(4, { type: "turn.completed", reason: "completed" }, "one"),
    event(5, { ...usage, compacting: true }),
    event(6, {
      ...usage,
      compacting: false,
      compactionResult: {
        status: "failed",
        error: "Compaction failed: Nothing to compact (session too small)",
      },
    }),
  ];
  const next = event(
    7,
    { type: "user.message", messageId: "two", text: "第二条消息" },
    "two",
  );
  const initial = createThreadViewState("thread");
  const state = reduceAgentEventBatch(initial, history);
  const { container, rerender } = render(<Timeline {...props} state={state} />);
  const rows = () =>
    [...container.querySelectorAll(".compaction-status, .user-message")].map(
      (row) =>
        row.querySelector('[data-part="label"]')?.textContent ??
        row.textContent,
    );
  const before = ["上下文压缩已完成", "第一条消息", "当前会话太短，无需压缩"];
  expect(rows()).toEqual(before);
  expect(screen.getByRole("status", { name: before[2] })).toHaveAttribute(
    "data-state",
    "idle",
  );
  for (const updated of [
    reduceAgentEventBatch(state, [next]),
    reduceAgentEventBatch(initial, [...history, next]),
  ]) {
    rerender(<Timeline {...props} state={updated} />);
    expect(rows()).toEqual([...before, "第二条消息"]);
    expect(screen.queryByRole("alert")).toBeNull();
  }
});

it("keeps the original error visible for a genuine compaction failure", () => {
  const error = "Compaction failed: summary service unavailable";
  const state = reduceAgentEventBatch(createThreadViewState("thread"), [
    event(1, { ...usage, compacting: true }),
    event(2, {
      ...usage,
      compacting: false,
      compactionResult: { status: "failed", error },
    }),
  ]);
  render(<Timeline {...props} state={state} />);
  expect(screen.getByRole("alert")).toHaveTextContent(error);
});

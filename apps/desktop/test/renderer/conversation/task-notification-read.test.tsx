// @vitest-environment jsdom
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PROTOCOL_VERSION,
  reduceAgentEvents,
  type AgentEvent,
  type Thread,
} from "@artemis/protocol";
import { ThreadStatusIndicator } from "../../../src/renderer/conversation/ThreadStatusIndicator.js";
import { useTaskNotificationRead } from "../../../src/renderer/conversation/task-notification-read.js";

const event = (seq: number, payload: AgentEvent["payload"]): AgentEvent => ({
  protocolVersion: PROTOCOL_VERSION,
  eventId: `event-${seq}`,
  threadId: "thread",
  turnId: "turn",
  seq,
  timestamp: new Date(Date.UTC(2026, 10, 1, 0, 0, seq)).toISOString(),
  payload,
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("notification reading and sidebar", () => {
  it("reports dock visibility changes without acknowledging an unfocused task", () => {
    let focused = true;
    vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
    const reportTaskView = vi.fn();
    Object.defineProperty(window, "artemis", {
      configurable: true,
      value: { reportTaskView },
    });
    const { rerender } = renderHook(
      ({ open }) => useTaskNotificationRead("one", 4, open),
      { initialProps: { open: false } },
    );
    expect(reportTaskView).toHaveBeenLastCalledWith({
      threadId: "one",
      seenSeq: 4,
      dockOpen: false,
    });
    rerender({ open: true });
    expect(reportTaskView).toHaveBeenLastCalledWith({
      threadId: "one",
      seenSeq: 4,
      dockOpen: true,
    });
    focused = false;
    act(() => window.dispatchEvent(new Event("blur")));
    expect(reportTaskView).toHaveBeenLastCalledWith({ dockOpen: true });
    rerender({ open: false });
    expect(reportTaskView).toHaveBeenLastCalledWith({ dockOpen: false });
  });

  it("only acknowledges loaded visible tasks and rechecks focus and navigation", () => {
    let focused = true;
    vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
    const reportTaskView = vi.fn();
    Object.defineProperty(window, "artemis", {
      configurable: true,
      value: { reportTaskView },
    });
    const { rerender } = renderHook(
      ({ id, seq }: { id: string | undefined; seq: number | undefined }) =>
        useTaskNotificationRead(id, seq),
      { initialProps: { id: undefined, seq: undefined } },
    );
    expect(reportTaskView).toHaveBeenLastCalledWith({});
    rerender({ id: "one", seq: 4 });
    expect(reportTaskView).toHaveBeenLastCalledWith({
      threadId: "one",
      seenSeq: 4,
    });
    focused = false;
    act(() => window.dispatchEvent(new Event("blur")));
    expect(reportTaskView).toHaveBeenLastCalledWith({});
    rerender({ id: "one", seq: 7 });
    focused = true;
    act(() => window.dispatchEvent(new Event("focus")));
    expect(reportTaskView).toHaveBeenLastCalledWith({
      threadId: "one",
      seenSeq: 7,
    });
    rerender({ id: undefined, seq: undefined });
    expect(reportTaskView).toHaveBeenLastCalledWith({});
  });

  it.each(["failed", "completed"] as const)(
    "keeps failure state distinct from the %s unread notification",
    (kind) => {
      const thread = {
        status: kind === "failed" ? "failed" : "idle",
        notification: { revision: 1, seq: 3, kind, unread: true },
      } as Thread;
      const { container, rerender } = render(
        <ThreadStatusIndicator thread={thread} locale="zh-CN" />,
      );
      expect(screen.getByRole("img")).toBeTruthy();
      expect(container.querySelector(".thread-unread-dot")).toBeNull();
      expect(container.querySelector(`.status-dot.${kind}`)).toBeTruthy();
      rerender(
        <ThreadStatusIndicator
          thread={{
            ...thread,
            notification: { ...thread.notification!, unread: false },
          }}
          locale="zh-CN"
        />,
      );
      expect(container.querySelector(".thread-unread-dot")).toBeNull();
      if (kind === "failed") {
        expect(container.querySelector(".status-dot.failed")).toBeTruthy();
        expect(screen.getByRole("img").getAttribute("aria-label")).toBeTruthy();
      } else {
        expect(container.querySelector(".status-dot")).toBeNull();
      }
    },
  );

  it("reflects background queue transitions and ignores activity from a previous turn", () => {
    const thread = { id: "thread", mode: "work", status: "running" } as Thread;
    const queued = event(1, { type: "turn.activity", phase: "queued" });
    const { container, rerender } = render(
      <ThreadStatusIndicator thread={thread} locale="en" events={[queued]} />,
    );
    expect(container.querySelector(".status-dot.queued")).toBeTruthy();
    rerender(
      <ThreadStatusIndicator
        thread={thread}
        locale="en"
        events={[
          queued,
          event(2, { type: "turn.activity", phase: "requesting-model" }),
        ]}
      />,
    );
    expect(container.querySelector(".status-dot.running")).toBeTruthy();
    rerender(
      <ThreadStatusIndicator
        thread={thread}
        locale="en"
        events={[queued, event(3, { type: "turn.started", mode: "work" })]}
      />,
    );
    expect(container.querySelector(".status-dot.running")).toBeTruthy();
    rerender(
      <ThreadStatusIndicator
        thread={thread}
        locale="en"
        events={[
          queued,
          event(4, { type: "turn.completed", reason: "completed" }),
        ]}
      />,
    );
    expect(container.querySelector(".status-dot")).toBeNull();
  });

  it("keeps waiting visible after reading and leaves idle tasks without a dot", () => {
    const { container, rerender } = render(
      <ThreadStatusIndicator
        thread={
          {
            status: "waiting-approval",
            notification: { unread: false },
          } as Thread
        }
        locale="en"
      />,
    );
    expect(
      container.querySelector(".status-dot.waiting-approval"),
    ).toBeTruthy();
    rerender(
      <ThreadStatusIndicator
        thread={{ status: "idle" } as Thread}
        locale="en"
      />,
    );
    expect(container.querySelector(".status-dot")).toBeNull();
  });

  it("keeps a loaded history queue phase until a newer activity replaces it", () => {
    const thread = { id: "thread", mode: "work", status: "running" } as Thread;
    const start = event(10, { type: "turn.started", mode: "work" });
    const historyState = reduceAgentEvents("thread", [
      start,
      event(20, { type: "turn.activity", phase: "queued" }),
    ]);
    expect(historyState.lastSeq).toBe(20);
    const { container, rerender } = render(
      <ThreadStatusIndicator
        thread={thread}
        locale="en"
        historyState={historyState}
        events={[
          start,
          event(19, { type: "turn.activity", phase: "thinking" }),
        ]}
      />,
    );
    expect(container.querySelector(".status-dot.queued")).toBeTruthy();
    rerender(
      <ThreadStatusIndicator
        thread={thread}
        locale="en"
        historyState={historyState}
        events={[
          start,
          event(21, { type: "turn.activity", phase: "thinking" }),
        ]}
      />,
    );
    expect(container.querySelector(".status-dot.running")).toBeTruthy();
    expect(historyState.lastSeq).toBe(20);
    expect(historyState.activity?.phase).toBe("queued");
  });
});

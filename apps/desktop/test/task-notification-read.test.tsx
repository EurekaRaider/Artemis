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
  createThreadViewState,
  type AgentEvent,
  type Thread,
} from "@artemis/protocol";
import { ThreadStatusIndicator } from "../src/renderer/ThreadStatusIndicator.js";
import { useTaskNotificationRead } from "../src/renderer/task-notification-read.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("notification reading and sidebar", () => {
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
    "clears the %s result dot after reading",
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
      expect(container.querySelector(".status-dot")).toBeNull();
    },
  );

  it("reflects background queue transitions and ignores activity from a previous turn", () => {
    const thread = { status: "running" } as Thread;
    const event = (payload: AgentEvent["payload"]) =>
      ({ payload }) as AgentEvent;
    const queued = event({ type: "turn.activity", phase: "queued" });
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
          event({ type: "turn.activity", phase: "requesting-model" }),
        ]}
      />,
    );
    expect(container.querySelector(".status-dot.running")).toBeTruthy();
    rerender(
      <ThreadStatusIndicator
        thread={thread}
        locale="en"
        events={[queued, event({ type: "turn.started", mode: "work" })]}
      />,
    );
    expect(container.querySelector(".status-dot.running")).toBeTruthy();
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
    const thread = { status: "running" } as Thread;
    const historyState = {
      ...createThreadViewState("thread", "work"),
      lastSeq: 20,
      activity: { type: "turn.activity", phase: "queued" } as const,
    };
    const start = {
      seq: 10,
      payload: { type: "turn.started", mode: "work" },
    } as AgentEvent;
    const { container, rerender } = render(
      <ThreadStatusIndicator
        thread={thread}
        locale="en"
        historyState={historyState}
        events={[start]}
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
          {
            seq: 21,
            payload: { type: "turn.activity", phase: "thinking" },
          } as AgentEvent,
        ]}
      />,
    );
    expect(container.querySelector(".status-dot.running")).toBeTruthy();
  });
});

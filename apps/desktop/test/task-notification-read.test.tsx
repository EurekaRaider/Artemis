// @vitest-environment jsdom
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Thread } from "@artemis/protocol";
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

  it("shows only a red failure dot while retaining the separate unread state", () => {
    const thread = {
      status: "failed",
      notification: { revision: 1, seq: 3, kind: "failed", unread: true },
    } as Thread;
    const { container, rerender } = render(
      <ThreadStatusIndicator thread={thread} locale="zh-CN" />,
    );
    expect(
      screen.getByRole("img", { name: /任务执行失败.*未读状态更新/ }),
    ).toBeTruthy();
    expect(container.querySelector(".thread-unread-dot")).toBeNull();
    expect(container.querySelector(".status-dot.failed")).toBeTruthy();
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
    expect(container.querySelector(".status-dot.failed")).toBeTruthy();
  });
});

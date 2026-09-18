// @vitest-environment jsdom
import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ImConnectionStatus,
  ImGroupContext,
  Thread,
} from "@artemis/protocol";
import { stubWindowArtemis } from "./renderer-test-utils.js";
import {
  ImThreadConnection,
  useImThreadStatus,
} from "../src/renderer/ImThreadConnection.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("IM thread connection indicators", () => {
  it.each([
    ["connected", "已连接", "message"],
    ["connecting", "连接中", "clock"],
    ["error", "连接异常", "alert"],
    ["disabled", "已停用", "unlink"],
    ["unknown", "状态未知", "info"],
  ] as const)(
    "labels and distinguishes %s without implying client presence",
    (connectionState, label, icon) => {
      render(
        <ImThreadConnection
          status={{ channel: "slack", connectionState }}
          locale="zh-CN"
        />,
      );
      const indicator = screen.getByRole("img");
      expect(screen.queryByRole("img", { name: "群协作对话" })).toBeNull();
      expect(indicator).toHaveAccessibleName(
        connectionState === "connected" ? "单聊·在线" : "单聊·离线",
      );
      expect(indicator).toHaveAttribute("data-state", connectionState);
      expect(
        indicator.querySelector(`[data-artemis-icon="${icon}"]`),
      ).toBeTruthy();
      expect(
        indicator.querySelector(
          '[data-artemis-icon="mobile"], [data-artemis-icon="monitor"]',
        ),
      ).toBeNull();
    },
  );

  it("renders a single group icon tinted by the IM connection state", () => {
    const group: ImGroupContext = {
      spaceId: "team",
      name: "Team",
      confirmed: true,
      executingDeviceId: "0",
      stale: false,
      members: [
        {
          deviceId: "0",
          name: "Member 0",
          deviceName: "Computer",
          state: "online",
          identity: {
            channel: "slack",
            connectionId: "w",
            tenantId: "t",
            appId: "a",
            userId: "0",
          },
        },
      ],
    };
    const { container, rerender } = render(
      <ImThreadConnection
        status={{ channel: "slack", connectionState: "connected", group }}
        locale="zh-CN"
      />,
    );
    // 群聊只保留群聊图标：连接图标与设备图标不再出现。
    expect(
      container.querySelectorAll(".im-thread-indicators [role='img']"),
    ).toHaveLength(1);
    const indicator = container.querySelector(".im-thread-group")!;
    expect(indicator).toHaveAttribute("data-state", "connected");
    expect(indicator).toHaveAccessibleName("群聊·在线");
    expect(
      indicator.querySelector('[data-artemis-icon="agents"]'),
    ).toBeTruthy();
    expect(container.querySelector(".im-thread-connection")).toBeNull();
    expect(container.querySelector(".im-thread-computers")).toBeNull();
    rerender(
      <ImThreadConnection
        status={{
          channel: "slack",
          connectionState: "error",
          group: { ...group, stale: true },
        }}
        locale="zh-CN"
      />,
    );
    expect(container.querySelector(".im-thread-group")).toHaveAttribute(
      "data-state",
      "error",
    );
  });

  it("marks unconfirmed native groups as disabled on the single group icon", () => {
    const group: ImGroupContext = {
      spaceId: "team",
      name: "Team",
      confirmed: false,
      executingDeviceId: "0",
      stale: false,
      native: true,
      members: [],
    };
    const { container } = render(
      <ImThreadConnection
        status={{ channel: "slack", connectionState: "connected", group }}
        locale="zh-CN"
      />,
    );
    expect(container.querySelector(".im-thread-group")).toHaveAttribute(
      "data-state",
      "disabled",
    );
  });

  it.each(["slack", "feishu", "lark", "wecom"])(
    "refreshes the real %s connection independently and clears stale success on failure",
    async (channel) => {
      vi.useFakeTimers();
      let connectionState: ImConnectionStatus["state"] | undefined;
      const getImStatus = vi.fn(async () => ({
        remoteTasks: [
          { threadId: "im-task", channel, kind: "direct", connectionState },
          {
            threadId: "other-task",
            channel,
            kind: "direct",
            connectionState: "error",
          },
        ],
      }));
      const unsubscribe = vi.fn();
      stubWindowArtemis({ getImStatus, onImTaskCreated: () => unsubscribe });
      const { result, unmount } = renderHook(useImThreadStatus);
      await act(async () => {});
      expect(result.current["im-task"]).toEqual({
        channel,
        connectionState: "unknown",
      });
      expect(result.current["local-task-titled-Slack"]).toBeUndefined();
      const unchanged = result.current;
      await act(() => vi.advanceTimersByTimeAsync(2000));
      expect(result.current).toBe(unchanged);
      for (const state of [
        "connected",
        "connecting",
        "error",
        "disabled",
        "connected",
      ] as const) {
        connectionState = state;
        await act(() => vi.advanceTimersByTimeAsync(2000));
        expect(result.current["im-task"]).toEqual({
          channel,
          connectionState: state,
        });
        expect(result.current["other-task"]?.connectionState).toBe("error");
      }
      getImStatus.mockRejectedValueOnce(new Error("temporarily unavailable"));
      await act(() => vi.advanceTimersByTimeAsync(2000));
      expect(result.current["im-task"]).toEqual({
        channel,
        connectionState: "unknown",
      });
      await act(async () => window.dispatchEvent(new Event("focus")));
      expect(result.current["im-task"]?.connectionState).toBe("connected");
      unmount();
      expect(unsubscribe).toHaveBeenCalledOnce();
      const count = getImStatus.mock.calls.length;
      await vi.advanceTimersByTimeAsync(4000);
      expect(getImStatus).toHaveBeenCalledTimes(count);
    },
  );

  it("shows a newly created IM conversation before the next status poll", async () => {
    let listener: ((thread: Thread) => void) | undefined;
    stubWindowArtemis({
      getImStatus: async () => ({ remoteTasks: [] }),
      onImTaskCreated: (next: typeof listener) => {
        listener = next;
        return () => {};
      },
    });
    const { result } = renderHook(useImThreadStatus);
    await act(async () => {});
    act(() => listener!({ id: "new-im" } as Thread));
    expect(result.current["new-im"]).toEqual({
      connectionState: "unknown",
    });
  });

  it("skips hidden-window polling and does not overlap requests or update after unmount", async () => {
    vi.useFakeTimers();
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    let resolve: (status: { remoteTasks: [] }) => void = () => {};
    const getImStatus = vi.fn(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    stubWindowArtemis({ getImStatus });
    const { result, unmount } = renderHook(useImThreadStatus);
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(getImStatus).not.toHaveBeenCalled();
    hidden.mockReturnValue(false);
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(getImStatus).toHaveBeenCalledOnce();
    unmount();
    await act(async () => resolve({ remoteTasks: [] }));
    expect(result.current).toEqual({});
  });
});

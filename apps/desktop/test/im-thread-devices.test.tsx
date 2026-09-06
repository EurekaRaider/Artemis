// @vitest-environment jsdom
import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImDevicePresence, Thread } from "@artemis/protocol";
import { stubWindowArtemis } from "./renderer-test-utils.js";
import {
  ImThreadDevices,
  useImThreadDevices,
} from "../src/renderer/ImThreadDevices.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("IM thread device indicators", () => {
  it.each([
    { mobile: true, desktop: true },
    { mobile: true, desktop: false },
    { mobile: false, desktop: true },
    { mobile: false, desktop: false },
  ])("renders the two independent device states: %j", (devices) => {
    render(<ImThreadDevices devices={devices} locale="zh-CN" />);
    const icons = screen.getByRole("img");
    expect(icons).toHaveAccessibleName(
      `手机${devices.mobile ? "已连接" : "未连接"} · 电脑${devices.desktop ? "已连接" : "未连接"}`,
    );
    expect(icons.querySelector('[data-artemis-icon="mobile"]')).toHaveAttribute(
      "data-connected",
      String(devices.mobile),
    );
    expect(
      icons.querySelector('[data-artemis-icon="monitor"]'),
    ).toHaveAttribute("data-connected", String(devices.desktop));
    expect(icons.querySelectorAll("svg")).toHaveLength(2);
  });

  it("uses real IM bindings, defaults unknown devices to computer only, and refreshes states independently", async () => {
    vi.useFakeTimers();
    let presence: ImDevicePresence | undefined;
    const getImStatus = vi.fn(async () => ({
      remoteTasks: [
        {
          threadId: "im-task",
          channel: "slack",
          kind: "direct",
          devicePresence: presence,
        },
      ],
    }));
    const unsubscribe = vi.fn();
    stubWindowArtemis({ getImStatus, onImTaskCreated: () => unsubscribe });
    const { result, unmount } = renderHook(useImThreadDevices);
    await act(async () => {});
    expect(result.current).toEqual({
      "im-task": { mobile: false, desktop: true },
    });
    expect(result.current["local-task-titled-Slack"]).toBeUndefined();
    const unchanged = result.current;
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(result.current).toBe(unchanged);
    for (const devices of [
      { mobile: true, desktop: false },
      { mobile: true, desktop: true },
      { mobile: false, desktop: false },
    ]) {
      presence = devices;
      await act(() => vi.advanceTimersByTimeAsync(2000));
      expect(result.current["im-task"]).toEqual(devices);
    }
    getImStatus.mockRejectedValueOnce(new Error("temporarily unavailable"));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(result.current["im-task"]).toEqual({
      mobile: false,
      desktop: false,
    });
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
    const count = getImStatus.mock.calls.length;
    await vi.advanceTimersByTimeAsync(4000);
    expect(getImStatus).toHaveBeenCalledTimes(count);
  });

  it("shows a newly created IM conversation before the next status poll", async () => {
    let listener: ((thread: Thread) => void) | undefined;
    stubWindowArtemis({
      getImStatus: async () => ({ remoteTasks: [] }),
      onImTaskCreated: (next: typeof listener) => {
        listener = next;
        return () => {};
      },
    });
    const { result } = renderHook(useImThreadDevices);
    await act(async () => {});
    act(() => listener!({ id: "new-im" } as Thread));
    expect(result.current["new-im"]).toEqual({ mobile: false, desktop: true });
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
    const { result, unmount } = renderHook(useImThreadDevices);
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

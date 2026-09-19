// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { stubWindowArtemis } from "./renderer-test-utils.js";
import { ImDelegationWaitStatus } from "../src/renderer/ImDelegationWaitStatus.js";
import { uiText } from "../src/shared/ui-text.js";
it("shows a compact waiting state, details and cancellation receipt", async () => {
  const manageIm = vi.fn().mockResolvedValue({ state: "cancel-sent" });
  stubWindowArtemis({ manageIm });
  const waits = [
    {
      id: "wait",
      state: "waiting" as const,
      taskIds: ["task"],
      continuation: "Review Solar results",
    },
  ];
  const { rerender } = render(
    <ImDelegationWaitStatus waits={waits} locale="zh-CN" />,
  );
  const summary = screen.getByText("等待委派结果");
  expect(summary.closest("details")).not.toHaveAttribute("open");
  fireEvent.click(summary);
  fireEvent.click(screen.getByRole("button", { name: "取消委派" }));
  await waitFor(() =>
    expect(manageIm).toHaveBeenCalledWith({
      action: "delegation-cancel",
      waitId: "wait",
    }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "远端取消状态以回执为准",
  );
  rerender(
    <ImDelegationWaitStatus
      waits={[{ ...waits[0]!, state: "ready" }]}
      locale="zh-CN"
    />,
  );
  expect(screen.getByText("委派结果已返回 · 等待继续处理")).toBeInTheDocument();
});

it("shows unknown status with explicit retry and keep-waiting choices", async () => {
  const manageIm = vi.fn().mockResolvedValue({ state: "waiting" });
  stubWindowArtemis({ manageIm });
  render(
    <ImDelegationWaitStatus
      locale="zh-CN"
      waits={[
        {
          id: "unknown",
          state: "interrupted",
          taskIds: ["task"],
          continuation: "Check files",
          reason: "队友状态未知",
          canContinue: true,
        },
      ]}
    />,
  );
  expect(screen.getByText("等待已结束")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "重新委派" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "继续等待" }));
  await waitFor(() =>
    expect(manageIm).toHaveBeenCalledWith({
      action: "delegation-continue-wait",
      waitId: "unknown",
    }),
  );
});

it("offers stop waiting after timeout without invoking remote cancellation", async () => {
  const manageIm = vi.fn(async () => ({
    state: "cancelled",
    remoteCancelled: false,
  }));
  stubWindowArtemis({ manageIm });
  render(
    <ImDelegationWaitStatus
      locale="zh-CN"
      waits={[
        {
          id: "timeout",
          state: "interrupted",
          taskIds: ["remote"],
          continuation: "Wait for directory listing",
          canContinue: true,
        },
      ]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "停止等待" }));
  expect(manageIm).toHaveBeenCalledWith({
    action: "delegation-stop-wait",
    waitId: "timeout",
  });
  expect(await screen.findByRole("status")).toHaveTextContent(
    "队友任务未被取消",
  );
});

it.each(["waiting", "interrupted"] as const)(
  "updates the %s receipt when the language changes without repeating the action",
  async (state) => {
    const manageIm = vi.fn(async () => ({}));
    stubWindowArtemis({ manageIm });
    const waits = [
      { id: "wait", state, taskIds: ["task"], continuation: "User text" },
    ];
    const { rerender } = render(
      <ImDelegationWaitStatus waits={waits} locale="zh-CN" />,
    );
    const key =
      state === "waiting"
        ? "ImDelegation.cancelSent"
        : "ImDelegation.waitStopped";
    fireEvent.click(
      screen.getByRole("button", {
        name: uiText(
          "zh-CN",
          state === "waiting"
            ? "ImDelegation.cancel"
            : "ImDelegation.stopWaiting",
        ),
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      uiText("zh-CN", key),
    );
    rerender(<ImDelegationWaitStatus waits={waits} locale="ja" />);
    expect(screen.getByRole("status")).toHaveTextContent(uiText("ja", key));
    expect(manageIm).toHaveBeenCalledTimes(1);
    expect(screen.getByText("User text")).toBeInTheDocument();
  },
);

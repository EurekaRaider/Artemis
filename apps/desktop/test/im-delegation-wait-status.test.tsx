// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { stubWindowArtemis } from "./renderer-test-utils.js";
import { ImDelegationWaitStatus } from "../src/renderer/ImDelegationWaitStatus.js";
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

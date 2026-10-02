// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { ComputerControlState } from "@artemis/protocol";
import { ComputerUseControls } from "../src/renderer/ComputerUseControls.js";
import { stubWindowArtemis } from "./renderer-test-utils.js";

it("stops, resumes and revokes the actual target's grant", async () => {
  const user = userEvent.setup();
  let state: ComputerControlState = {
    version: 1,
    state: "acting",
    threadId: "task",
    target: { id: "browser:1", kind: "browser", name: "Test Browser" },
  };
  let notify!: (value: ComputerControlState) => void;
  const unsubscribe = vi.fn();
  const permissions = vi.fn(async () => [
    {
      id: "browser",
      name: "Test Browser",
      scope: "task" as const,
      foreground: false,
      threadTitle: "填写表单",
    },
  ]);
  const revoke = vi.fn(async () => {
    permissions.mockResolvedValue([]);
  });
  const control = vi.fn(async (action: "stop" | "resume") => {
    state = { ...state, state: action === "stop" ? "paused" : "idle" };
    notify(state);
  });
  stubWindowArtemis({
    getComputerState: async () => state,
    onComputerState: (callback: typeof notify) => {
      notify = callback;
      return unsubscribe;
    },
    getComputerPermissions: permissions,
    revokeComputerPermission: revoke,
    controlComputer: control,
  });
  const rendered = render(<ComputerUseControls locale="zh-CN" />);
  await user.click(
    await screen.findByRole("button", { name: "停止", exact: true }),
  );
  expect(control).toHaveBeenCalledWith("stop", "task");
  await user.click(screen.getByRole("button", { name: "恢复", exact: true }));
  expect(control).toHaveBeenCalledWith("resume", "task");
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  rendered.unmount();
  expect(unsubscribe).toHaveBeenCalledOnce();

  render(<ComputerUseControls locale="zh-CN" permissionsOnly />);
  expect(await screen.findByRole("list", { name: "应用授权" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "应用授权" }),
  ).not.toBeInTheDocument();
  expect(
    await screen.findByText("本任务自主操作 · 仅后台操作 · 填写表单"),
  ).toBeVisible();
  await user.click(await screen.findByRole("button", { name: "撤销" }));
  expect(revoke).toHaveBeenCalledWith("browser");
  expect(await screen.findByText("没有应用授权")).toBeVisible();
});

// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { EnvironmentWorkspaceMenu } from "../src/renderer/EnvironmentWorkspaceMenu.js";

afterEach(cleanup);
it("hands off to a worktree, returns to Local and restores focus on Escape", async () => {
  const handoff = vi.fn().mockResolvedValue(undefined);
  const message = vi.fn();
  const props = {
    locale: "zh-CN" as const,
    path: "/fixture",
    disabled: false,
    onHandoff: handoff,
    onMessage: message,
  };
  const { rerender } = render(<EnvironmentWorkspaceMenu {...props} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "本地" }));
  expect(screen.getByRole("menuitemradio", { name: "本地" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await user.click(screen.getByRole("menuitem", { name: "新建本地工作树" }));
  expect(handoff).toHaveBeenCalledWith("managed-worktree");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  rerender(<EnvironmentWorkspaceMenu {...props} worktree />);
  await user.click(screen.getByRole("button", { name: "本地工作树" }));
  await user.click(screen.getByRole("menuitemradio", { name: "本地" }));
  expect(handoff).toHaveBeenLastCalledWith("local");
  await user.click(screen.getByRole("button", { name: "本地工作树" }));
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "本地工作树" })).toHaveFocus(),
  );
});
it("blocks running tasks and preserves the menu after a failed handoff", async () => {
  const handoff = vi.fn().mockRejectedValue(new Error("Handoff failed"));
  const message = vi.fn();
  const props = {
    locale: "zh-CN" as const,
    path: "/fixture",
    onHandoff: handoff,
    onMessage: message,
  };
  const { rerender } = render(<EnvironmentWorkspaceMenu {...props} disabled />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "本地" }));
  expect(
    screen.getByRole("menuitem", { name: "新建本地工作树" }),
  ).toBeDisabled();
  expect(handoff).not.toHaveBeenCalled();
  rerender(<EnvironmentWorkspaceMenu {...props} disabled={false} />);
  await user.click(screen.getByRole("menuitem", { name: "新建本地工作树" }));
  expect(message).toHaveBeenCalledWith("Handoff failed", true);
  expect(
    screen.getByRole("menuitem", { name: "新建本地工作树" }),
  ).toBeEnabled();
});

it("opens Artemis token usage from the workspace menu", async () => {
  const usage = vi.fn();
  render(
    <EnvironmentWorkspaceMenu
      locale="zh-CN"
      path="/fixture"
      disabled={false}
      onMessage={vi.fn()}
      onOpenUsage={usage}
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "本地" }));
  await user.click(screen.getByRole("menuitem", { name: "Token 用量" }));
  expect(usage).toHaveBeenCalledOnce();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

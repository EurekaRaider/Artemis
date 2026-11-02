// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { EnvironmentWorkspaceMenu } from "../../../src/renderer/workspace/EnvironmentWorkspaceMenu.js";

afterEach(cleanup);
it.each(["inline-start", "block-start"] as const)(
  "hands off to a worktree, returns to Local and restores focus on Escape from %s",
  async (placement) => {
    const handoff = vi.fn().mockResolvedValue(undefined);
    const message = vi.fn();
    const props = {
      locale: "zh-CN" as const,
      path: "/fixture",
      placement,
      disabled: false,
      onHandoff: handoff,
      onMessage: message,
      onOpenUsage: vi.fn(),
    };
    const { rerender } = render(<EnvironmentWorkspaceMenu {...props} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "本地检出" }));
    expect(
      screen.getByRole("menuitemradio", { name: "本地检出" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("menuitemradio", { name: "本地检出" }),
    ).toHaveAttribute("aria-description", "/fixture");
    expect(screen.getAllByRole("separator")).toHaveLength(1);
    expect(screen.getByRole("separator")).toBeVisible();
    expect(screen.getByRole("separator").nextElementSibling).toBe(
      screen.getByRole("menuitem", { name: "Token 用量" }),
    );
    await user.click(
      screen.getByRole("menuitem", {
        name: "交接到托管工作树…独立目录，互不干扰",
      }),
    );
    expect(handoff).toHaveBeenCalledWith("managed-worktree");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    rerender(<EnvironmentWorkspaceMenu {...props} worktree />);
    await user.click(screen.getByRole("button", { name: "本地工作树" }));
    await user.click(screen.getByRole("menuitemradio", { name: "本地检出" }));
    expect(handoff).toHaveBeenLastCalledWith("local");
    await user.click(screen.getByRole("button", { name: "本地工作树" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "本地工作树" })).toHaveFocus(),
    );
  },
);
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
  await user.click(screen.getByRole("button", { name: "本地检出" }));
  expect(
    screen.getByRole("menuitem", {
      name: "交接到托管工作树…独立目录，互不干扰",
    }),
  ).toBeDisabled();
  expect(handoff).not.toHaveBeenCalled();
  rerender(<EnvironmentWorkspaceMenu {...props} disabled={false} />);
  await user.click(
    screen.getByRole("menuitem", {
      name: "交接到托管工作树…独立目录，互不干扰",
    }),
  );
  expect(message).toHaveBeenCalledWith("Handoff failed", true);
  expect(
    screen.getByRole("menuitem", {
      name: "交接到托管工作树…独立目录，互不干扰",
    }),
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
  await user.click(screen.getByRole("button", { name: "本地检出" }));
  await user.click(screen.getByRole("menuitem", { name: "Token 用量" }));
  expect(usage).toHaveBeenCalledOnce();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

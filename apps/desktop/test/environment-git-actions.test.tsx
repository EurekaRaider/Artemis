// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { EnvironmentPanel } from "../src/renderer/EnvironmentPanel.js";
import { stubWindowArtemis } from "./renderer-test-utils.js";

afterEach(cleanup);

it("keeps AI generation errors visible and lets the user retry with a manual message", async () => {
  let rejectCommit!: (reason: Error) => void;
  const commit = vi.fn().mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectCommit = reject;
      }),
  );
  const gitInfo = {
    managed: true,
    root: "/fixture",
    currentBranch: "main",
    detached: false,
    branches: [{ name: "main", current: true }],
    changeCount: 1,
    additions: 1,
    deletions: 0,
    stagedCount: 0,
    stagedAdditions: 0,
    stagedDeletions: 0,
    unstagedCount: 1,
    untrackedCount: 0,
    conflictCount: 0,
    ahead: 0,
    behind: 0,
  };
  stubWindowArtemis({
    getProjectGitInfo: vi.fn().mockResolvedValue(gitInfo),
    getProjectPullRequest: vi.fn().mockResolvedValue({ status: "none" }),
    onProjectGitChanged: () => () => {},
    commitProjectChanges: commit,
  });
  const noop = () => {};
  render(
    <EnvironmentPanel
      project={{
        id: "p",
        name: "Demo",
        path: "/fixture",
        createdAt: "2026-09-08T00:00:00Z",
        updatedAt: "2026-09-08T00:00:00Z",
      }}
      actionsDisabled={false}
      defaultOpen
      dockOpen={false}
      locale="zh-CN"
      agents={[]}
      attachments={[]}
      mcpUsages={[]}
      sources={[]}
      teams={[]}
      taskTitle="Demo"
      onAddProject={noop}
      onAddSources={noop}
      onConfirm={async () => false}
      onMessage={noop}
      onOpenAgent={noop}
      onOpenReview={noop}
      onOpenTeam={noop}
      onOpenUrl={noop}
      onViewAllSources={noop}
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "任务环境" }));
  const entry = await screen.findByRole("button", { name: "提交或推送" });
  expect(screen.getByRole("button", { name: /变更.*\+1.*−0/ })).toBeTruthy();
  expect(entry.querySelector("svg")).not.toBeNull();
  expect(screen.queryByText("当前分支")).toBeNull();
  expect(screen.getByRole("button", { name: "main" }).title).toBe("main");
  await user.click(entry);
  const dialog = within(screen.getByRole("dialog", { name: "提交或推送" }));
  const textarea = dialog.getByRole("textbox", { name: "提交说明" });
  expect(textarea.getAttribute("placeholder")).toContain("AI 总结本次改动");
  await user.click(dialog.getByRole("button", { name: /^提交\s*⌘/ }));
  expect(commit).toHaveBeenCalledWith("p", "", true, undefined);
  expect(
    dialog
      .getByRole("button", { name: /AI 总结并提交中/ })
      .hasAttribute("disabled"),
  ).toBe(true);
  await act(async () => rejectCommit(new Error("AI generation failed")));
  expect((await dialog.findByRole("alert")).textContent).toContain(
    "AI generation failed",
  );
  await user.type(textarea, "Improve the environment actions");
  expect(
    dialog.getByRole("button", { name: /^提交\s*⌘/ }).hasAttribute("disabled"),
  ).toBe(false);
});

it("keeps PR retry feedback visible until a successful query clears it", async () => {
  let resolveLookup!: (value: { status: "none" }) => void;
  const lookup = vi
    .fn()
    .mockRejectedValueOnce(new Error("GraphQL EOF"))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLookup = resolve;
        }),
    );
  const gitInfo = {
    managed: true,
    root: "/fixture",
    currentBranch: "main",
    detached: false,
    branches: [{ name: "main", current: true }],
    changeCount: 1,
    additions: 1,
    deletions: 0,
    stagedCount: 0,
    stagedAdditions: 0,
    stagedDeletions: 0,
    unstagedCount: 1,
    untrackedCount: 0,
    conflictCount: 0,
    ahead: 0,
    behind: 0,
  };
  stubWindowArtemis({
    getProjectGitInfo: vi.fn().mockResolvedValue(gitInfo),
    getProjectPullRequest: lookup,
    onProjectGitChanged: () => () => {},
  });
  const noop = () => {};
  render(
    <EnvironmentPanel
      project={{
        id: "p",
        name: "Demo",
        path: "/fixture",
        createdAt: "2026-09-08T00:00:00Z",
        updatedAt: "2026-09-08T00:00:00Z",
      }}
      actionsDisabled={false}
      defaultOpen
      dockOpen={false}
      locale="zh-CN"
      agents={[]}
      attachments={[]}
      mcpUsages={[]}
      sources={[]}
      teams={[]}
      taskTitle="Demo"
      onAddProject={noop}
      onAddSources={noop}
      onConfirm={async () => false}
      onMessage={noop}
      onOpenAgent={noop}
      onOpenReview={noop}
      onOpenTeam={noop}
      onOpenUrl={noop}
      onViewAllSources={noop}
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "任务环境" }));
  await screen.findByText("暂时无法获取 PR 状态");
  expect(screen.queryByText("GraphQL EOF")).toBeNull();
  await user.click(screen.getByRole("button", { name: "重试" }));
  expect(
    screen.getByRole("button", { name: "正在重试…" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(screen.getByText("暂时无法获取 PR 状态")).toBeTruthy();
  await act(async () => resolveLookup({ status: "none" }));
  expect(screen.queryByText("暂时无法获取 PR 状态")).toBeNull();
  expect(lookup).toHaveBeenCalledTimes(2);
});

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
  expect(entry.querySelector("svg")).not.toBeNull();
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

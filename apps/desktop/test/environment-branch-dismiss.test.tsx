// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { EnvironmentPanel } from "../src/renderer/EnvironmentPanel.js";
import { stubWindowArtemis } from "./renderer-test-utils.js";
afterEach(cleanup);
it("dismisses branch creation outside even when the surface stops bubbling, while retaining inside interactions", async () => {
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
  await user.click(await screen.findByRole("button", { name: "main" }));
  await user.click(screen.getByRole("menuitem", { name: "创建并检出新分支…" }));
  const input = screen.getByRole("textbox", { name: "分支名称" });
  await user.type(input, "codex/demo");
  expect(screen.getByDisplayValue("codex/demo")).toBeTruthy();
  const outside = document.createElement("div");
  outside.textContent = "outside";
  outside.addEventListener("pointerdown", (event) => event.stopPropagation());
  document.body.append(outside);
  try {
    await user.click(outside);
    expect(screen.queryByDisplayValue("codex/demo")).toBeNull();
  } finally {
    outside.remove();
  }
});

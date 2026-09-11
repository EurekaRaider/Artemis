// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { EnvironmentPanel } from "../src/renderer/EnvironmentPanel.js";
import { stubWindowArtemis } from "./renderer-test-utils.js";
afterEach(cleanup);
it.each(["switch", "create"])(
  "does not restore the previous branch after %s",
  async (action) => {
    const gitInfo = {
      managed: true,
      root: "/fixture",
      currentBranch: "main",
      detached: false,
      branches: [
        { name: "main", current: true },
        { name: "next", current: false },
      ],
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
    const read = vi.fn().mockResolvedValue(gitInfo);
    let changed!: (context: { projectId: string; threadId?: string }) => void;
    stubWindowArtemis({
      getProjectGitInfo: read,
      createProjectBranch: vi
        .fn()
        .mockResolvedValue({ ...gitInfo, currentBranch: "next" }),
      switchProjectBranch: vi
        .fn()
        .mockResolvedValue({ ...gitInfo, currentBranch: "next" }),
      getProjectPullRequest: vi.fn().mockResolvedValue({ status: "none" }),
      onProjectGitChanged: (listener) => {
        changed = listener;
        return () => {};
      },
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
    await screen.findByRole("button", { name: "main" });
    let resolveOld!: (info: typeof gitInfo) => void;
    read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    await act(async () => changed({ projectId: "p" }));
    await user.click(screen.getByRole("button", { name: "main" }));
    if (action === "switch") {
      await user.click(screen.getByRole("menuitemradio", { name: "next" }));
    } else {
      await user.click(
        screen.getByRole("menuitem", { name: "创建并检出新分支…" }),
      );
      await user.type(
        screen.getByRole("textbox", { name: "分支名称" }),
        "next",
      );
      await user.keyboard("{Enter}");
    }
    await screen.findByRole("button", { name: "next" });
    await act(async () => resolveOld(gitInfo));
    expect(screen.queryByRole("button", { name: "main" })).toBeNull();
    expect(screen.getByRole("button", { name: "next" })).toBeTruthy();
  },
);

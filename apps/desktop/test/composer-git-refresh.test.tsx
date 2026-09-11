// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ComposerContextBar } from "../src/renderer/ComposerContextBar.js";
import { stubWindowArtemis } from "./renderer-test-utils.js";
const project = {
  id: "p",
  name: "Demo",
  path: "/local",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};
afterEach(cleanup);
it("reads and refreshes the active task checkout instead of the project checkout", async () => {
  let changed!: (context: { projectId: string; threadId?: string }) => void;
  const read = vi
    .fn()
    .mockResolvedValue({ managed: true, currentBranch: "old", branches: [] });
  stubWindowArtemis({
    getProjectGitInfo: read,
    onProjectGitChanged: (listener) => {
      changed = listener;
      return () => {};
    },
  });
  render(
    <ComposerContextBar
      activeProject={project}
      threadId="task"
      branchActionsDisabled={false}
      locale="zh-CN"
      mode="execute"
      modeActionsDisabled={false}
      onClearProject={vi.fn()}
      onError={vi.fn()}
      onModeChange={vi.fn()}
      onOpenProject={async () => {}}
      onSelectProject={vi.fn()}
      projects={[project]}
    />,
  );
  await screen.findByRole("button", { name: "old" });
  expect(read).toHaveBeenLastCalledWith("p", "task");
  const count = read.mock.calls.length;
  await act(async () => changed({ projectId: "p", threadId: "other" }));
  expect(read).toHaveBeenCalledTimes(count);
  read.mockResolvedValue({ managed: true, currentBranch: "new", branches: [] });
  await act(async () => changed({ projectId: "p", threadId: "task" }));
  await screen.findByRole("button", { name: "new" });
});

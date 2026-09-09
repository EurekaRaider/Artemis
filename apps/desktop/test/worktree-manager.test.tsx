// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { WorktreeManager } from "../src/renderer/WorktreeManager.js";
import type { WorktreeCleanupCandidate } from "../src/shared/api.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function row(
  id: string,
  changes: Partial<WorktreeCleanupCandidate> = {},
): WorktreeCleanupCandidate {
  return {
    worktree: {
      id,
      threadId: id,
      projectId: "p",
      path: `/fixture/${id}`,
      target: "managed-worktree",
      status: "active",
      head: "abc",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    },
    title: id,
    projectName: "Example",
    busy: false,
    expired: true,
    clean: true,
    pushedToGitHub: true,
    recommended: true,
    ...changes,
  };
}
it("defaults only to recommended worktrees and requires explicit deletion confirmation", async () => {
  const remove = vi.fn().mockResolvedValue({});
  const changed = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(window, "artemis", {
    configurable: true,
    value: {
      listWorktreeCleanupCandidates: vi
        .fn()
        .mockResolvedValue([
          row("old"),
          row("local", { recommended: false, pushedToGitHub: false }),
          row("running", { recommended: false, busy: true }),
          row("dirty", { recommended: false, clean: false }),
        ]),
      cleanupWorktree: remove,
    },
  });
  render(
    <WorktreeManager locale="zh-CN" onClose={vi.fn()} onChanged={changed} />,
  );
  const boxes = await screen.findAllByRole("checkbox");
  await waitFor(() => expect(boxes[0]).toBeEnabled());
  expect(boxes[0]).toBeChecked();
  expect(boxes[1]).not.toBeChecked();
  expect(boxes[2]).toBeDisabled();
  expect(boxes[3]).toBeDisabled();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "删除所选 (1)" }));
  expect(remove).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "确认删除" }));
  await waitFor(() => expect(changed).toHaveBeenCalled());
  expect(remove).toHaveBeenCalledExactlyOnceWith("old", false);
  expect(screen.queryByText("Example · old")).not.toBeInTheDocument();
});
it("retains failed selections and shows deletion errors", async () => {
  Object.defineProperty(window, "artemis", {
    configurable: true,
    value: {
      listWorktreeCleanupCandidates: vi.fn().mockResolvedValue([row("old")]),
      cleanupWorktree: vi
        .fn()
        .mockRejectedValue(new Error("Worktree became dirty")),
    },
  });
  render(<WorktreeManager locale="en-US" onClose={vi.fn()} />);
  const user = userEvent.setup();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Delete selected (1)" }),
    ).toBeEnabled(),
  );
  await user.click(screen.getByRole("button", { name: "Delete selected (1)" }));
  await user.click(screen.getByRole("button", { name: "Confirm deletion" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Worktree became dirty",
  );
  expect(screen.getByRole("checkbox")).toBeChecked();
});

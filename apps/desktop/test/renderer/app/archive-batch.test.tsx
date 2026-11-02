// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Thread } from "@artemis/protocol";
import "../../fixtures/renderer-test-utils.js";
import { ArchivePage } from "../../../src/renderer/app/ArchivePage.js";

const threads = [1, 2].map((index): Thread => ({
  id: `task-${index}`,
  title: `Task ${index}`,
  archived: true,
  pinned: false,
  mode: "work",
  target: "local",
  status: "idle",
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
}));
describe("archive selection", () => {
  it.each(["filter", "escape", "clear"])(
    "keeps selection cleared by %s while a batch finishes",
    async (action) => {
      const user = userEvent.setup();
      let finish!: (succeeded: string[]) => void;
      const pending = new Promise<string[]>((resolve) => {
        finish = resolve;
      });
      render(
        <ArchivePage
          locale="en"
          projects={[]}
          threads={threads}
          onOpen={vi.fn()}
          onRestore={vi.fn()}
          onDelete={vi.fn()}
          onBatch={() => pending}
        />,
      );
      await user.click(screen.getByRole("checkbox", { name: "Task 1" }));
      await user.click(
        screen.getByRole("button", { name: "Restore", exact: true }),
      );
      if (action === "filter")
        await user.type(screen.getByRole("searchbox"), "Task");
      else if (action === "escape") await user.keyboard("{Escape}");
      else
        await user.click(
          screen.getByRole("button", { name: "Clear selection" }),
        );
      expect(screen.queryByRole("toolbar")).toBeNull();
      await act(async () => {
        finish([]);
        await pending;
      });
      await waitFor(() =>
        expect(
          screen.getByRole("checkbox", { name: "Task 1" }),
        ).not.toBeDisabled(),
      );
      expect(screen.queryByRole("toolbar")).toBeNull();
      expect(
        screen.getByRole("checkbox", { name: "Task 1" }),
      ).not.toBeChecked();
    },
  );
  it("selects without opening and preserves only failed items after a batch", async () => {
    const user = userEvent.setup(),
      open = vi.fn(),
      batch = vi.fn(async () => ["task-1"]);
    render(
      <ArchivePage
        locale="zh-CN"
        projects={[]}
        threads={threads}
        onOpen={open}
        onRestore={vi.fn()}
        onDelete={vi.fn()}
        onBatch={batch}
      />,
    );
    await user.click(screen.getByRole("checkbox", { name: "Task 1" }));
    await user.click(screen.getByRole("checkbox", { name: "Task 2" }));
    expect(screen.getByRole("toolbar")).toHaveTextContent("已选 2 项");
    expect(open).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "永久删除…", exact: true }),
    );
    expect(batch).toHaveBeenCalledExactlyOnceWith(threads, "delete");
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: "Task 1" }),
      ).not.toBeChecked(),
    );
    expect(screen.getByRole("checkbox", { name: "Task 2" })).toBeChecked();
    expect(screen.getByRole("alert")).toHaveTextContent("1 个任务操作失败");
  });
  it("supports keyboard toggle, Escape, cancelled confirmation and filter clearing", async () => {
    const user = userEvent.setup(),
      batch = vi.fn(async () => undefined);
    render(
      <ArchivePage
        locale="en"
        projects={[]}
        threads={threads}
        onOpen={vi.fn()}
        onRestore={vi.fn()}
        onDelete={vi.fn()}
        onBatch={batch}
      />,
    );
    screen.getByRole("checkbox", { name: "Task 1" }).focus();
    await user.keyboard(" ");
    await user.click(
      screen.getByRole("button", { name: "Permanently delete…", exact: true }),
    );
    expect(screen.getByRole("checkbox", { name: "Task 1" })).toBeChecked();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("toolbar")).toBeNull();
    await user.click(screen.getByRole("checkbox", { name: "Task 2" }));
    await user.type(screen.getByRole("searchbox"), "Task");
    expect(screen.queryByRole("toolbar")).toBeNull();
  });
});

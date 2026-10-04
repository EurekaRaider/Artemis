// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { HookTaskNotice } from "../src/renderer/HookTaskNotice.js";
import { stubWindowArtemis } from "./renderer-test-utils.js";
afterEach(cleanup);
const catalog = {
  hooks: [{ id: "hook", source: "project", status: "pending" }],
  records: [],
  projectId: "project",
  workspacePath: "/project",
};
it.each([false, true])(
  "shows hook review for Execute tasks (IM: %s)",
  async (remote) => {
    stubWindowArtemis({
      listHooks: vi.fn().mockResolvedValue({ ...catalog, remote }),
    });
    render(
      <HookTaskNotice
        locale="zh-CN"
        projectId="project"
        mode="work"
        onReview={() => {}}
      />,
    );
    expect(await screen.findByRole("status")).toHaveProperty(
      "className",
      "hook-task-notice",
    );
    expect(screen.getByRole("button", { name: "审核钩子" })).toBeTruthy();
  },
);
it.each(["plan"])(
  "keeps %s composer free of inapplicable hook reminders",
  async (mode) => {
    const listHooks = vi.fn().mockResolvedValue(catalog);
    stubWindowArtemis({ listHooks });
    render(
      <HookTaskNotice
        locale="en"
        projectId="project"
        mode={mode}
        onReview={() => {}}
      />,
    );
    await waitFor(() => expect(listHooks).toHaveBeenCalled());
    expect(screen.queryByRole("status")).toBeNull();
  },
);
it("does not show another project's hooks in a new temporary task", async () => {
  const listHooks = vi.fn().mockResolvedValue(catalog);
  stubWindowArtemis({ listHooks });
  render(<HookTaskNotice locale="en" mode="work" onReview={() => {}} />);
  await waitFor(() => expect(listHooks).toHaveBeenCalled());
  expect(screen.queryByRole("status")).toBeNull();
});

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
it("uses a quiet actionable status instead of a sandbox warning", async () => {
  stubWindowArtemis({ listHooks: vi.fn().mockResolvedValue(catalog) });
  render(
    <HookTaskNotice
      locale="zh-CN"
      projectId="project"
      mode="execute"
      onReview={() => {}}
    />,
  );
  expect(await screen.findByRole("status")).toHaveProperty(
    "className",
    "hook-task-notice",
  );
  expect(screen.getByRole("button", { name: "审核钩子" })).toBeTruthy();
});
it.each(["plan", "review"])(
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
  render(<HookTaskNotice locale="en" mode="execute" onReview={() => {}} />);
  await waitFor(() => expect(listHooks).toHaveBeenCalled());
  expect(screen.queryByRole("status")).toBeNull();
});

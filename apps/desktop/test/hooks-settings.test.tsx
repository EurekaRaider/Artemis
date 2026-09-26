// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { HookDefinition } from "@artemis/protocol";
import { HooksSettingsSection } from "../src/renderer/HooksSettingsSection.js";
import { stubWindowArtemis } from "./renderer-test-utils.js";
afterEach(cleanup);
const hook: HookDefinition = {
  id: "h",
  hash: "current",
  event: "PermissionRequest",
  matcher: "Bash",
  command: "node .artemis/hooks/check.mjs",
  timeout: 30,
  source: "project",
  sourceId: "project",
  sourcePath: "/project/.artemis/hooks.json",
  description: "Check commands",
  scripts: [],
  status: "pending",
  scope: "project",
};
it("requires deliberate selection and shows command, permissions and scope before trusting", async () => {
  const trustHooks = vi.fn().mockResolvedValue(undefined);
  stubWindowArtemis({
    listHooks: vi.fn().mockResolvedValue({
      hooks: [hook],
      workspacePath: "/project",
      projectId: "project",
      records: [],
    }),
    trustHooks,
  });
  render(
    <HooksSettingsSection
      locale="en"
      projects={[{ id: "project", name: "Project" }]}
      initialQuery={{ projectId: "project" }}
    />,
  );
  const checkbox = await screen.findByRole("checkbox");
  expect(
    checkbox.getAttribute("aria-checked") ??
      (checkbox as HTMLInputElement).checked,
  ).not.toBe(true);
  expect(screen.queryByRole("button", { name: /Trust and enable/ })).toBeNull();
  expect(screen.queryByText(hook.command)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Review hooks" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.getByText(hook.command)).toBeTruthy();
  expect(screen.getByText(/approve or deny agent tool/)).toBeTruthy();

  expect(screen.getByText(/current desktop user/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Trust and enable/ }));
  await waitFor(() =>
    expect(trustHooks).toHaveBeenCalledWith(
      { projectId: "project" },
      [{ id: "h", hash: "current" }],
      "project",
    ),
  );
});
it("shows stale approval changes and preserves review errors", async () => {
  stubWindowArtemis({
    listHooks: vi.fn().mockResolvedValue({
      hooks: [{ ...hook, previousHash: "old", previousCommand: "old command" }],
      workspacePath: "/project",
      projectId: "project",
      records: [],
    }),
    trustHooks: vi
      .fn()
      .mockRejectedValue(new Error("Hook changed since review")),
  });
  render(
    <HooksSettingsSection
      locale="en"
      initialQuery={{ projectId: "project" }}
    />,
  );
  fireEvent.click(await screen.findByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Review hooks (1)" }));
  expect(screen.getByText("Changes since approval")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Trust and enable/ }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Error: Hook changed since review",
  );
});
it("keeps review details out of the list and returns focus when closing the dialog", async () => {
  stubWindowArtemis({
    listHooks: vi
      .fn()
      .mockResolvedValue({
        hooks: [hook],
        workspacePath: "/project",
        projectId: "project",
        records: [],
      }),
  });
  render(
    <HooksSettingsSection
      locale="zh-CN"
      initialQuery={{ projectId: "project" }}
    />,
  );
  const review = await screen.findByRole("button", { name: "审核钩子" });
  review.focus();
  fireEvent.click(review);
  expect(screen.getByRole("dialog", { name: "审核钩子" })).toBeTruthy();
  expect(screen.getByText("工作目录")).toBeTruthy();
  fireEvent.click(screen.getAllByRole("button", { name: "关闭" }).at(-1)!);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(review);
});

// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { stubWindowArtemis } from "../../fixtures/renderer-test-utils.js";
import { ProjectInstructionsDialog } from "../../../src/renderer/workspace/ProjectInstructionsDialog.js";
const project = {
  id: "project",
  name: "Fixture",
  path: "/tmp/local-checkout",
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
};
describe("manual project instruction editor", () => {
  it("confirms unsaved closure and saves only through the fixed project endpoint", async () => {
    const user = userEvent.setup(),
      write = vi.fn(async () => {}),
      close = vi.fn(),
      confirm = vi.fn(async () => false);
    stubWindowArtemis({
      readProjectInstructions: async () => "",
      writeProjectInstructions: write,
    });
    render(
      <ProjectInstructionsDialog
        project={project}
        locale="zh-CN"
        onClose={close}
        onConfirm={confirm}
      />,
    );
    await user.type(
      await screen.findByRole("textbox", { name: "AGENTS.md" }),
      "Project rules",
    );
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "保存", exact: true }));
    expect(write).toHaveBeenCalledExactlyOnceWith(project.id, "Project rules");
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(close).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledOnce();
  });
});

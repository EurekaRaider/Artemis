import { describe, expect, it, vi } from "vitest";
import { registerPromptTemplatesIpc } from "../../../src/main/ipc/prompt-templates.js";
const mocks = vi.hoisted(() => ({
  list: vi.fn(async () => [
    {
      name: "review",
      content: "private template",
      scope: "project",
      description: "Review",
    },
  ]),
}));
vi.mock("@artemis/agent-host/prompt-templates", () => ({
  listPromptTemplates: mocks.list,
}));
vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => "/agent",
}));
describe("prompt template IPC scope", () => {
  it("uses the task worktree, strips content, and rejects unrelated windows and projects", async () => {
    let handler: (...args: any[]) => Promise<unknown>;
    const frame = {},
      sender = { id: 1, mainFrame: frame };
    const resolve = vi.fn(async () => ({ workspacePath: "/worktree" }));
    registerPromptTemplatesIpc({
      ipcMain: {
        handle: (_channel: string, h: typeof handler) => {
          handler = h;
        },
      },
      mainWindow: { webContents: sender },
      store: {
        getThread: () => ({ id: "task", projectId: "project" }),
        getProject: () => ({ path: "/project" }),
      },
      resolveThreadWorkspace: resolve,
    } as never);
    const event = { sender, senderFrame: frame };
    expect(await handler!(event, "project", "task")).toEqual([
      { name: "review", scope: "project", description: "Review" },
    ]);
    expect(mocks.list).toHaveBeenLastCalledWith("/agent", "/worktree");
    await expect(
      handler!({ ...event, senderFrame: {} }, "project"),
    ).rejects.toThrow("main window");
    await expect(
      handler!({ ...event, sender: { id: 2 } }, "project"),
    ).rejects.toThrow("main window");
    await expect(handler!(event, "other", "task")).rejects.toThrow(
      "does not belong",
    );
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});

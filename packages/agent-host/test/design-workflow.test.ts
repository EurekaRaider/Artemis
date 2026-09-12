import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AgentSession } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { ArtemisAgentHost } from "../src/runtime.js";

afterEach(() => vi.restoreAllMocks());

it("restricts a design turn at execution, then restores code tools in the same Pi session", async () => {
  const root = await mkdtemp(join(tmpdir(), "artemis-design-workflow-"));
  const workspacePath = join(root, "workspace");
  await mkdir(workspacePath);
  const broker = {
    request: vi.fn(async () => {
      throw new Error("Unexpected broker execution");
    }),
  };
  const host = new ArtemisAgentHost(
    broker,
    { emit() {} },
    { agentDir: join(root, "agent") },
  );
  try {
    await host.configure({
      credentials: {},
      mcpTools: [
        {
          serverId: "fixture",
          serverName: "fixture",
          transport: "stdio",
          piName: "fixture_write",
          toolName: "write",
          description: "Fixture write",
          inputSchema: { type: "object", properties: {} },
          readOnly: false,
          destructive: false,
        },
      ],
    });
    await host.openThread({
      threadId: "design",
      workspacePath,
      target: "local",
    });
    const thread = (host as any).threads.get("design");
    await thread.executeTools
      .find((tool: { name: string }) => tool.name === "search_mcp_tools")
      .execute("discover", { query: "fixture", limit: 1 });
    const session = thread.session;
    const ordinaryTools = thread.executeTools.map(
      (tool: { name: string }) => tool.name,
    );
    const blocked = thread.executeTools.filter((tool: { name: string }) =>
      [
        "write",
        "shell",
        "office_document",
        "spawn_agent",
        "local_file_write",
        "save_memory",
        "send_message",
        "fixture_write",
      ].includes(tool.name),
    );
    const spy = vi
      .spyOn(AgentSession.prototype, "prompt")
      .mockImplementation(async function () {
        expect(this).toBe(session);
        expect(this.agent.state.tools.map((tool) => tool.name)).toEqual(
          expect.arrayContaining(["read", "request_user_input"]),
        );
        expect(
          this.agent.state.tools.some(
            (tool) =>
              ordinaryTools.includes(tool.name) &&
              ![
                "read",
                "request_user_input",
                "attachment_list",
                "attachment_read",
                "attachment_search",
              ].includes(tool.name),
          ),
        ).toBe(false);
        for (const tool of blocked)
          await expect(tool.execute("forged", {})).rejects.toThrow(
            /design workflow/i,
          );
      });
    await host.prompt(
      "design",
      "turn-design",
      "Explore a design",
      "execute",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "design",
    );
    expect(broker.request).not.toHaveBeenCalled();
    spy.mockImplementation(async function () {
      expect(this).toBe(session);
      expect(this.agent.state.tools.map((tool) => tool.name)).toEqual(
        ordinaryTools,
      );
    });
    await host.prompt("design", "turn-code", "Implement", "execute");
  } finally {
    host.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

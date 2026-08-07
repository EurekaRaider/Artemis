import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import type { BrokerExecutionRequest } from "@artemis/protocol";

import { ArtemisAgentHost } from "../src/runtime.js";

interface InspectableTool {
  name: string;
  execute(
    toolCallId: string,
    parameters: Record<string, unknown>,
  ): Promise<unknown>;
}

interface InspectableThread {
  executeTools: InspectableTool[];
  currentTurnId?: string;
  currentMode?: "execute" | "plan" | "review";
}

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("MCP task workspace propagation", () => {
  it("includes the opened task workspace in every MCP broker request", async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), "artemis-mcp-task-workspace-"),
    );
    cleanupPaths.push(workspacePath);
    const requests: BrokerExecutionRequest[] = [];
    const host = new ArtemisAgentHost(
      {
        async request(request) {
          requests.push(request);
          return {
            approved: true,
            data: { output: "indexed", isError: false },
          };
        },
      },
      { emit() {} },
    );
    await host.configure({
      credentials: {},
      mcpTools: [
        {
          serverId: "codegraph",
          serverName: "CodeGraph",
          transport: "stdio",
          piName: "codegraph_codegraph_status",
          toolName: "codegraph_status",
          description: "Inspect the current project graph",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: { type: "string" },
            },
          },
          readOnly: true,
        },
      ],
    });
    await host.openThread({
      threadId: "mcp-workspace-thread",
      workspacePath,
      target: "local",
    });
    const thread = (
      host as unknown as { threads: Map<string, InspectableThread> }
    ).threads.get("mcp-workspace-thread");
    expect(thread).toBeDefined();
    if (thread) {
      thread.currentTurnId = "turn-1";
      thread.currentMode = "execute";
    }
    const tool = thread?.executeTools.find(
      (candidate) => candidate.name === "codegraph_codegraph_status",
    );
    expect(tool).toBeDefined();

    await tool?.execute("mcp-call", { projectPath: workspacePath });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      kind: "mcp.call",
      threadId: "mcp-workspace-thread",
      workspacePath,
      serverId: "codegraph",
      toolName: "codegraph_status",
    });

    host.dispose();
  });

  it("keeps readable server-qualified names when MCP servers expose the same tool name", async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), "artemis-mcp-name-collision-"),
    );
    cleanupPaths.push(workspacePath);
    const host = new ArtemisAgentHost(
      {
        async request() {
          return { approved: true };
        },
      },
      { emit() {} },
    );
    await host.configure({
      credentials: {},
      mcpTools: [
        {
          serverId: "first",
          serverName: "First",
          transport: "stdio",
          piName: "first_search",
          toolName: "search",
          description: "Search the first source",
          inputSchema: { type: "object", properties: {} },
          readOnly: true,
        },
        {
          serverId: "second",
          serverName: "Second",
          transport: "stdio",
          piName: "second_search",
          toolName: "search",
          description: "Search the second source",
          inputSchema: { type: "object", properties: {} },
          readOnly: true,
        },
      ],
    });
    await host.openThread({
      threadId: "mcp-collision-thread",
      workspacePath,
      target: "local",
    });
    const thread = (
      host as unknown as { threads: Map<string, InspectableThread> }
    ).threads.get("mcp-collision-thread");
    const names = thread?.executeTools.map((tool) => tool.name) ?? [];

    expect(names).not.toContain("search");
    expect(names).toEqual(
      expect.arrayContaining(["first_search", "second_search"]),
    );

    host.dispose();
  });
});

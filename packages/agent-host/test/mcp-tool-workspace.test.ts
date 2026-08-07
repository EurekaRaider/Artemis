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

  it("keeps brokered MCP images as Pi image content", async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), "artemis-mcp-image-content-"),
    );
    cleanupPaths.push(workspacePath);
    const imageData = Buffer.from("image-bytes").toString("base64");
    const host = new ArtemisAgentHost(
      {
        async request() {
          return {
            approved: true,
            data: {
              content: [
                { type: "text", text: "Rendered preview" },
                { type: "image", data: imageData, mimeType: "image/png" },
              ],
              isError: false,
              metrics: {
                imageBytes: 11,
                imageCount: 1,
                omittedContentCount: 0,
                textBytes: 16,
              },
            },
          };
        },
      },
      { emit() {} },
    );
    await host.configure({
      credentials: {},
      mcpTools: [
        {
          serverId: "renderer",
          serverName: "Renderer",
          transport: "stdio",
          piName: "renderer_render",
          toolName: "render",
          description: "Render a preview",
          inputSchema: { type: "object", properties: {} },
          readOnly: true,
        },
      ],
    });
    await host.openThread({
      threadId: "mcp-image-thread",
      workspacePath,
      target: "local",
    });
    const thread = (
      host as unknown as { threads: Map<string, InspectableThread> }
    ).threads.get("mcp-image-thread");
    if (thread) {
      thread.currentTurnId = "turn-1";
      thread.currentMode = "execute";
    }
    const tool = thread?.executeTools.find(
      (candidate) => candidate.name === "renderer_render",
    );

    await expect(tool?.execute("mcp-call", {})).resolves.toMatchObject({
      content: [
        { type: "text", text: "Rendered preview" },
        { type: "image", data: imageData, mimeType: "image/png" },
      ],
    });

    host.dispose();
  });

  it("truncates oversized MCP text using a model-relative context budget", async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), "artemis-mcp-text-budget-"),
    );
    cleanupPaths.push(workspacePath);
    const oversized = `${"x".repeat(600 * 1024)}TAIL_SENTINEL`;
    const host = new ArtemisAgentHost(
      {
        async request() {
          return {
            approved: true,
            data: {
              content: [{ type: "text", text: oversized }],
              isError: false,
              metrics: {
                imageBytes: 0,
                imageCount: 0,
                omittedContentCount: 0,
                textBytes: Buffer.byteLength(oversized),
              },
            },
          };
        },
      },
      { emit() {} },
    );
    await host.configure({
      credentials: {},
      mcpTools: [
        {
          serverId: "large",
          serverName: "Large",
          transport: "stdio",
          piName: "large_read",
          toolName: "read",
          description: "Return large text",
          inputSchema: { type: "object", properties: {} },
          readOnly: true,
        },
      ],
    });
    await host.openThread({
      threadId: "mcp-large-thread",
      workspacePath,
      target: "local",
    });
    const thread = (
      host as unknown as { threads: Map<string, InspectableThread> }
    ).threads.get("mcp-large-thread");
    if (thread) {
      thread.currentTurnId = "turn-1";
      thread.currentMode = "execute";
    }
    const tool = thread?.executeTools.find(
      (candidate) => candidate.name === "large_read",
    );
    const result = (await tool?.execute("mcp-call", {})) as {
      content: Array<{ type: string; text?: string }>;
    };
    const text =
      result.content.find((item) => item.type === "text")?.text ?? "";

    expect(Buffer.byteLength(text)).toBeLessThan(oversized.length);
    expect(text).toContain("MCP output truncated by Artemis");
    expect(text).toContain("TAIL_SENTINEL");

    host.dispose();
  });
});

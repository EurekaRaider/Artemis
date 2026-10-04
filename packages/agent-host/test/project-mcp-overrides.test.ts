import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import type { McpRuntimeTool } from "@artemis/protocol";
import { projectMcpTools } from "../src/project-mcp-overrides.js";
it("applies exact and wildcard project tool restrictions without enabling unapproved servers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "artemis-mcp-project-"));
  await mkdir(join(dir, ".pi"));
  const tools: McpRuntimeTool[] = ["read", "write", "delete"].map(
    (toolName) => ({
      serverId: "files",
      serverName: "Files",
      transport: "stdio",
      piName: `mcp_${toolName}`,
      toolName,
      description: toolName,
      inputSchema: {},
      readOnly: toolName === "read",
      destructive: toolName === "delete",
    }),
  );
  try {
    await writeFile(
      join(dir, ".pi/mcp.json"),
      JSON.stringify({
        mcpServers: {
          files: {
            exposure: "hidden",
            toolExposure: { "*": "deferred", read: "direct", delete: "hidden" },
          },
          unapproved: { enabled: true },
        },
      }),
    );
    expect(
      (await projectMcpTools(dir, tools)).map((t) => [t.toolName, t.exposure]),
    ).toEqual([
      ["read", "direct"],
      ["write", "deferred"],
    ]);
    await writeFile(
      join(dir, ".pi/mcp.json"),
      JSON.stringify({ mcpServers: { files: { enabled: false } } }),
    );
    expect(await projectMcpTools(dir, tools)).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

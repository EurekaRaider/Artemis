import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  mcpToolExposure,
  mcpProjectOverridesSchema,
  type McpRuntimeTool,
} from "@artemis/protocol";
/** Project files can only restrict already enabled, host-approved servers. */
export async function projectMcpTools(
  workspace: string,
  tools: McpRuntimeTool[],
): Promise<McpRuntimeTool[]> {
  let overrides: ReturnType<typeof mcpProjectOverridesSchema.parse> = {};
  try {
    const body = JSON.parse(
      await readFile(join(workspace, ".pi", "mcp.json"), "utf8"),
    ) as { mcpServers?: unknown };
    overrides = mcpProjectOverridesSchema.parse(body.mcpServers ?? {});
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error("Invalid project .pi/mcp.json overrides.", {
        cause: error,
      });
  }
  return tools.flatMap((tool) => {
    const settings = overrides[tool.serverId] ?? overrides[tool.serverName];
    if (settings?.enabled === false || tool.exposure === "hidden") return [];
    const selected = settings
      ? (mcpToolExposure(settings, tool.toolName) ?? tool.exposure)
      : tool.exposure;
    return selected === "hidden"
      ? []
      : [{ ...tool, ...(selected ? { exposure: selected } : {}) }];
  });
}

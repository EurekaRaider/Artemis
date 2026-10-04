import type {
  McpRuntimeTool,
  McpToolUsageState,
  ToolState,
} from "@artemis/protocol";
import type { InstalledArtemisPlugin } from "../../shared/api.js";

export type ToolPlugin = Pick<
  InstalledArtemisPlugin,
  "id" | "name" | "displayName" | "mcpServerIds" | "brandColor" | "iconDataUrl"
>;

export function createToolPluginResolver(
  plugins: readonly ToolPlugin[],
  tools: readonly Pick<McpRuntimeTool, "piName" | "serverId">[],
) {
  const byServer = new Map<string, ToolPlugin | undefined>();
  for (const plugin of plugins)
    for (const serverId of plugin.mcpServerIds)
      byServer.set(serverId, byServer.has(serverId) ? undefined : plugin);
  const byName = new Map<string, string | undefined>();
  for (const tool of tools)
    byName.set(
      tool.piName,
      byName.has(tool.piName) ? undefined : tool.serverId,
    );

  return (
    tool: Pick<ToolState, "id" | "name">,
    turnId: string | undefined,
    usages: Readonly<Record<string, McpToolUsageState>>,
  ) => {
    // The persisted reducer already indexes by turn, agent and call. Do not scan
    // history or rebuild plugin indexes for every assistant text delta.
    const usage = usages[`${turnId ?? ""}\0parent\0${tool.id}`];
    const serverId = usage ? usage.serverId : byName.get(tool.name);
    return serverId ? byServer.get(serverId) : undefined;
  };
}

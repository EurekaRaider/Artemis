import { describe, expect, it } from "vitest";
import type { McpToolUsageState } from "@artemis/protocol";
import {
  createToolPluginResolver as indexPlugins,
  type ToolPlugin,
} from "../../../src/renderer/conversation/tool-plugin-source.js";

function createToolPluginResolver(
  plugins: ToolPlugin[],
  usages: McpToolUsageState[],
  tools: { piName: string; serverId: string }[],
) {
  const index = indexPlugins(plugins, tools);
  const byCall = Object.fromEntries(
    usages.map((u) => [`${u.turnId ?? ""}\0${u.agentId}\0${u.toolCallId}`, u]),
  );
  return (tool: { id: string; name: string }, turnId?: string) =>
    index(tool, turnId, byCall);
}

const plugins = [
  {
    id: "github",
    name: "github",
    displayName: "GitHub",
    mcpServerIds: ["git"],
  },
  { id: "gmail", name: "gmail", displayName: "Gmail", mcpServerIds: ["mail"] },
];
const usage = (
  serverId: string,
  turnId = "turn",
  agentId = "parent",
): McpToolUsageState => ({
  type: "mcp.tool.used",
  toolCallId: "call",
  serverId,
  serverName: serverId,
  toolName: "search",
  agentId,
  turnId,
  timestamp: "2026-09-27T00:00:00.000Z",
});

describe("tool plugin identity", () => {
  it("uses recorded source after a server disconnects, scoped to turn and agent", () => {
    const resolve = createToolPluginResolver(
      plugins,
      [usage("git"), usage("mail", "other"), usage("mail", "turn", "child")],
      [],
    );
    expect(resolve({ id: "call", name: "search" }, "turn")?.id).toBe("github");
    expect(resolve({ id: "call", name: "search" }, "other")?.id).toBe("gmail");
    expect(resolve({ id: "call", name: "search" }, "missing")).toBeUndefined();
  });

  it("falls back only to an exact registered Pi name and rejects ambiguous names", () => {
    const resolve = createToolPluginResolver(
      plugins,
      [],
      [
        { piName: "git_search", serverId: "git" },
        { piName: "collision", serverId: "git" },
        { piName: "collision", serverId: "mail" },
      ],
    );
    expect(resolve({ id: "call", name: "git_search" })?.id).toBe("github");
    expect(resolve({ id: "call", name: "github_search" })).toBeUndefined();
    expect(resolve({ id: "call", name: "collision" })).toBeUndefined();
  });

  it("does not reinterpret a recorded source as a different installed plugin", () => {
    const resolve = createToolPluginResolver(
      plugins,
      [usage("uninstalled")],
      [{ piName: "search", serverId: "git" }],
    );
    expect(resolve({ id: "call", name: "search" }, "turn")).toBeUndefined();
  });

  it("does not attribute a server owned by multiple plugins", () => {
    const resolve = createToolPluginResolver(
      [...plugins, { ...plugins[1]!, mcpServerIds: ["git"] }],
      [usage("git")],
      [],
    );
    expect(resolve({ id: "call", name: "search" }, "turn")).toBeUndefined();
  });
});

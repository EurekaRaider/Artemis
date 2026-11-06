import { type McpToolUsageState } from "@artemis/protocol";

export interface McpGroup {
  id: string;
  name: string;
  calls: number;
  tools: string[];
  agents: string[];
}

export function groupMcpUsage(
  usages: readonly McpToolUsageState[],
): McpGroup[] {
  const groups = new Map<
    string,
    { name: string; calls: number; tools: Set<string>; agents: Set<string> }
  >();
  for (const usage of usages) {
    const group = groups.get(usage.serverId) ?? {
      name: usage.serverName,
      calls: 0,
      tools: new Set<string>(),
      agents: new Set<string>(),
    };
    group.calls += 1;
    group.tools.add(usage.toolName);
    group.agents.add(usage.agentId);
    groups.set(usage.serverId, group);
  }
  return [...groups.entries()].map(([id, group]) => ({
    id,
    name: group.name,
    calls: group.calls,
    tools: [...group.tools],
    agents: [...group.agents],
  }));
}

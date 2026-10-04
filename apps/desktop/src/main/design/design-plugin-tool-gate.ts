// S0 design-plugin prototype: restricted-profile tool gating.
//
// Validation slice of proposal §7. The restricted profile must be enforced at
// TWO layers, not one:
//   1. Tool-list filtering — denied tools never appear in the model's tool
//      list for plugin-type threads.
//   2. Dispatch guard — even if a denied tool name reaches dispatch (stale
//      list, race, direct call), the guard re-checks the profile and throws
//      BEFORE any broker request or process spawn.
//
// "setActiveToolsByName alone is not an execution boundary" is the exact
// regression this module exists to demonstrate.

/**
 * Minimal S0 tool descriptor. The real agent-host tools carry schemas and
 * execute closures that are irrelevant to gating; the guard only needs the
 * stable tool name and a host-assigned category. In S1 the category is
 * recorded where each tool is defined so this mapping cannot drift.
 */
export interface ToolDescriptor {
  name: string;
  /** Host-assigned capability category used by the profile gate. */
  category: string;
}

/** Host tool categories denied for plugin-restricted threads (proposal §7). */
const DENIED_TOOL_CATEGORIES: ReadonlySet<string> = new Set([
  "bash",
  "bash-wait",
  "bash-cancel",
  "write",
  "edit",
  "read",
  "web-search",
  "local-file-read",
  "local-file-write",
  "office-document",
  "spawn-agent",
  "list-agents",
  "wait-team",
  "send-message",
  "set-agent-write-scope",
  "finish-team",
  "wait-agent",
  "get-agent-status",
  "steer-agent",
  "cancel-agent",
  "retry-agent",
  "mcp",
  "extension",
]);

export interface ToolFilterResult {
  allowed: ToolDescriptor[];
  denied: { name: string; reason: string }[];
}

/**
 * Layer 1: filter a proposed tool list down to what a plugin-restricted
 * thread may expose to the model. Unknown categories are denied by default
 * (allow-list, not deny-list).
 */
export function filterToolsForRestrictedProfile(
  tools: ToolDescriptor[],
): ToolFilterResult {
  const allowed: ToolDescriptor[] = [];
  const denied: { name: string; reason: string }[] = [];
  for (const tool of tools) {
    if (tool.category === "plugin-tool" || tool.category === "attachment") {
      allowed.push(tool);
      continue;
    }
    if (DENIED_TOOL_CATEGORIES.has(tool.category)) {
      denied.push({
        name: tool.name,
        reason: `category "${tool.category}" is denied by plugin-restricted-v1`,
      });
      continue;
    }
    denied.push({
      name: tool.name,
      reason: `category "${tool.category}" is not in the restricted allow-list`,
    });
  }
  return { allowed, denied };
}

/**
 * Layer 2: pre-dispatch guard. Consulted on EVERY dispatch of EVERY tool for
 * a plugin-restricted thread, independent of the current tool list. Throws on
 * denial so the failure is visible to the model and auditable in the turn
 * log; it never silently drops the call.
 */
export function assertToolAllowedForRestrictedProfile(
  tool: Pick<ToolDescriptor, "name" | "category">,
): void {
  if (tool.category === "plugin-tool" || tool.category === "attachment") {
    return;
  }
  if (DENIED_TOOL_CATEGORIES.has(tool.category)) {
    throw new Error(
      `Tool "${tool.name}" (category "${tool.category}") is denied for plugin-restricted threads by profile plugin-restricted-v1.`,
    );
  }
  throw new Error(
    `Tool "${tool.name}" (category "${tool.category}") is not in the restricted-profile allow-list; dispatch refused.`,
  );
}

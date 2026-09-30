// Restricted-profile tool gating for agent-host sessions (proposal §7).
//
// Layer 1: filter the proposed customTools list for a plugin-restricted
// thread so denied tools never reach the model.
// Layer 2: wrap every surviving tool's execute with a pre-dispatch guard so
// even a stale list, a race, or a direct call cannot bypass the profile.
//
// The category mapping here is the agent-host-side mirror of the desktop
// tool gate; keep both in sync. Categories follow the customTools assembly
// in runtime.ts.

import { RESTRICTED_PROFILE_ID } from "@artemis/protocol";

/** Categories denied for plugin-restricted threads, mirroring proposal §7. */
const RESTRICTED_THREAD_DENIED_CATEGORIES: ReadonlySet<string> = new Set([
  "bash",
  "bash-wait",
  "bash-cancel",
  "write",
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

/**
 * Stable tool-name → category classification for the built-in customTools.
 * Unknown names are denied by default (allow-list semantics): a restricted
 * thread may only run attachment and plugin-registered tools.
 */
export function classifyToolForRestrictedProfile(name: string): string {
  const normalized = name.toLowerCase();
  if (normalized.startsWith("attachment") || normalized.startsWith("plugin_")) {
    return "plugin-tool";
  }
  const fixed: Record<string, string> = {
    shell: "bash",
    shell_wait: "bash-wait",
    shell_cancel: "bash-cancel",
    write: "write",
    read: "read",
    web_search: "web-search",
    local_file_read: "local-file-read",
    local_file_write: "local-file-write",
    office_document: "office-document",
    spawn_agent: "spawn-agent",
    list_agents: "list-agents",
    wait_team: "wait-team",
    send_message: "send-message",
    set_agent_write_scope: "set-agent-write-scope",
    finish_team: "finish-team",
    wait_agent: "wait-agent",
    get_agent_status: "get-agent-status",
    steer_agent: "steer-agent",
    cancel_agent: "cancel-agent",
    retry_agent: "retry-agent",
    search_mcp_tools: "mcp",
    update_plan: "plan",
    get_goal: "goal",
    create_goal: "goal",
    update_goal: "goal",
    save_memory: "memory",
    load_workspace_dependencies: "workspace-deps",
    request_user_input: "user-input",
  };
  return fixed[normalized] ?? "unknown";
}

export function isToolDeniedForRestrictedThread(name: string): boolean {
  const category = classifyToolForRestrictedProfile(name);
  if (category === "plugin-tool") return false;
  return !["plan", "goal", "memory", "workspace-deps", "user-input"].includes(
    category,
  );
}

/** Guard error thrown before any broker request or process spawn. */
export class RestrictedProfileDeniedError extends Error {
  constructor(toolName: string) {
    super(
      `Tool "${toolName}" is denied for plugin-restricted threads by profile ${RESTRICTED_PROFILE_ID}.`,
    );
    this.name = "RestrictedProfileDeniedError";
  }
}

/** Assert the dispatch guard for a single tool invocation. */
export function assertToolAllowedForRestrictedThread(toolName: string): void {
  if (isToolDeniedForRestrictedThread(toolName)) {
    throw new RestrictedProfileDeniedError(toolName);
  }
}

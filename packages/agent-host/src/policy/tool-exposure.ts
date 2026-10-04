import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { RunMode } from "@artemis/protocol";
/** Control-plane tools cannot be called from a script. Business tools share the broker. */
const controls = new Set([
  "request_user_input",
  "submit_plan",
  "update_plan",
  "get_goal",
  "create_goal",
  "update_goal",
  "spawn_agent",
  "list_agents",
  "wait_team",
  "send_message",
  "set_agent_write_scope",
  "finish_team",
  "finish_subteam",
  "wait_agent",
  "get_agent_status",
  "steer_agent",
  "cancel_agent",
  "retry_agent",
]);
export function configureToolExposure<T extends { name: string }>(
  tool: T,
): T & { exposure: "model-only" | "direct" } {
  return {
    ...tool,
    exposure: controls.has(tool.name) ? "model-only" : "direct",
  };
}

/** Hiding declarations alone is insufficient: reject remembered/direct business calls too. */
export function codemodePolicyExtension(
  mode: () => RunMode | undefined,
): ExtensionFactory {
  return (pi) => {
    pi.on("tool_call", (event) => {
      if (
        mode() === "codemode" &&
        !event.parentToolCallId &&
        event.toolName !== "codemode" &&
        !controls.has(event.toolName)
      ) {
        return {
          block: true,
          reason:
            "CODEMODE_SCRIPT_REQUIRED: invoke business tools through the codemode script tool.",
        };
      }
      return undefined;
    });
  };
}

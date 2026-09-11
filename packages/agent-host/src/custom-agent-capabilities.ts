/**
 * Pure capability mappings for custom sub-agent dispatch (D#152).
 *
 * This module is intentionally dependency-free beyond @artemis/protocol so
 * the Electron main process can import it via the
 * `@artemis/agent-host/custom-agent-capabilities` subpath without pulling
 * the full runtime (and its pi-coding-agent / jiti dependency chain) into
 * the packaged main bundle.
 */
import type { CapabilityClass, CustomAgentToolRef } from "@artemis/protocol";

/** Capability classes the child-agent runtime baseline can ever allow. */
export const CUSTOM_AGENT_CHILD_BASELINE: ReadonlySet<CapabilityClass> =
  new Set(["shell", "filesystem-write", "mcp", "spawn-agent", "business-read"]);

/** Stable builtin tool ids mapped to capability classes for allowlists. */
export function resolveCustomAgentToolCapabilities(
  ref: CustomAgentToolRef,
): ReadonlySet<CapabilityClass> {
  if (ref.kind === "mcp") {
    return new Set<CapabilityClass>(["mcp", "business-read"]);
  }
  switch (ref.toolId) {
    case "shell":
    case "shell_wait":
    case "shell_cancel":
      return new Set<CapabilityClass>(["shell"]);
    case "write":
    case "office_document":
      return new Set<CapabilityClass>(["filesystem-write", "business-read"]);
    default:
      return new Set<CapabilityClass>(["business-read"]);
  }
}

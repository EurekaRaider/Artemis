import {
  isExecutionMode,
  type BrokerExecutionRequest,
  type RunMode,
} from "@artemis/protocol";

type LocalToolRequest = Extract<
  BrokerExecutionRequest,
  { kind: "mcp.call" | "extension.call" }
>;

/** Recheck both before approval and before executing a queued approval. */
export function sandboxEscalationError(
  request: LocalToolRequest,
  current: {
    mode?: RunMode | undefined;
    turnId?: string | undefined;
    archived?: boolean | undefined;
    cancelling?: boolean | undefined;
  },
): string | undefined {
  if (request.sandboxEscalation === undefined) return undefined;
  const justification = request.sandboxEscalation?.justification;
  if (
    typeof justification !== "string" ||
    !justification.trim() ||
    justification.length > 2000
  )
    return "Sandbox escalation requires a justification for this exact call (1-2000 characters).";
  if (
    !isExecutionMode(request.mode) ||
    current.mode !== request.mode ||
    current.turnId !== request.turnId ||
    current.archived ||
    current.cancelling
  )
    return "Sandbox escalation requires the current active Work or Codemode turn.";
  if (request.kind === "mcp.call" && request.transport !== "stdio")
    return "Sandbox escalation is available only for local stdio MCP servers.";
  return undefined;
}

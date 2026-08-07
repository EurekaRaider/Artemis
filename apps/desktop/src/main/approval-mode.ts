import type { ApprovalPolicy } from "@artemis/protocol";

export type ApprovalOperation =
  | { kind: "workspace.write"; modelApproved: boolean }
  | { kind: "shell.execute"; modelApproved: boolean }
  | { kind: "mcp.call"; readOnly: boolean; network: boolean }
  | {
      kind: "extension.call";
      allowNetwork: boolean;
      modelApproved: boolean;
    };

export function shouldAutoApprove(
  policy: ApprovalPolicy,
  operation: ApprovalOperation,
  fullAccessAvailable: boolean,
): boolean {
  if (operation.kind === "mcp.call") {
    return true;
  }
  if (policy === "full-access") {
    return fullAccessAvailable;
  }
  if (policy !== "agent") {
    return false;
  }
  return operation.modelApproved;
}

import type {
  ApprovalPolicy,
  ModelApprovalDecision,
  ModelRiskLevel,
  RiskLevel,
} from "@artemis/protocol";

export type ApprovalOperation =
  | {
      kind: "workspace.write";
      minimumRisk: RiskLevel;
      modelApproval: ModelApprovalDecision;
    }
  | {
      kind: "shell.execute";
      minimumRisk: RiskLevel;
      modelApproval: ModelApprovalDecision;
    }
  | {
      kind: "mcp.call";
      readOnly: boolean;
      destructive: boolean;
      network: boolean;
      fullAccess: boolean;
      modelApproval: ModelApprovalDecision;
      toolName?: string;
      googleGrant?: "gmail" | "google-workspace";
    }
  | {
      kind: "extension.call";
      allowNetwork: boolean;
      modelApproval: ModelApprovalDecision;
    };

const RISK_ORDER = {
  low: 0,
  medium: 1,
  high: 2,
} satisfies Record<ModelRiskLevel, number>;

function maximumRisk(first: RiskLevel, second: ModelRiskLevel): ModelRiskLevel {
  const normalizedFirst = first === "critical" ? "high" : first;
  return RISK_ORDER[normalizedFirst] >= RISK_ORDER[second]
    ? normalizedFirst
    : second;
}

export function effectiveApprovalRisk(
  operation: ApprovalOperation,
): ModelRiskLevel {
  const minimumRisk =
    operation.kind === "mcp.call"
      ? operation.fullAccess || operation.destructive
        ? "high"
        : operation.network
          ? "medium"
          : operation.readOnly
            ? "low"
            : "medium"
      : operation.kind === "extension.call"
        ? operation.allowNetwork
          ? "high"
          : "medium"
        : operation.minimumRisk;
  return maximumRisk(minimumRisk, operation.modelApproval.risk);
}

export function modelMayAutoApprove(operation: ApprovalOperation): boolean {
  const risk = effectiveApprovalRisk(operation);
  return risk !== "high" || operation.modelApproval.explicitUserRequest;
}

const TRUSTED_GOOGLE_TOOL_ALLOWLISTS = {
  gmail: new Set([
    "gmail_update_draft",
    "gmail_delete_draft",
    "gmail_send_draft",
    "gmail_send_message",
    "gmail_reply",
    "gmail_forward",
    "gmail_update_label",
    "gmail_delete_label",
    "gmail_trash_thread",
    "gmail_untrash_thread",
  ]),
  "google-workspace": new Set([
    "gdrive_move",
    "gdrive_trash",
    "gdrive_restore",
    "gdocs_batch_update",
    "gslides_batch_update",
    "gsheets_update",
    "gsheets_clear",
    "gcalendar_create_event",
    "gcalendar_update_event",
    "gcalendar_cancel_event",
  ]),
} satisfies Record<"gmail" | "google-workspace", Set<string>>;

export function shouldAutoApprove(
  policy: ApprovalPolicy,
  operation: ApprovalOperation,
  fullAccessAvailable: boolean,
): boolean {
  if (policy === "agent") {
    return modelMayAutoApprove(operation);
  }
  if (operation.kind === "mcp.call") {
    return (
      !operation.fullAccess &&
      (!operation.destructive ||
        (operation.googleGrant !== undefined &&
          operation.toolName !== undefined &&
          TRUSTED_GOOGLE_TOOL_ALLOWLISTS[operation.googleGrant].has(
            operation.toolName,
          )))
    );
  }
  if (policy === "full-access") {
    return fullAccessAvailable;
  }
  return false;
}

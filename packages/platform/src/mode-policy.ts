import type { RiskLevel, RunMode } from "@artemis/protocol";

export type ActionKind =
  | "read"
  | "write"
  | "delete"
  | "shell"
  | "network"
  | "credentials"
  | "git-destructive";

export interface PolicyAction {
  kind: ActionKind;
  summary: string;
  paths?: string[];
  command?: string;
  network?: string[];
}

export type PolicyDecision =
  | { outcome: "allow"; reason: string }
  | {
      outcome: "ask";
      reason: string;
      risk: RiskLevel;
      allowedScopes: Array<"once" | "session" | "project">;
    }
  | { outcome: "deny"; reason: string };

export function evaluateModePolicy(
  mode: RunMode,
  action: PolicyAction,
): PolicyDecision {
  if (mode === "plan" || mode === "review") {
    if (action.kind !== "read") {
      return {
        outcome: "deny",
        reason: `${mode} mode is read-only; ${action.kind} was rejected before execution.`,
      };
    }
    return { outcome: "allow", reason: `${mode} mode permits reads.` };
  }

  switch (action.kind) {
    case "read":
      return { outcome: "allow", reason: "Workspace reads are allowed." };
    case "write":
      return {
        outcome: "ask",
        reason:
          "The first vertical slice requires explicit approval for writes.",
        risk: "medium",
        allowedScopes: ["once", "session", "project"],
      };
    case "delete":
      return {
        outcome: "ask",
        reason: "File deletion requires an explicit one-time approval.",
        risk: "high",
        allowedScopes: ["once"],
      };
    case "shell":
      return {
        outcome: "ask",
        reason: "Shell execution requires approval.",
        risk: "medium",
        allowedScopes: ["once", "session"],
      };
    case "network":
      return {
        outcome: "ask",
        reason: "Network access is disabled by default.",
        risk: "high",
        allowedScopes: ["once", "session", "project"],
      };
    case "credentials":
      return {
        outcome: "ask",
        reason: "Credential access requires an explicit one-time approval.",
        risk: "critical",
        allowedScopes: ["once"],
      };
    case "git-destructive":
      return {
        outcome: "ask",
        reason:
          "Destructive Git operations require an explicit one-time approval.",
        risk: "critical",
        allowedScopes: ["once"],
      };
  }
}

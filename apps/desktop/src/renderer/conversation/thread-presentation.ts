import type {
  ApprovalState,
  SavedPlan,
  Thread,
  ThreadViewState,
} from "@artemis/protocol";
import type { RunPresentationStatus } from "./run-presentation.js";

export type ComposerDecision =
  | { entry: string; kind: "plan"; plan: SavedPlan }
  | {
      entry: string;
      kind: "input";
      input: ThreadViewState["userInputs"][string];
    }
  | {
      entry: string;
      kind: "approval";
      approval: ApprovalState;
      actorName: string | undefined;
    };

/** Resolve approvals, questions and completed plans in persisted order. */
export function firstPendingComposerDecision(
  state: ThreadViewState | undefined,
): ComposerDecision | undefined {
  if (!state) return undefined;
  for (const entry of state.order) {
    if (entry.startsWith("input:")) {
      const input = state.userInputs[entry.slice("input:".length)];
      if (input?.status === "pending") return { entry, kind: "input", input };
    }
    if (entry.startsWith("approval:")) {
      const approval = state.approvals[entry.slice("approval:".length)];
      if (approval?.status === "pending") {
        return {
          entry,
          kind: "approval",
          approval,
          actorName: approval.actorAgentId
            ? (state.childAgents[approval.actorAgentId]?.label ??
              approval.actorAgentId)
            : undefined,
        };
      }
    }
  }
  const plan = state.plans?.at(-1);
  if (state.status === "idle" && plan?.status === "proposed" && plan.ready) {
    return {
      entry: `plan:${plan.planId}:${plan.revision}`,
      kind: "plan",
      plan,
    };
  }
  return undefined;
}

/** One presentation mapping for the sidebar, metadata and header. */
export function threadPresentationStatus(
  thread: Thread,
  state?: ThreadViewState,
  fallback?: RunPresentationStatus,
): RunPresentationStatus | "queued" {
  const decision = firstPendingComposerDecision(state);
  if (decision)
    return decision.kind === "approval"
      ? "waiting-approval"
      : "waiting-user-input";
  const status = state?.status ?? thread.status;
  if (status === "waiting-user-input") return status;
  if (status === "waiting-approval")
    return thread.notification?.kind === "input-required"
      ? "waiting-user-input"
      : "waiting-approval";
  if (status === "running")
    return state?.activity?.phase === "queued" ? "queued" : "running";
  if (status === "failed") return "failed";
  return (
    fallback ??
    (thread.notification?.kind === "completed" ? "completed" : "idle")
  );
}

import type { AgentEvent, PlanAcceptance, ProposedPlan } from "./schema.js";

export interface SavedPlan extends ProposedPlan {
  status: "proposed" | "accepted" | "superseded";
  ready: boolean;
  executionTurnId?: string;
  executionMode?: "work" | "codemode";
}

/** Only structured host events produce an actionable plan, never message text. */
export function collectPlans(events: readonly AgentEvent[]): SavedPlan[] {
  const plans: SavedPlan[] = [];
  for (const { payload, turnId } of events) {
    if (payload.type === "plan.proposed") {
      if (
        !plans.some(
          (p) => p.planId === payload.planId && p.revision === payload.revision,
        )
      ) {
        plans.push({ ...payload, status: "proposed", ready: false });
      }
    } else if (
      payload.type === "plan.accepted" ||
      payload.type === "plan.superseded"
    ) {
      const plan = plans.find(
        (p) => p.planId === payload.planId && p.revision === payload.revision,
      );
      if (plan) {
        plan.status =
          payload.type === "plan.accepted" ? "accepted" : "superseded";
        if (payload.type === "plan.accepted") {
          plan.executionTurnId = payload.executionTurnId;
          plan.executionMode = payload.mode;
        }
      }
    } else if (
      payload.type === "turn.completed" ||
      payload.type === "turn.failed"
    ) {
      for (const plan of plans.filter((p) => p.sourceTurnId === turnId)) {
        plan.ready =
          payload.type === "turn.completed" && payload.reason === "completed";
      }
    }
  }
  return plans;
}

export function assertAcceptablePlan(
  plans: readonly SavedPlan[],
  acceptance: PlanAcceptance,
): SavedPlan {
  const latest = plans.at(-1);
  if (
    !latest ||
    latest.planId !== acceptance.planId ||
    latest.revision !== acceptance.revision ||
    latest.status !== "proposed" ||
    !latest.ready ||
    !latest.actionable
  ) {
    throw new Error(
      "PLAN_VERSION_CONFLICT: this plan is incomplete, inactive, or has been replaced.",
    );
  }
  return latest;
}

export function acceptedPlanPrompt(plan: ProposedPlan): string {
  return `Implement the following user-approved plan (revision ${plan.revision}). This is the complete accepted version. Follow existing tool authorization rules.

# ${plan.title}

${plan.markdown}`;
}

import type { AgentEvent } from "../schema.js";
import { appendOnce, type ReductionIndex } from "./timeline.js";
import { type ThreadViewState } from "./state.js";

export function applyPlansGoalsPayload(
  state: ThreadViewState,
  event: AgentEvent,
  orderedItems: Set<string>,
  index: ReductionIndex,
): void {
  const payload = event.payload;
  switch (payload.type) {
    case "plan.proposed": {
      state.plans ??= [];
      if (
        !state.plans.some(
          (p) => p.planId === payload.planId && p.revision === payload.revision,
        )
      )
        state.plans.push({ ...payload, status: "proposed", ready: false });
      appendOnce(state.order, orderedItems, `plan:${payload.planId}`);
      return;
    }
    case "plan.accepted":
    case "plan.superseded": {
      const plan = state.plans?.find(
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
      return;
    }
  }
}

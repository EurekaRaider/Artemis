import type { AgentEvent } from "../schema.js";
import { appendOnce, type ReductionIndex } from "./timeline.js";
import { type ThreadViewState } from "./state.js";

export function applyAgentsPayload(
  state: ThreadViewState,
  event: AgentEvent,
  orderedItems: Set<string>,
  index: ReductionIndex,
): void {
  const payload = event.payload;
  switch (payload.type) {
    case "child-agent.status": {
      const previous = state.childAgents[payload.agentId];
      const activity = payload.activityDelta
        ? `${previous?.activity ?? ""}${payload.activityDelta}`.slice(
            -64 * 1024,
          )
        : (payload.activity ?? previous?.activity);
      state.childAgents[payload.agentId] = {
        ...previous,
        ...payload,
        parentAgentId:
          payload.parentAgentId ?? previous?.parentAgentId ?? "parent",
        depth: payload.depth ?? previous?.depth ?? 1,
        subtreeStatus:
          payload.subtreeStatus ?? previous?.subtreeStatus ?? "leaf",
        directChildCount:
          payload.directChildCount ?? previous?.directChildCount ?? 0,
        ...(activity ? { activity } : {}),
      };
      appendOnce(state.order, orderedItems, `child:${payload.agentId}`);
      return;
    }
    case "custom-agent.route":
      // Routing audit records (D#152 PR5) persist in the durable event
      // log; they intentionally carry no UI projection so replay can never
      // double-count instances or usage.
      return;
    case "agent-team.status": {
      state.agentTeams[payload.teamId] = {
        ...state.agentTeams[payload.teamId],
        ...payload,
      };
      return;
    }
    case "agent-team.message": {
      if (!state.agentTeamMessages[payload.messageId]) {
        state.agentTeamMessageOrder.push(payload.messageId);
      }
      state.agentTeamMessages[payload.messageId] = {
        ...state.agentTeamMessages[payload.messageId],
        ...payload,
      };
      state.agentTeamMessageOrder.sort(
        (left, right) =>
          state.agentTeamMessages[left]!.sequence -
          state.agentTeamMessages[right]!.sequence,
      );
      return;
    }
  }
}

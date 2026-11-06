import type { AgentEvent } from "../schema.js";
import { type TurnViewState, type ThreadViewState } from "./state.js";
import {
  AFTER_TOOL_SEGMENT,
  clearThinkingParts,
  type ReductionIndex,
} from "./timeline.js";

export function ensureTurn(
  state: ThreadViewState,
  event: AgentEvent,
): TurnViewState | undefined {
  if (!event.turnId) return undefined;
  const existing = state.turns[event.turnId];
  if (existing) return existing;
  const turn: TurnViewState = {
    id: event.turnId,
    mode: state.mode,
    status: "running",
    order: [],
  };
  state.turns[event.turnId] = turn;
  state.turnOrder.push(event.turnId);
  return turn;
}

export function resolvedFinalPartId(
  state: ThreadViewState,
  sourcePartId: string | undefined,
): string | undefined {
  if (!sourcePartId) return undefined;
  if (state.messageParts[sourcePartId]) return sourcePartId;
  const prefix = `${sourcePartId}${AFTER_TOOL_SEGMENT}`;
  return Object.keys(state.messageParts).findLast((id) =>
    id.startsWith(prefix),
  );
}

export function resolvedTurnDuration(
  turn: TurnViewState,
  completedAt: string,
  persistedDuration: number | undefined,
): number | undefined {
  if (persistedDuration !== undefined) return persistedDuration;
  if (!turn.startedAt) return undefined;
  const duration = Date.parse(completedAt) - Date.parse(turn.startedAt);
  return Number.isFinite(duration) ? Math.max(0, duration) : undefined;
}

export function applyTurnsPayload(
  state: ThreadViewState,
  event: AgentEvent,
  orderedItems: Set<string>,
  index: ReductionIndex,
): void {
  const payload = event.payload;
  switch (payload.type) {
    case "turn.started": {
      clearThinkingParts(state, orderedItems, index);
      state.status = "running";
      state.mode = payload.mode;
      delete state.activity;
      delete state.error;
      delete state.errorCode;
      return;
    }
    case "turn.activity": {
      const { type: _type, ...activity } = payload;
      state.activity = {
        ...activity,
        ...(payload.phase === "reconnecting"
          ? { scheduledAt: event.timestamp }
          : {}),
      };
      return;
    }
    case "turn.completed": {
      for (const plan of state.plans ?? [])
        if (plan.sourceTurnId === event.turnId)
          plan.ready = payload.reason === "completed";
      clearThinkingParts(state, orderedItems, index);
      state.status = "idle";
      delete state.activity;
      return;
    }
    case "turn.failed": {
      for (const plan of state.plans ?? [])
        if (plan.sourceTurnId === event.turnId) plan.ready = false;
      clearThinkingParts(state, orderedItems, index);
      state.status = "failed";
      delete state.activity;
      state.error = payload.message;
      if (payload.code) state.errorCode = payload.code;
      else delete state.errorCode;
      return;
    }
  }
}

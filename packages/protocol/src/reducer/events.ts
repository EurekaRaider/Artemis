import type { AgentEvent, RunMode } from "../schema.js";
import { applyPlansGoalsPayload } from "./plans-goals.js";
import { applyMessagesPayload } from "./messages.js";
import {
  applyTurnsPayload,
  ensureTurn,
  resolvedTurnDuration,
  resolvedFinalPartId,
} from "./turns.js";
import { applyToolsPayload } from "./tools.js";
import { applyInteractionsPayload } from "./interactions.js";
import { applyWorkspacePayload } from "./workspace.js";
import { applyAgentsPayload } from "./agents.js";
import { applyUsagePayload } from "./usage.js";
import {
  type ThreadViewState,
  cloneThreadViewState,
  createThreadViewState,
} from "./state.js";
import {
  type ReductionIndex,
  createReductionIndex,
  indexEntry,
} from "./timeline.js";

export function applyAgentPayload(
  state: ThreadViewState,
  event: AgentEvent,
  orderedItems: Set<string>,
  index: ReductionIndex,
): void {
  const payload = event.payload;
  switch (payload.type) {
    case "plan.proposed":
    case "plan.accepted":
    case "plan.superseded":
      return applyPlansGoalsPayload(state, event, orderedItems, index);
    case "user.message":
    case "message.superseded":
    case "message.part.delta":
      return applyMessagesPayload(state, event, orderedItems, index);
    case "turn.started":
    case "turn.activity":
    case "turn.completed":
    case "turn.failed":
      return applyTurnsPayload(state, event, orderedItems, index);
    case "tool.started":
    case "tool.updated":
    case "tool.completed":
      return applyToolsPayload(state, event, orderedItems, index);
    case "approval.requested":
    case "approval.resolved":
    case "user-input.requested":
    case "user-input.resolved":
      return applyInteractionsPayload(state, event, orderedItems, index);
    case "artifact.event":
    case "file.changed":
    case "mcp.tool.used":
    case "task.source.added":
    case "queue.updated":
    case "queue.recovered":
    case "terminal.output":
    case "thread.notification.updated":
    case "turn.change-set.updated":
      return applyWorkspacePayload(state, event, orderedItems, index);
    case "child-agent.status":
    case "custom-agent.route":
    case "agent-team.status":
    case "agent-team.message":
      return applyAgentsPayload(state, event, orderedItems, index);
    case "context.usage":
    case "assistant.usage":
      return applyUsagePayload(state, event, orderedItems, index);
  }
}

export function applyAgentEvent(
  state: ThreadViewState,
  event: AgentEvent,
  orderedItems: Set<string>,
  index: ReductionIndex,
): void {
  state.seenEventIds[event.eventId] = true;
  state.lastSeq = Math.max(state.lastSeq, event.seq);
  if (event.turnId && !index.writableTurns.has(event.turnId)) {
    const existing = state.turns[event.turnId];
    if (existing)
      state.turns[event.turnId] = { ...existing, order: [...existing.order] };
    index.writableTurns.add(event.turnId);
  }
  const turn = ensureTurn(state, event);
  const previousOrder = state.order;
  const previousLength = previousOrder.length;

  applyAgentPayload(state, event, orderedItems, index);

  if (state.order !== previousOrder) {
    // Superseded/legacy thinking entries are rare removals, not the streaming path.
    const rebuilt = createReductionIndex(state);
    index.parts = rebuilt.parts;
    index.lastTool = rebuilt.lastTool;
    index.thinkingEntries = rebuilt.thinkingEntries;
    if (turn)
      turn.order = state.order.filter(
        (entry) => state.entryTurnIds[entry] === turn.id,
      );
  }
  const added =
    state.order === previousOrder
      ? state.order.slice(previousLength)
      : state.order.filter((entry) => !previousOrder.includes(entry));
  for (const [offset, entry] of added.entries()) {
    indexEntry(index, entry, state.order.length - added.length + offset);
    if (turn && !state.entryTurnIds[entry]) {
      state.entryTurnIds[entry] = turn.id;
      turn.order.push(entry);
    }
  }
  if (!turn) return;

  const payload = event.payload;
  if (payload.type === "turn.started") {
    turn.mode = payload.mode;
    turn.status = "running";
    turn.startedAt = event.timestamp;
    delete turn.completedAt;
    delete turn.durationMs;
    delete turn.finalPartId;
  } else if (payload.type === "turn.completed") {
    turn.status = payload.reason === "cancelled" ? "cancelled" : "completed";
    turn.completedAt = event.timestamp;
    const durationMs = resolvedTurnDuration(
      turn,
      event.timestamp,
      payload.durationMs,
    );
    if (durationMs === undefined) delete turn.durationMs;
    else turn.durationMs = durationMs;
    const finalPartId = resolvedFinalPartId(state, payload.finalPartId);
    if (finalPartId === undefined) delete turn.finalPartId;
    else turn.finalPartId = finalPartId;
  } else if (payload.type === "turn.failed") {
    turn.status = "failed";
    turn.completedAt = event.timestamp;
    const durationMs = resolvedTurnDuration(
      turn,
      event.timestamp,
      payload.durationMs,
    );
    if (durationMs === undefined) delete turn.durationMs;
    else turn.durationMs = durationMs;
  } else if (payload.type === "turn.change-set.updated") {
    const { type: _type, ...changeSet } = payload;
    turn.changeSet = changeSet;
  }
}

export function reduceAgentEvent(
  state: ThreadViewState,
  event: AgentEvent,
): ThreadViewState {
  if (event.threadId !== state.threadId || state.seenEventIds[event.eventId]) {
    return state;
  }

  const next = cloneThreadViewState(state);
  applyAgentEvent(next, event, new Set(next.order), createReductionIndex(next));
  return next;
}

export function reduceAgentEventBatch(
  state: ThreadViewState,
  events: AgentEvent[],
): ThreadViewState {
  let next: ThreadViewState | undefined;
  let orderedItems: Set<string> | undefined;
  let index: ReductionIndex | undefined;
  for (const event of events) {
    const current = next ?? state;
    if (
      event.threadId !== current.threadId ||
      current.seenEventIds[event.eventId]
    ) {
      continue;
    }
    if (!next) {
      next = cloneThreadViewState(state);
      orderedItems = new Set(next.order);
      index = createReductionIndex(next);
    }
    applyAgentEvent(next, event, orderedItems!, index!);
  }
  return next ?? state;
}

export function reduceAgentEvents(
  threadId: string,
  events: AgentEvent[],
  mode: RunMode = "work",
): ThreadViewState {
  const state = createThreadViewState(threadId, mode);
  const orderedItems = new Set<string>();
  const index = createReductionIndex(state);
  for (const event of events) {
    if (event.threadId !== threadId || state.seenEventIds[event.eventId]) {
      continue;
    }
    applyAgentEvent(state, event, orderedItems, index);
  }
  return state;
}

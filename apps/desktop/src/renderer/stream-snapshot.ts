import type { AgentEvent, Thread } from "@artemis/protocol";
import type { DesktopSnapshot } from "../shared/api.js";
function updateThreadStatus(
  thread: Thread,
  event: AgentEvent,
): Thread["status"] {
  switch (event.payload.type) {
    case "turn.started":
      return "running";
    case "approval.requested":
    case "user-input.requested":
      return "waiting-approval";
    case "turn.completed":
      return "idle";
    case "turn.failed":
      return "failed";
    default:
      return thread.status;
  }
}

export function mergeThreadEvents(
  history: AgentEvent[],
  liveEvents: AgentEvent[],
): AgentEvent[] {
  if (history.length === 0) return liveEvents;
  if (liveEvents.length === 0) return history;
  const byId = new Map<string, AgentEvent>();
  for (const event of history) byId.set(event.eventId, event);
  for (const event of liveEvents) byId.set(event.eventId, event);
  return [...byId.values()].sort((left, right) => left.seq - right.seq);
}

function eventChangesThread(event: AgentEvent): boolean {
  return [
    "thread.notification.updated",
    "user-input.requested",
    "turn.started",
    "approval.requested",
    "turn.completed",
    "turn.failed",
    "thread.goal.updated",
    "thread.goal.cleared",
  ].includes(event.payload.type);
}

function updateThreadFromEvent(thread: Thread, event: AgentEvent): Thread {
  if (event.payload.type === "thread.notification.updated") {
    if ((thread.notification?.revision ?? -1) >= event.payload.state.revision)
      return thread;
    return {
      ...thread,
      notification: event.payload.state,
      status: event.payload.threadStatus ?? thread.status,
    };
  }
  if (event.payload.type === "thread.goal.updated") {
    if (
      thread.goal?.goalId === event.payload.goal.goalId &&
      event.payload.goal.revision < thread.goal.revision
    ) {
      return thread;
    }
    return { ...thread, goal: event.payload.goal };
  }
  if (event.payload.type === "thread.goal.cleared") {
    if (
      !thread.goal ||
      thread.goal.goalId !== event.payload.goalId ||
      event.payload.revision <= thread.goal.revision
    ) {
      return thread;
    }
    const { goal: _goal, ...withoutGoal } = thread;
    return withoutGoal;
  }
  return {
    ...thread,
    status: updateThreadStatus(thread, event),
    mode:
      event.payload.type === "turn.started" ? event.payload.mode : thread.mode,
  };
}

export function preserveLoadedEvents(
  refreshed: DesktopSnapshot,
  current: DesktopSnapshot | undefined,
): DesktopSnapshot {
  const visibleThreads = new Set(refreshed.threads.map((thread) => thread.id));
  return {
    ...refreshed,
    events: Object.fromEntries(
      [
        ...new Set([
          ...Object.keys(current?.events ?? {}),
          ...Object.keys(refreshed.events),
        ]),
      ]
        .filter((threadId) => visibleThreads.has(threadId))
        .map((threadId) => [
          threadId,
          mergeThreadEvents(
            current?.events[threadId] ?? [],
            refreshed.events[threadId] ?? [],
          ),
        ]),
    ),
  };
}

export function appendLiveEvents(
  existing: AgentEvent[],
  incoming: AgentEvent[],
): AgentEvent[] {
  let appended: AgentEvent[] | undefined;
  let ids: Set<string> | undefined;
  let lastSeq = existing.at(-1)?.seq ?? -1;
  for (const event of incoming) {
    if (event.seq <= lastSeq) {
      ids ??= new Set((appended ?? existing).map((item) => item.eventId));
      if (ids.has(event.eventId)) continue;
    }
    appended ??= [...existing];
    appended.push(event);
    ids?.add(event.eventId);
    lastSeq = Math.max(lastSeq, event.seq);
  }
  return appended ?? existing;
}
export function applyStreamBatch(
  current: DesktopSnapshot,
  batch: AgentEvent[],
): DesktopSnapshot {
  const grouped = new Map<string, AgentEvent[]>();
  for (const event of batch) {
    const events = grouped.get(event.threadId) ?? [];
    events.push(event);
    grouped.set(event.threadId, events);
  }
  let events = current.events;
  const updates = new Map<string, AgentEvent[]>();
  for (const [threadId, incoming] of grouped) {
    const existing = current.events[threadId] ?? [];
    const appended = appendLiveEvents(existing, incoming);
    if (appended === existing) continue;
    if (events === current.events) events = { ...current.events };
    events[threadId] = appended;
    const changes = appended.slice(existing.length).filter(eventChangesThread);
    if (changes.length) updates.set(threadId, changes);
  }
  if (events === current.events) return current;
  return {
    ...current,
    events,
    threads: updates.size
      ? current.threads.map((thread) => {
          const changes = updates.get(thread.id);
          return changes
            ? changes.reduce(updateThreadFromEvent, thread)
            : thread;
        })
      : current.threads,
  };
}

import type { AgentEvent, Thread } from "@artemis/protocol";

type EventsByThread = Readonly<
  Record<string, readonly AgentEvent[] | undefined>
>;

const WORKSPACE_DRAFT_TITLES = new Set([
  "New task",
  "Waiting for task",
  "新任务",
  "等待任务内容",
]);

export function isWorkspaceDraftThread(thread: Thread): boolean {
  return (
    thread.status === "idle" &&
    thread.target === "local" &&
    !thread.archived &&
    !thread.pinned &&
    !thread.goal &&
    !thread.sessionFile &&
    WORKSPACE_DRAFT_TITLES.has(thread.title.trim())
  );
}

function isActiveThread(thread: Thread): boolean {
  return thread.status === "running" || thread.status === "waiting-approval";
}

function latestPromptTimestamp(
  events: readonly AgentEvent[],
): number | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.payload.type !== "user.message") continue;
    const timestamp = Date.parse(event.timestamp);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return undefined;
}

function promptTimestamp(
  thread: Thread,
  eventsByThread: EventsByThread,
  submittedAtByThread: Readonly<Record<string, number | undefined>>,
): number {
  const eventTimestamp = latestPromptTimestamp(eventsByThread[thread.id] ?? []);
  const submittedAt = submittedAtByThread[thread.id];
  if (eventTimestamp !== undefined || submittedAt !== undefined) {
    return Math.max(eventTimestamp ?? 0, submittedAt ?? 0);
  }
  const fallback = Date.parse(thread.updatedAt);
  return Number.isFinite(fallback) ? fallback : 0;
}

export function sortProjectThreads(
  threads: readonly Thread[],
  eventsByThread: EventsByThread,
  submittedAtByThread: Readonly<Record<string, number | undefined>> = {},
): Thread[] {
  return threads
    .map((thread, index) => ({ thread, index }))
    .sort((left, right) => {
      const leftActive = isActiveThread(left.thread);
      const rightActive = isActiveThread(right.thread);
      if (leftActive !== rightActive) return leftActive ? -1 : 1;
      if (leftActive) {
        const timestampDifference =
          promptTimestamp(right.thread, eventsByThread, submittedAtByThread) -
          promptTimestamp(left.thread, eventsByThread, submittedAtByThread);
        if (timestampDifference !== 0) return timestampDifference;
      }
      return left.index - right.index;
    })
    .map(({ thread }) => thread);
}

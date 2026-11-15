import { reduceAgentEvents, type AgentEvent } from "@artemis/protocol";

/** Resolve the UI boundary before creating a session or copying any artifacts. */
export function historicalForkBoundary(
  threadId: string,
  events: AgentEvent[],
  target: { turnId?: string | undefined; entryId?: string | undefined },
) {
  const completion = events.findLast(
    (event) =>
      event.threadId === threadId &&
      (target.turnId
        ? event.turnId === target.turnId
        : event.payload.type === "turn.completed" &&
          event.payload.sessionEntryId === target.entryId) &&
      event.payload.type === "turn.completed",
  );
  if (
    !completion ||
    completion.payload.type !== "turn.completed" ||
    completion.payload.reason !== "completed" ||
    !completion.payload.finalPartId
  )
    throw new Error("Choose a completed reply to fork its history.");
  if (target.entryId && target.entryId !== completion.payload.sessionEntryId)
    throw new Error("The selected reply does not match the session entry.");
  const history = events.filter(
    (event) => event.threadId === threadId && event.seq <= completion.seq,
  );
  const state = reduceAgentEvents(threadId, history);
  const text = state.messageParts[completion.payload.finalPartId]?.text;
  if (!text?.trim()) throw new Error("The selected reply has no saved text.");
  return {
    throughSeq: completion.seq,
    entryId: completion.payload.sessionEntryId,
    assistantText: text,
    sourceIds: Object.keys(state.taskSources),
    attachmentIds: Object.values(state.taskSources).flatMap((source) =>
      "attachment" in source && source.attachment ? [source.attachment.id] : [],
    ),
  };
}

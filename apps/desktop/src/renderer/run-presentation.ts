import {
  reduceAgentEvents,
  type AgentEvent,
  type ThreadViewState,
} from "@artemis/protocol";

export type RunPresentationStatus =
  | "idle"
  | "running"
  | "waiting-approval"
  | "waiting-user-input"
  | "completed"
  | "failed";

export interface RunPresentation {
  status: RunPresentationStatus;
  elapsedMs: number;
}

export function deriveRunPresentation(
  events: readonly AgentEvent[],
  nowMs: number,
  reducedStatus?: ThreadViewState["status"],
): RunPresentation {
  const startIndex = events.findLastIndex(
    (event) => event.payload.type === "turn.started",
  );
  const started = events[startIndex];
  if (!started) {
    return { status: "idle", elapsedMs: 0 };
  }

  const startedAt = Date.parse(started.timestamp);
  let terminalStatus: "completed" | "failed" | undefined;
  let endedAt: number | undefined;

  for (let index = startIndex + 1; index < events.length; index += 1) {
    const event = events[index]!;
    if (event.turnId !== started.turnId) continue;

    switch (event.payload.type) {
      case "turn.completed":
        terminalStatus = "completed";
        endedAt = Date.parse(event.timestamp);
        break;
      case "turn.failed":
        terminalStatus = "failed";
        endedAt = Date.parse(event.timestamp);
        break;
    }
  }

  // The protocol reducer is the single source of truth for pending
  // interactions. In particular, it binds nonces, validates resolution
  // sources, applies per-question deadlines, and fails closed on malformed or
  // stale resolutions. App passes its cached reduced status; isolated callers
  // (including tests) reduce the current turn here instead of duplicating that
  // state machine in the renderer.
  const currentTurnStatus =
    reducedStatus ??
    reduceAgentEvents(
      started.threadId,
      events
        .slice(startIndex)
        .filter((event) => event.turnId === started.turnId),
    ).status;
  const status: RunPresentationStatus =
    terminalStatus ??
    (currentTurnStatus === "idle" ? "running" : currentTurnStatus);

  return {
    status,
    elapsedMs: Math.max(0, (endedAt ?? nowMs) - startedAt),
  };
}

export function formatRunDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);

  if (totalMinutes < 60) {
    return `${totalMinutes}:${seconds.toString().padStart(2, "0")}`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

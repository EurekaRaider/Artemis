import type { AgentEvent } from "@artemis/protocol";

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
): RunPresentation {
  const startIndex = events.findLastIndex(
    (event) => event.payload.type === "turn.started",
  );
  const started = events[startIndex];
  if (!started) {
    return { status: "idle", elapsedMs: 0 };
  }

  const startedAt = Date.parse(started.timestamp);
  let status: RunPresentationStatus = "running";
  let endedAt: number | undefined;
  const pendingApprovals = new Set<string>();
  const pendingUserInputs = new Set<string>();

  const waitingStatus = (): RunPresentationStatus =>
    pendingUserInputs.size > 0
      ? "waiting-user-input"
      : pendingApprovals.size > 0
        ? "waiting-approval"
        : "running";

  for (let index = startIndex + 1; index < events.length; index += 1) {
    const event = events[index]!;
    if (event.turnId !== started.turnId) continue;

    switch (event.payload.type) {
      case "approval.requested":
        pendingApprovals.add(event.payload.approvalId);
        status = waitingStatus();
        break;
      case "approval.resolved":
        pendingApprovals.delete(event.payload.approvalId);
        status = waitingStatus();
        break;
      case "user-input.requested":
        pendingUserInputs.add(event.payload.requestId);
        status = waitingStatus();
        break;
      case "user-input.resolved":
        pendingUserInputs.delete(event.payload.requestId);
        status = waitingStatus();
        break;
      case "turn.completed":
        status = "completed";
        endedAt = Date.parse(event.timestamp);
        break;
      case "turn.failed":
        status = "failed";
        endedAt = Date.parse(event.timestamp);
        break;
    }
  }

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

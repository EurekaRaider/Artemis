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

type UserInputRequestedEventPayload = Extract<
  AgentEvent["payload"],
  { type: "user-input.requested" }
>;

// Question IDs of a multi-question request, or undefined for a
// single-question request. Kind-less requests carrying a questions array are
// duck-typed like the reducer's isMultiQuestionInput so legacy multi cards
// aggregate per question as well.
function multiQuestionRequestedIds(
  payload: UserInputRequestedEventPayload,
): string[] | undefined {
  if (payload.kind === "multi-question") {
    return payload.questions.map((question) => question.questionId);
  }
  if (Array.isArray(payload.questions)) {
    return payload.questions
      .map((question) => question?.questionId)
      .filter(
        (questionId): questionId is string => typeof questionId === "string",
      );
  }
  return undefined;
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
  // Multi-question cards aggregate per question (D#76 PR10C obligation 2):
  // the card keeps the turn on waiting-user-input until every question has
  // its own resolution, mirroring the reducer's pendingInteractionStatus.
  const pendingQuestionsByRequest = new Map<string, Set<string>>();

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
      case "user-input.requested": {
        const questionIds = multiQuestionRequestedIds(event.payload);
        if (questionIds) {
          pendingQuestionsByRequest.set(
            event.payload.requestId,
            new Set(questionIds),
          );
        }
        pendingUserInputs.add(event.payload.requestId);
        status = waitingStatus();
        break;
      }
      case "user-input.resolved": {
        const pendingQuestions = pendingQuestionsByRequest.get(
          event.payload.requestId,
        );
        if (pendingQuestions) {
          if (event.payload.kind === "multi-question") {
            // A per-question resolution settles only the named question;
            // unanswered siblings keep the card (and the waiting status).
            pendingQuestions.delete(event.payload.questionId);
            if (pendingQuestions.size === 0) {
              pendingQuestionsByRequest.delete(event.payload.requestId);
              pendingUserInputs.delete(event.payload.requestId);
            }
          } else {
            // A kind-less resolution (crash restore, turn cancellation, host
            // exit) closes the whole card, mirroring the reducer's
            // applyLegacyMultiQuestionClose translation.
            pendingQuestionsByRequest.delete(event.payload.requestId);
            pendingUserInputs.delete(event.payload.requestId);
          }
        } else {
          pendingUserInputs.delete(event.payload.requestId);
        }
        status = waitingStatus();
        break;
      }
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

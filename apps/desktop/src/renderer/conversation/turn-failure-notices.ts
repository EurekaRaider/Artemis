import type { ThreadViewState } from "@artemis/protocol";

export type TurnFailureNotices = Record<string, string>;

/** Only offer the user's prompt from the failed turn, never an older task. */
export function latestFailedTurnPrompt(
  state: ThreadViewState | undefined,
): string | undefined {
  const turnId = state?.turnOrder.at(-1);
  const turn = turnId ? state?.turns[turnId] : undefined;
  if (!state || turn?.status !== "failed") return undefined;
  const entry = turn.order.findLast((key) => key.startsWith("user:"));
  return entry ? state.userMessages[entry.slice(5)]?.text : undefined;
}

export type TurnFailureNoticeAction =
  | { type: "failed"; threadId: string; message: string }
  | { type: "started" | "dismiss"; threadId: string };

export function reduceTurnFailureNotices(
  notices: TurnFailureNotices,
  action: TurnFailureNoticeAction,
): TurnFailureNotices {
  if (action.type === "failed") {
    return { ...notices, [action.threadId]: action.message };
  }
  if (!(action.threadId in notices)) return notices;
  const next = { ...notices };
  delete next[action.threadId];
  return next;
}

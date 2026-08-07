export type TurnFailureNotices = Record<string, string>;

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

export const GOAL_CONTINUATION_RETRY_DELAY_MILLISECONDS = 5_000;

interface GoalFailure {
  message: string;
  code?: string | undefined;
}

const TRANSIENT_GOAL_FAILURE_CODES = new Set([
  "AGENT_HOST_INTERRUPTED",
  "MODEL_STREAM_STALLED",
  "STREAM_INTERRUPTED",
]);

const TRANSIENT_GOAL_FAILURE =
  /\b(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH)\b|agent host (?:exited|is not ready|is restarting|is shutting down)|connection (?:closed|lost|reset|refused)|gateway timeout|model stream stalled|network error|service unavailable|socket hang up|temporar(?:ily|y) unavailable|timed? out/iu;

export function goalFailureDisposition(
  failure: GoalFailure,
): "usage-limited" | "retry" | "blocker" {
  if (
    failure.code === "RATE_LIMITED" ||
    /(?:usage|rate|token)\s+limit|quota|\b429\b/iu.test(failure.message)
  ) {
    return "usage-limited";
  }
  return (failure.code
    ? TRANSIENT_GOAL_FAILURE_CODES.has(failure.code)
    : false) || TRANSIENT_GOAL_FAILURE.test(failure.message)
    ? "retry"
    : "blocker";
}

export function goalFailureBlocker(failure: GoalFailure): string {
  const message = failure.message.trim().replace(/\s+/gu, " ").toLowerCase();
  return `${failure.code?.toLowerCase() ?? "permanent failure"}: ${message}`.slice(
    0,
    2_000,
  );
}

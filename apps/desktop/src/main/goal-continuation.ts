import type { AgentPayload } from "@artemis/protocol";

export const GOAL_CONTINUATION_RETRY_DELAY_MILLISECONDS = 5_000;

export function goalFailureDisposition(
  payload: Extract<AgentPayload, { type: "turn.failed" }>,
): "usage-limited" | "retry" {
  return payload.code === "RATE_LIMITED" ||
    /(?:usage|rate|token)\s+limit|quota|\b429\b/iu.test(payload.message)
    ? "usage-limited"
    : "retry";
}

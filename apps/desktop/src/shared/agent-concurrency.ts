import {
  AGENT_CONCURRENCY_MAXIMUM,
  AGENT_CONCURRENCY_MINIMUM,
} from "@artemis/protocol";

export { AGENT_CONCURRENCY_MAXIMUM, AGENT_CONCURRENCY_MINIMUM };

export type AgentConcurrencyPreference =
  { mode: "auto" } | { mode: "manual"; limit: number };

export type AgentConcurrencyPressureReason = "cpu" | "event-loop" | "memory";

export interface AgentConcurrencyStatus {
  preference: AgentConcurrencyPreference;
  startupLimit: number;
  effectiveLimit: number;
  active: number;
  queued: number;
  hardLimit: number;
  throttled: boolean;
  pressureReasons: AgentConcurrencyPressureReason[];
  parallelism: number;
  totalMemoryGiB: number;
  appWorkingSetMiB?: number;
}

export function parseAgentConcurrencyPreference(
  value: unknown,
): AgentConcurrencyPreference {
  if (!value || typeof value !== "object") {
    throw new Error("Agent concurrency preference is invalid");
  }
  const input = value as Record<string, unknown>;
  if (input.mode === "auto") return { mode: "auto" };
  if (
    input.mode === "manual" &&
    Number.isInteger(input.limit) &&
    Number(input.limit) >= AGENT_CONCURRENCY_MINIMUM &&
    Number(input.limit) <= AGENT_CONCURRENCY_MAXIMUM
  ) {
    return { mode: "manual", limit: Number(input.limit) };
  }
  throw new Error(
    `Agent concurrency limit must be an integer from ${AGENT_CONCURRENCY_MINIMUM} to ${AGENT_CONCURRENCY_MAXIMUM}`,
  );
}

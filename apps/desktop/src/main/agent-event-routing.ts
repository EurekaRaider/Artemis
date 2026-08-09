import type { AgentHostEvent } from "@artemis/protocol";

export function partitionAgentHostEvents(events: readonly AgentHostEvent[]): {
  durable: AgentHostEvent[];
  liveActivities: AgentHostEvent[];
} {
  const durable: AgentHostEvent[] = [];
  const liveActivities: AgentHostEvent[] = [];
  for (const event of events) {
    if (
      event.payload.type === "child-agent.status" &&
      event.payload.activityDelta
    ) {
      liveActivities.push(event);
    } else {
      durable.push(event);
    }
  }
  return { durable, liveActivities };
}

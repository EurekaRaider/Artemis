import { describe, expect, it } from "vitest";
import type { AgentHostEvent } from "@artemis/protocol";

import { partitionAgentHostEvents } from "../src/main/agent-event-routing.js";

describe("agent event routing", () => {
  it("keeps live child activity out of durable SQLite batches", () => {
    const events: AgentHostEvent[] = [
      {
        threadId: "thread-1",
        turnId: "turn-1",
        payload: {
          type: "child-agent.status",
          agentId: "child-1",
          label: "Inspect runtime",
          status: "running",
          activityDelta: "Reading runtime.ts",
        },
      },
      {
        threadId: "thread-1",
        turnId: "turn-1",
        payload: {
          type: "child-agent.status",
          agentId: "child-1",
          label: "Inspect runtime",
          status: "completed",
          output: "Inspection complete.",
        },
      },
    ];

    const routed = partitionAgentHostEvents(events);
    expect(routed.liveActivities).toEqual([events[0]]);
    expect(routed.durable).toEqual([events[1]]);
  });
});

import {
  reduceAgentEvents,
  type AgentEvent,
  type AgentHostCommand,
} from "@artemis/protocol";

export type TurnCheckpoint = Omit<
  Extract<AgentHostCommand, { type: "turn.prompt" }>,
  "type" | "requestId"
> & {
  source?: "user" | "goal-continuation";
  remote?: boolean;
  goalCreationAuthorized?: boolean;
};

export function turnRecoveryContext(
  events: readonly AgentEvent[],
  turnId: string,
) {
  const current = events.filter((event) => event.turnId === turnId);
  const evidence = current.flatMap(({ payload }) => {
    switch (payload.type) {
      case "tool.started":
      case "tool.completed":
      case "approval.requested":
      case "approval.resolved":
      case "user-input.requested":
      case "user-input.resolved":
      case "user.message":
        return [payload];
      default:
        return [];
    }
  });
  const queue = current.findLast(
    (event) => event.payload.type === "queue.updated",
  )?.payload;
  const state = current.length
    ? reduceAgentEvents(current[0]!.threadId, current)
    : undefined;
  return {
    evidence: JSON.stringify({
      events: evidence,
      partialOutput: state
        ? Object.values(state.messageParts)
            .map((part) => part.text)
            .join("\n")
        : "",
      childAgents: state?.childAgents,
      agentTeams: state?.agentTeams,
      agentTeamMessages: state?.agentTeamMessages,
      ...(queue?.type === "queue.updated" ? { queue } : {}),
    }),
    toolResults: current.flatMap(({ payload }) =>
      payload.type === "tool.completed"
        ? [
            {
              toolCallId: payload.toolCallId,
              output: payload.output ?? "",
              isError: payload.isError,
            },
          ]
        : [],
    ),
  };
}

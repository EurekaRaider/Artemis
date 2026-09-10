type TurnFailureCopy = {
  hostRestart: string;
  modelStreamStalled: string;
  streamInterrupted: string;
  agentHostInterrupted: string;
};

export function localizedTurnFailure(
  copy: TurnFailureCopy,
  message: string,
  code?: string,
): string {
  if (code === "HOST_RESTART") return copy.hostRestart;
  if (code === "MODEL_STREAM_STALLED") return copy.modelStreamStalled;
  if (code === "STREAM_INTERRUPTED") return copy.streamInterrupted;
  if (code === "AGENT_HOST_INTERRUPTED") return copy.agentHostInterrupted;
  return message;
}

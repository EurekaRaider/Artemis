const LEGACY_AGENT_TEAM_MESSAGE =
  /^\[agent-team (?:finding|request|blocker|handoff)\] [^:\r\n]+: /u;
const LEGACY_AGENT_NUDGE_MESSAGE =
  /^The user nudged sub-agent .+ \(.+\)\. Check its status and adjust the approach if needed\.$/u;
const LEGACY_AGENT_STOP_MESSAGE =
  /^Sub-agent .+ \(.+\) was stopped by the user\. Do not keep waiting for it; continue with another approach\.$/u;
const LEGACY_AGENT_RETRY_MESSAGE =
  /^The user retried sub-agent .+ as .+\. Monitor the new attempt instead of the old one\.$/u;
const LEGACY_AGENT_TEAM_STOP_MESSAGE =
  "The user stopped the agent team. Continue the current task without waiting for its members.";

export function isLegacyInternalAgentMessage(text: string): boolean {
  const value = text.trim();
  return (
    LEGACY_AGENT_TEAM_MESSAGE.test(value) ||
    LEGACY_AGENT_NUDGE_MESSAGE.test(value) ||
    LEGACY_AGENT_STOP_MESSAGE.test(value) ||
    LEGACY_AGENT_RETRY_MESSAGE.test(value) ||
    value === LEGACY_AGENT_TEAM_STOP_MESSAGE
  );
}

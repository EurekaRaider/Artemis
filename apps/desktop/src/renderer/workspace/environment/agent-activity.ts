import { useEffect, useMemo, useState } from "react";
import { type AgentTeamState, type ChildAgentState } from "@artemis/protocol";

export interface AgentEnvironmentCounts {
  total: number;
  active: number;
  queued: number;
  blocked: number;
  completed: number;
}

export function environmentAgentCounts(
  agents: readonly ChildAgentState[],
): AgentEnvironmentCounts {
  return agents.reduce<AgentEnvironmentCounts>(
    (counts, agent) => {
      counts.total += 1;
      if (agent.status === "running" || agent.status === "cancelling") {
        counts.active += 1;
      } else if (agent.status === "queued") {
        counts.queued += 1;
      } else if (agent.status === "blocked") {
        counts.blocked += 1;
      } else if (agent.status === "completed") {
        counts.completed += 1;
      }
      return counts;
    },
    { total: 0, active: 0, queued: 0, blocked: 0, completed: 0 },
  );
}

export function environmentDisplayAgents(
  agents: readonly ChildAgentState[],
  teams: readonly AgentTeamState[],
): ChildAgentState[] {
  const teamById = new Map(teams.map((team) => [team.teamId, team] as const));
  return agents.map((agent) => {
    if (
      !agent.teamId ||
      agent.status === "completed" ||
      agent.status === "failed" ||
      agent.status === "cancelled"
    ) {
      return agent;
    }
    const team = teamById.get(agent.teamId);
    const teamStatus = team?.status;
    const status =
      teamStatus === "completed"
        ? "completed"
        : teamStatus === "aborted"
          ? "cancelled"
          : undefined;
    if (!status) return agent;
    const displayAgent: ChildAgentState = {
      ...agent,
      status,
      ...(team ? { lastActivityAt: team.updatedAt } : {}),
    };
    delete displayAgent.currentTool;
    delete displayAgent.currentToolStartedAt;
    return displayAgent;
  });
}

export function environmentTopLevelAgents(
  agents: readonly ChildAgentState[],
): ChildAgentState[] {
  return agents.filter(
    (agent) =>
      agent.agentId !== "parent" &&
      (!agent.parentAgentId || agent.parentAgentId === "parent") &&
      (agent.depth === undefined || agent.depth === 1),
  );
}

export function useEnvironmentActivityAgents(
  agents: readonly ChildAgentState[],
  teams: readonly AgentTeamState[],
): ChildAgentState[] {
  const [, refresh] = useState(0);
  const displayAgents = useMemo(
    () => environmentTopLevelAgents(environmentDisplayAgents(agents, teams)),
    [agents, teams],
  );
  const now = Date.now();
  let nextExpiry = Infinity;
  const visibleAgents = displayAgents.filter((agent) => {
    if (
      agent.status !== "completed" &&
      agent.status !== "failed" &&
      agent.status !== "cancelled"
    )
      return true;
    // Status queries update updatedAt; lastActivityAt preserves the finish time.
    // Old records without a usable timestamp belong only in the detail view.
    const finishedAt = Date.parse(
      agent.lastActivityAt ?? agent.updatedAt ?? "",
    );
    const expiresAt = finishedAt + 5_000;
    if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;
    nextExpiry = Math.min(nextExpiry, expiresAt);
    return true;
  });
  useEffect(() => {
    if (!Number.isFinite(nextExpiry)) return;
    const timer = window.setTimeout(
      () => refresh((value) => value + 1),
      Math.max(0, nextExpiry - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [nextExpiry]);
  return visibleAgents;
}

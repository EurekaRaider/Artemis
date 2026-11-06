import { ROOT_AGENT_ID, isTerminalChildStatus } from "./agent-team-policy.js";

import type {
  ChildAgentExecution,
  AgentTeamSnapshot,
  ChildAgentSnapshot,
} from "./runtime-types.js";

import type { AgentRuntimeDependencies } from "./agent-runtime-dependencies.js";
export function createTeamLifecycle(
  services: Pick<
    AgentRuntimeDependencies,
    | "requireActiveThread"
    | "directChildren"
    | "emitTeam"
    | "sendAgentTeamMessage"
    | "teamSnapshot"
    | "requireChildAgent"
    | "emitChild"
    | "childSnapshot"
    | "requestChildCancellation"
  >,
) {
  function finishAgentTeam(
    threadId: string,
    waivedAgentIds: string[],
    summary: string,
  ): AgentTeamSnapshot {
    const hosted = services.requireActiveThread(threadId);
    const team = hosted.team;
    if (!team) throw new Error("No active agent team is available.");
    const waived = new Set(waivedAgentIds);
    const unresolved = [...team.requiredAgentIds].filter((agentId) => {
      const child = hosted.childAgents.get(agentId);
      return child && !isTerminalChildStatus(child.status);
    });
    if (unresolved.length > 0) {
      throw new Error(
        `Required agents are still running: ${unresolved.join(", ")}.`,
      );
    }
    const failed = [...team.requiredAgentIds].filter((agentId) => {
      const status = hosted.childAgents.get(agentId)?.status;
      return status !== "completed" && !waived.has(agentId);
    });
    if (failed.length > 0) {
      throw new Error(
        `Required agents need retry or an explicit waiver: ${failed.join(", ")}.`,
      );
    }
    const unknownWaivers = [...waived].filter(
      (agentId) => !team.requiredAgentIds.has(agentId),
    );
    if (unknownWaivers.length > 0) {
      throw new Error(
        `Waived agents are not required members: ${unknownWaivers.join(", ")}.`,
      );
    }
    const unintegratedSubteams = team.memberAgentIds
      .map((agentId) => hosted.childAgents.get(agentId))
      .filter((child): child is ChildAgentExecution =>
        Boolean(
          child &&
          services.directChildren(hosted, child.agentId).length > 0 &&
          !child.subtreeIntegrated,
        ),
      );
    if (unintegratedSubteams.length > 0) {
      throw new Error(
        `Nested subteams are not integrated: ${unintegratedSubteams
          .map((child) => child.agentId)
          .join(", ")}.`,
      );
    }
    const integrationSummary = summary.trim();
    if (!integrationSummary) {
      throw new Error("An agent-team integration summary is required.");
    }
    team.status = "completed";
    team.blockedAgentIds.clear();
    delete team.error;
    services.emitTeam(hosted);
    void services.sendAgentTeamMessage(
      threadId,
      ROOT_AGENT_ID,
      "all",
      "handoff",
      integrationSummary,
    );
    return services.teamSnapshot(hosted);
  }

  async function finishAgentSubteam(
    threadId: string,
    actorAgentId: string,
    waivedAgentIds: string[],
    summary: string,
  ): Promise<ChildAgentSnapshot> {
    const { hosted, child: actor } = services.requireChildAgent(
      threadId,
      actorAgentId,
    );
    if (isTerminalChildStatus(actor.status)) {
      throw new Error("A completed agent cannot integrate a subteam.");
    }
    const directChildren = services.directChildren(hosted, actorAgentId);
    if (directChildren.length === 0) {
      throw new Error("This agent has no direct child agents to integrate.");
    }
    const requiredChildren = directChildren.filter(
      (candidate) => candidate.required,
    );
    const unresolved = requiredChildren.filter(
      (candidate) => !isTerminalChildStatus(candidate.status),
    );
    if (unresolved.length > 0) {
      throw new Error(
        `Required child agents are still running: ${unresolved
          .map((candidate) => candidate.agentId)
          .join(", ")}.`,
      );
    }
    const waived = new Set(waivedAgentIds);
    const failed = requiredChildren.filter(
      (candidate) =>
        candidate.status !== "completed" && !waived.has(candidate.agentId),
    );
    if (failed.length > 0) {
      throw new Error(
        `Required child agents need retry or an explicit waiver: ${failed
          .map((candidate) => candidate.agentId)
          .join(", ")}.`,
      );
    }
    const requiredIds = new Set(
      requiredChildren.map((candidate) => candidate.agentId),
    );
    const unknownWaivers = [...waived].filter(
      (agentId) => !requiredIds.has(agentId),
    );
    if (unknownWaivers.length > 0) {
      throw new Error(
        `Waived agents are not required direct children: ${unknownWaivers.join(", ")}.`,
      );
    }
    const unintegrated = directChildren.filter(
      (candidate) =>
        services.directChildren(hosted, candidate.agentId).length > 0 &&
        !candidate.subtreeIntegrated,
    );
    if (unintegrated.length > 0) {
      throw new Error(
        `Child subteams are not integrated: ${unintegrated
          .map((candidate) => candidate.agentId)
          .join(", ")}.`,
      );
    }
    const integrationSummary = summary.trim();
    if (!integrationSummary) {
      throw new Error("A subteam integration summary is required.");
    }
    actor.subtreeIntegrated = true;
    actor.subtreeSummary = integrationSummary.slice(0, 4 * 1024);
    services.emitChild(hosted, actor);
    await services.sendAgentTeamMessage(
      threadId,
      actorAgentId,
      "supervisor",
      "handoff",
      actor.subtreeSummary,
    );
    return services.childSnapshot(hosted, actor);
  }

  async function cancelAgentTeam(
    threadId: string,
    teamId: string,
    notifyParent = false,
  ): Promise<AgentTeamSnapshot> {
    const hosted = services.requireActiveThread(threadId);
    const team = hosted.team;
    if (!team || team.teamId !== teamId) {
      throw new Error(`Agent team was not found: ${teamId}`);
    }
    for (const agentId of team.memberAgentIds) {
      const child = hosted.childAgents.get(agentId);
      if (child) services.requestChildCancellation(hosted, child);
    }
    team.status = "aborted";
    team.error = "The agent team was stopped before integration completed.";
    services.emitTeam(hosted);
    if (notifyParent) {
      await hosted.session.sendCustomMessage(
        {
          customType: "artemis-agent-control",
          content:
            "The user stopped the agent team. Continue the current task without waiting for its members.",
          display: false,
          details: { action: "cancel-team", teamId },
        },
        { deliverAs: "steer" },
      );
    }
    return services.teamSnapshot(hosted);
  }
  const handlers = { finishAgentTeam, finishAgentSubteam, cancelAgentTeam };
  return handlers;
}

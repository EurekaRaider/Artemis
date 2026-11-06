import {
  CHILD_CONTROL_OBSERVATION_MILLISECONDS,
  ROOT_AGENT_ID,
  isTerminalChildStatus,
} from "./agent-team-policy.js";

import type { ChildAgentSnapshot } from "./runtime-types.js";

import { resolve } from "node:path";

import { isDefinitionEffectiveForProject } from "@artemis/protocol";

import type { AgentRuntimeDependencies } from "./agent-runtime-dependencies.js";
export function createChildControl(
  services: Pick<
    AgentRuntimeDependencies,
    | "requireChildAgent"
    | "emitChild"
    | "childSnapshot"
    | "descendantAgents"
    | "requestSubtreeCancellation"
    | "cancelChildAgent"
    | "sendAgentTeamMessage"
    | "refreshTeamStatus"
    | "requestChildCancellation"
    | "emitTeam"
    | "configuration"
  >,
) {
  async function steerChildAgent(
    threadId: string,
    agentId: string,
    text: string,
    notifyParent = false,
  ): Promise<ChildAgentSnapshot> {
    const { hosted, child } = services.requireChildAgent(threadId, agentId);
    if (isTerminalChildStatus(child.status) || child.status === "cancelling") {
      throw new Error(`Cannot steer a ${child.status} sub-agent.`);
    }
    const message = text.trim();
    if (!message)
      throw new Error("Sub-agent steering message cannot be empty.");
    if (child.status === "queued" || !child.session) {
      child.pendingSteers.push(message);
    } else {
      await child.session.steer(message);
    }
    services.emitChild(hosted, child, {
      activityDelta: `\n[steered] ${message.slice(0, 1_000)}\n`,
    });
    if (notifyParent && hosted.currentTurnId) {
      void hosted.session
        .sendCustomMessage(
          {
            customType: "artemis-agent-control",
            content: `The user nudged sub-agent ${agentId} (${child.label}). Check its status and adjust the approach if needed.`,
            display: false,
            details: { action: "steer", agentId },
          },
          { deliverAs: "steer" },
        )
        .catch(() => undefined);
    }
    return services.childSnapshot(hosted, child);
  }

  async function cancelChildAgent(
    threadId: string,
    agentId: string,
    notifyParent = false,
  ): Promise<ChildAgentSnapshot> {
    const { hosted, child } = services.requireChildAgent(threadId, agentId);
    const subtree = [child, ...services.descendantAgents(hosted, agentId)];
    if (subtree.some((member) => !isTerminalChildStatus(member.status))) {
      services.requestSubtreeCancellation(hosted, child);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.all(subtree.map((member) => member.done)),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, CHILD_CONTROL_OBSERVATION_MILLISECONDS);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    if (notifyParent && hosted.currentTurnId) {
      void hosted.session
        .sendCustomMessage(
          {
            customType: "artemis-agent-control",
            content: `Sub-agent ${agentId} (${child.label}) was stopped by the user. Do not keep waiting for it; continue with another approach.`,
            display: false,
            details: { action: "cancel", agentId },
          },
          { deliverAs: "steer" },
        )
        .catch(() => undefined);
    }
    return services.childSnapshot(hosted, child);
  }

  async function takeOverChildAgent(
    threadId: string,
    agentId: string,
    summary: string,
  ): Promise<ChildAgentSnapshot> {
    const { hosted, child } = services.requireChildAgent(threadId, agentId);
    const team = hosted.team;
    if (!team?.memberAgentIds.includes(agentId)) {
      throw new Error("Only a current team member can be taken over.");
    }
    if (!summary.trim()) throw new Error("A takeover plan is required.");
    await services.cancelChildAgent(threadId, agentId);
    if (hosted.team !== team || hosted.currentTurnId !== team.turnId) {
      throw new Error("The active team changed during cancellation.");
    }
    const subtree = [child, ...services.descendantAgents(hosted, agentId)];
    if (subtree.some((member) => !isTerminalChildStatus(member.status))) {
      throw new Error(
        "Cancellation is still pending. Do not write in this subtree's scopes until all members have stopped. Inspect their status before retrying takeover.",
      );
    }
    // Preserve the failed attempts as history; the root now owns their work.
    for (const member of subtree) {
      team.requiredAgentIds.delete(member.agentId);
      team.blockedAgentIds.delete(member.agentId);
      member.required = false;
      member.subtreeIntegrated = true;
      member.subtreeSummary = `Taken over by parent: ${summary.trim()}`;
      services.emitChild(hosted, member);
    }
    await services.sendAgentTeamMessage(
      threadId,
      ROOT_AGENT_ID,
      ROOT_AGENT_ID,
      "finding",
      `Parent took over ${agentId} and its subtree after they stopped. Remaining work: ${summary.trim()}`,
    );
    services.refreshTeamStatus(hosted);
    return services.childSnapshot(hosted, child);
  }

  function retryChildAgent(
    threadId: string,
    agentId: string,
    notifyParent = false,
  ): ChildAgentSnapshot {
    const { hosted, child } = services.requireChildAgent(threadId, agentId);
    if (!isTerminalChildStatus(child.status)) {
      throw new Error("Stop the sub-agent before retrying it.");
    }
    if (!hosted.currentTurnId || !hosted.currentMode) {
      throw new Error("A sub-agent can be retried only during an active task.");
    }
    const descendants = services.descendantAgents(hosted, child.agentId);
    for (const descendant of descendants) {
      services.requestChildCancellation(hosted, descendant);
    }
    const team = hosted.team;
    if (team && descendants.length > 0) {
      const discardedIds = new Set(
        descendants.map((descendant) => descendant.agentId),
      );
      team.memberAgentIds = team.memberAgentIds.filter(
        (memberAgentId) => !discardedIds.has(memberAgentId),
      );
      for (const discardedId of discardedIds) {
        team.requiredAgentIds.delete(discardedId);
        team.blockedAgentIds.delete(discardedId);
        team.memberVersions.delete(discardedId);
      }
      services.emitTeam(hosted);
    }
    if (child.customAgentSnapshot) {
      const definition = services.configuration.customAgents?.find(
        (candidate) => candidate.id === child.customAgentSnapshot?.definitionId,
      );
      if (!definition || !definition.enabled) {
        throw new Error(
          "CUSTOM_AGENT_DISABLED: the definition was disabled or deleted; retrying would bypass the current authorization.",
        );
      }
      if (
        !isDefinitionEffectiveForProject(
          definition,
          services.configuration.customAgentProjectIds?.[definition.id] ?? [],
          child.customAgentSnapshot.projectId,
        )
      ) {
        throw new Error(
          "CUSTOM_AGENT_OUT_OF_SCOPE: the definition is no longer effective for this project.",
        );
      }
    }
    const retried = hosted.launchChildAgent({
      turnId: hosted.currentTurnId,
      mode: hosted.currentMode,
      label: child.label,
      task: child.task,
      role: child.role,
      dependsOnAgentIds: [...child.dependsOnAgentIds],
      writePaths: [...child.writePaths],
      required: child.required,
      attempt: child.attempt + 1,
      parentAgentId: child.parentAgentId,
      depth: child.depth,
      replacesAgentId: child.agentId,
      ...(child.customAgentSnapshot
        ? { customAgentSnapshot: child.customAgentSnapshot }
        : {}),
    });
    if (notifyParent) {
      void hosted.session
        .sendCustomMessage(
          {
            customType: "artemis-agent-control",
            content: `The user retried sub-agent ${agentId} as ${retried.agentId}. Monitor the new attempt instead of the old one.`,
            display: false,
            details: {
              action: "retry",
              agentId,
              replacementAgentId: retried.agentId,
            },
          },
          { deliverAs: "steer" },
        )
        .catch(() => undefined);
    }
    return services.childSnapshot(hosted, retried);
  }
  const handlers = {
    steerChildAgent,
    cancelChildAgent,
    takeOverChildAgent,
    retryChildAgent,
  };
  return handlers;
}

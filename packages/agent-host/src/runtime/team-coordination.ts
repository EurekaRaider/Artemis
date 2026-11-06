import { ROOT_AGENT_ID, isTerminalChildStatus } from "./agent-team-policy.js";

import type { AgentTeamSnapshot, ChildAgentSnapshot } from "./runtime-types.js";

import { randomUUID } from "node:crypto";

import { resolve } from "node:path";

import type { AgentTeamMessagePayload } from "@artemis/protocol";

import type { AgentRuntimeDependencies } from "./agent-runtime-dependencies.js";
export function createTeamCoordination(
  services: Pick<
    AgentRuntimeDependencies,
    | "requireActiveThread"
    | "childHealth"
    | "teamSnapshot"
    | "sink"
    | "emitTeam"
    | "emitChild"
    | "requireChildAgent"
    | "validateTeamWritePaths"
    | "childSnapshot"
  >,
) {
  async function waitForAgentTeam(
    threadId: string,
    observerAgentId: string,
    deadlineSeconds: number,
  ): Promise<AgentTeamSnapshot> {
    if (
      !Number.isFinite(deadlineSeconds) ||
      deadlineSeconds < 1 ||
      deadlineSeconds > 300
    ) {
      throw new Error("Agent-team observation deadline must be 1-300 seconds.");
    }
    const hosted = services.requireActiveThread(threadId);
    const team = hosted.team;
    if (!team) throw new Error("No active agent team is available.");
    const startedAt = new Date().toISOString();
    const currentHealth = () =>
      new Map(
        team.memberAgentIds.map((agentId) => [
          agentId,
          services.childHealth(hosted.childAgents.get(agentId)!),
        ]),
      );
    const firstObservation = !team.observers.has(observerAgentId);
    const observer = team.observers.get(observerAgentId) ?? {
      messageSequence: 0,
      memberVersions: new Map<string, number>(),
      memberHealth: new Map<string, ChildAgentSnapshot["health"]>(),
    };
    team.observers.set(observerAgentId, observer);
    const healthChanged = () =>
      [...currentHealth()].some(
        ([agentId, health]) => observer.memberHealth.get(agentId) !== health,
      );
    const unseenSnapshot = (observationExpired: boolean, full = false) => {
      const memberAgentIds = team.memberAgentIds.filter(
        (agentId) =>
          (team.memberVersions.get(agentId) ?? 0) !==
          (observer.memberVersions.get(agentId) ?? 0),
      );
      const messages = team.messages.filter(
        (message) => message.sequence > observer.messageSequence,
      );
      observer.messageSequence = team.messageSequence;
      observer.memberVersions = new Map(team.memberVersions);
      observer.memberHealth = currentHealth();
      const snapshot = services.teamSnapshot(
        hosted,
        observationExpired,
        messages,
        full || observationExpired || team.status !== "running"
          ? undefined
          : memberAgentIds,
      );
      snapshot.observation = {
        startedAt,
        observedAt: new Date().toISOString(),
      };
      return snapshot;
    };
    if (
      firstObservation ||
      healthChanged() ||
      team.status === "blocked" ||
      team.status === "integrating" ||
      team.status === "completed" ||
      team.status === "aborted"
    ) {
      return unseenSnapshot(false, true);
    }
    if (
      team.messageSequence > observer.messageSequence ||
      team.memberAgentIds.some(
        (agentId) =>
          team.memberVersions.get(agentId) !==
          observer.memberVersions.get(agentId),
      )
    ) {
      return unseenSnapshot(false);
    }
    let wake!: () => void;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let healthTimer: ReturnType<typeof setInterval> | undefined;
    try {
      const observedChange = await new Promise<boolean>((resolve) => {
        wake = () => resolve(true);
        team.waiters.add(wake);
        timer = setTimeout(() => resolve(false), deadlineSeconds * 1_000);
        // Health can deteriorate without a new model/tool event.
        healthTimer = setInterval(() => {
          if (healthChanged()) wake();
        }, 1_000);
      });
      return unseenSnapshot(!observedChange, healthChanged());
    } finally {
      if (timer) clearTimeout(timer);
      if (healthTimer) clearInterval(healthTimer);
      team.waiters.delete(wake);
    }
  }

  async function sendAgentTeamMessage(
    threadId: string,
    senderAgentId: string,
    recipient: string,
    kind: AgentTeamMessagePayload["kind"],
    content: string,
  ): Promise<AgentTeamMessagePayload> {
    const hosted = services.requireActiveThread(threadId);
    const team = hosted.team;
    if (!team) throw new Error("No active agent team is available.");
    if (
      senderAgentId !== "parent" &&
      !team.memberAgentIds.includes(senderAgentId)
    ) {
      throw new Error("The message sender is not a member of this team.");
    }
    const resolvedRecipient =
      recipient === "supervisor"
        ? senderAgentId === ROOT_AGENT_ID
          ? ROOT_AGENT_ID
          : (hosted.childAgents.get(senderAgentId)?.parentAgentId ??
            ROOT_AGENT_ID)
        : recipient;
    if (
      resolvedRecipient !== ROOT_AGENT_ID &&
      resolvedRecipient !== "all" &&
      !team.memberAgentIds.includes(resolvedRecipient)
    ) {
      throw new Error(
        `Agent-team recipient was not found: ${resolvedRecipient}`,
      );
    }
    const messageText = content.trim();
    if (!messageText) throw new Error("Agent-team message cannot be empty.");
    const createdAt = new Date().toISOString();
    const message: AgentTeamMessagePayload = {
      type: "agent-team.message",
      teamId: team.teamId,
      messageId: randomUUID(),
      sequence: ++team.messageSequence,
      fromAgentId: senderAgentId,
      recipient: resolvedRecipient,
      kind,
      content: messageText.slice(0, 8 * 1024),
      createdAt,
    };
    team.messages.push(message);
    if (kind === "blocker" && senderAgentId !== "parent") {
      team.blockedAgentIds.add(senderAgentId);
      team.status = "blocked";
    } else if (
      (kind === "handoff" || kind === "finding") &&
      senderAgentId !== "parent"
    ) {
      team.blockedAgentIds.delete(senderAgentId);
    }
    services.sink.emit(hosted.threadId, team.turnId, message);
    services.emitTeam(hosted);

    const envelope = `[agent-team ${kind}] ${senderAgentId}: ${message.content}`;
    const targetAgentIds =
      resolvedRecipient === "all"
        ? team.memberAgentIds.filter((agentId) => agentId !== senderAgentId)
        : resolvedRecipient === ROOT_AGENT_ID
          ? []
          : [resolvedRecipient];
    for (const agentId of targetAgentIds) {
      const target = hosted.childAgents.get(agentId);
      if (!target || isTerminalChildStatus(target.status)) {
        if (resolvedRecipient !== "all") {
          throw new Error(
            `Cannot message a ${target?.status ?? "missing"} agent.`,
          );
        }
        continue;
      }
      if (target.status === "queued" || !target.session) {
        target.pendingSteers.push(envelope);
      } else {
        await target.session.sendCustomMessage(
          {
            customType: "artemis-agent-team",
            content: envelope,
            display: false,
            details: {
              teamId: team.teamId,
              messageId: message.messageId,
              fromAgentId: senderAgentId,
              recipient: resolvedRecipient,
              kind,
            },
          },
          { deliverAs: "steer" },
        );
      }
    }
    if (
      senderAgentId !== "parent" &&
      (resolvedRecipient === ROOT_AGENT_ID || resolvedRecipient === "all") &&
      kind !== "finding"
    ) {
      await hosted.session.sendCustomMessage(
        {
          customType: "artemis-agent-team",
          content: envelope,
          display: false,
          details: {
            teamId: team.teamId,
            messageId: message.messageId,
            fromAgentId: senderAgentId,
            recipient: resolvedRecipient,
            kind,
          },
        },
        { deliverAs: "steer" },
      );
    }
    if (senderAgentId !== ROOT_AGENT_ID) {
      const sender = hosted.childAgents.get(senderAgentId);
      if (sender) {
        sender.lastActivityAt = Date.now();
        services.emitChild(hosted, sender);
      }
    }
    return message;
  }

  function setAgentWriteScope(
    threadId: string,
    agentId: string,
    paths: string[],
  ): ChildAgentSnapshot {
    const { hosted, child } = services.requireChildAgent(threadId, agentId);
    if (isTerminalChildStatus(child.status)) {
      throw new Error(
        `Cannot change a ${child.status} sub-agent's write scope.`,
      );
    }
    child.writePaths = services.validateTeamWritePaths(hosted, agentId, paths);
    services.emitChild(hosted, child);
    return services.childSnapshot(hosted, child);
  }
  const handlers = {
    waitForAgentTeam,
    sendAgentTeamMessage,
    setAgentWriteScope,
  };
  return handlers;
}

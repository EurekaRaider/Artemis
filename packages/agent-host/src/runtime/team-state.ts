import {
  isTerminalChildStatus,
  isTerminalChildExecution,
  normalizedWritePaths,
  writePathsOverlap,
} from "./agent-team-policy.js";

import type {
  HostedThread,
  ChildAgentExecution,
  AgentTeamExecution,
  AgentTeamSnapshot,
} from "./runtime-types.js";

import { randomUUID } from "node:crypto";

import { resolve } from "node:path";

import {
  AGENT_TEAM_LOGICAL_MAXIMUM,
  AGENT_TEAM_MAXIMUM_DEPTH,
  AGENT_TEAM_SPAWN_BUDGET,
  type AgentTeamMessagePayload,
  type AgentTeamStatusPayload,
} from "@artemis/protocol";

import type { AgentRuntimeDependencies } from "./agent-runtime-dependencies.js";
export function createTeamState(
  services: Pick<
    AgentRuntimeDependencies,
    | "teamPayload"
    | "sink"
    | "notifyTeam"
    | "emitTeam"
    | "childSnapshot"
    | "threads"
    | "requireActiveThread"
    | "teamSnapshot"
  >,
) {
  function teamPayload(team: AgentTeamExecution): AgentTeamStatusPayload {
    return {
      type: "agent-team.status",
      teamId: team.teamId,
      mission: team.mission,
      status: team.status,
      memberAgentIds: [...team.memberAgentIds],
      requiredAgentIds: [...team.requiredAgentIds],
      maxMembers: AGENT_TEAM_LOGICAL_MAXIMUM,
      maxDepth: AGENT_TEAM_MAXIMUM_DEPTH,
      spawnBudgetRemaining: Math.max(
        0,
        AGENT_TEAM_SPAWN_BUDGET - team.spawnCount,
      ),
      updatedAt: new Date(team.updatedAt).toISOString(),
      ...(team.error ? { error: team.error } : {}),
    };
  }

  function notifyTeam(team: AgentTeamExecution): void {
    team.version += 1;
    for (const resolve of team.waiters) resolve();
    team.waiters.clear();
  }

  function emitTeam(hosted: HostedThread): void {
    const team = hosted.team;
    if (!team) return;
    team.updatedAt = Date.now();
    services.sink.emit(
      hosted.threadId,
      team.turnId,
      services.teamPayload(team),
    );
    services.notifyTeam(team);
  }

  function refreshTeamStatus(hosted: HostedThread): void {
    const team = hosted.team;
    if (
      !team ||
      team.status === "completed" ||
      team.status === "aborted" ||
      team.status === "forming"
    ) {
      return;
    }
    const required = [...team.requiredAgentIds]
      .map((agentId) => hosted.childAgents.get(agentId))
      .filter((child): child is ChildAgentExecution => Boolean(child));
    const nextStatus =
      team.blockedAgentIds.size > 0 ||
      required.some(
        (child) =>
          child.status === "failed" ||
          child.status === "blocked" ||
          child.status === "cancelled",
      )
        ? "blocked"
        : required.length > 0 && required.every(isTerminalChildExecution)
          ? "integrating"
          : "running";
    if (team.status !== nextStatus) {
      team.status = nextStatus;
      services.emitTeam(hosted);
    } else {
      services.notifyTeam(team);
    }
  }

  function teamSnapshot(
    hosted: HostedThread,
    observationExpired = false,
    messages?: AgentTeamMessagePayload[],
    memberAgentIds?: string[],
  ): AgentTeamSnapshot {
    const team = hosted.team;
    if (!team) throw new Error("No active agent team is available.");
    return {
      team: services.teamPayload(team),
      members: (memberAgentIds ?? team.memberAgentIds)
        .map((agentId) => hosted.childAgents.get(agentId))
        .filter((child): child is ChildAgentExecution => Boolean(child))
        .map((child) => services.childSnapshot(hosted, child)),
      messages: messages ?? [...team.messages],
      observationExpired,
      snapshotKind: memberAgentIds === undefined ? "full" : "delta",
      blockingAgentIds: [
        ...new Set([
          ...team.blockedAgentIds,
          ...[...team.requiredAgentIds].filter((agentId) => {
            const status = hosted.childAgents.get(agentId)?.status;
            return (
              status === "failed" ||
              status === "blocked" ||
              status === "cancelled"
            );
          }),
        ]),
      ],
    };
  }

  function interruptedTeamSummary(hosted: HostedThread): string | undefined {
    const team = hosted.team;
    if (!team || team.status !== "aborted") return undefined;
    const members = team.memberAgentIds.flatMap((agentId) => {
      const child = hosted.childAgents.get(agentId);
      if (!child) return [];
      const priorProgress = (child.output || child.error || "")
        .trim()
        .slice(-1_500);
      return [
        [
          `- ${child.label} (${child.role}, ${child.status})`,
          `  Original task: ${child.task.slice(0, 2_000)}`,
          priorProgress ? `  Prior progress: ${priorProgress}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      ];
    });
    const messages = team.messages
      .slice(-12)
      .map(
        (message) =>
          `- ${message.fromAgentId} -> ${message.recipient} [${message.kind}]: ${message.content.slice(0, 1_000)}`,
      );
    return [
      `Mission: ${team.mission}`,
      members.length > 0 ? `Members:\n${members.join("\n")}` : "",
      messages.length > 0
        ? `Recent collaboration messages:\n${messages.join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 16 * 1_024);
  }

  function ensureTeam(hosted: HostedThread): AgentTeamExecution {
    if (hosted.team) return hosted.team;
    if (!hosted.currentTurnId) {
      throw new Error("No active turn is available for an agent team.");
    }
    const now = Date.now();
    hosted.interruptedTeamContext = undefined;
    hosted.team = {
      teamId: randomUUID(),
      turnId: hosted.currentTurnId,
      mission: hosted.currentMission ?? "Complete the current task.",
      status: "forming",
      memberAgentIds: [],
      requiredAgentIds: new Set(),
      blockedAgentIds: new Set(),
      messageSequence: 0,
      messages: [],
      memberVersions: new Map(),
      observers: new Map(),
      spawnCount: 0,
      updatedAt: now,
      version: 0,
      waiters: new Set(),
    };
    services.emitTeam(hosted);
    return hosted.team;
  }

  function validateTeamWritePaths(
    hosted: HostedThread,
    agentId: string | undefined,
    paths: string[],
  ): string[] {
    const normalized = normalizedWritePaths(hosted.workspacePath, paths);
    const team = hosted.team;
    if (!team) return normalized;
    for (const otherAgentId of team.memberAgentIds) {
      if (otherAgentId === agentId) continue;
      const other = hosted.childAgents.get(otherAgentId);
      if (!other || isTerminalChildStatus(other.status)) continue;
      for (const path of normalized) {
        const overlap = other.writePaths.find((otherPath) =>
          writePathsOverlap(path, otherPath),
        );
        if (overlap) {
          throw new Error(
            `Write scope ${path} overlaps ${other.label}'s scope ${overlap}.`,
          );
        }
      }
    }
    return normalized;
  }

  function suspendAgentLease<T>(
    threadId: string,
    actorAgentId: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const lease = services.threads
      .get(threadId)
      ?.activeLeases.get(actorAgentId);
    return lease ? lease.suspend(task) : task();
  }

  function listAgentTeam(threadId: string): AgentTeamSnapshot {
    const hosted = services.requireActiveThread(threadId);
    return services.teamSnapshot(hosted);
  }
  const handlers = {
    teamPayload,
    notifyTeam,
    emitTeam,
    refreshTeamStatus,
    teamSnapshot,
    interruptedTeamSummary,
    ensureTeam,
    validateTeamWritePaths,
    suspendAgentLease,
    listAgentTeam,
  };
  return handlers;
}

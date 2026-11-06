import { isTerminalChildStatus } from "./agent-team-policy.js";

import type {
  HostedThread,
  ChildAgentExecution,
  ChildAgentSnapshot,
} from "./runtime-types.js";

import { resolve } from "node:path";

import type { ChildAgentPayload } from "@artemis/protocol";

import type { AgentRuntimeDependencies } from "./agent-runtime-dependencies.js";
export function createChildObservation(
  services: Pick<
    AgentRuntimeDependencies,
    | "childSubtreeStatus"
    | "directChildren"
    | "childHealth"
    | "childSnapshot"
    | "sink"
    | "notifyChild"
    | "refreshTeamStatus"
    | "requireChildAgent"
    | "emitChild"
    | "observeChild"
  >,
) {
  function childSnapshot(
    hosted: HostedThread,
    child: ChildAgentExecution,
    observationExpired = false,
  ): ChildAgentSnapshot {
    const now = Date.now();
    const coordinationStatus =
      child.status === "blocked"
        ? "blocked"
        : child.status === "completed"
          ? "ready-for-integration"
          : child.status === "running"
            ? "working"
            : child.dependsOnAgentIds.length > 0
              ? "waiting-dependency"
              : undefined;
    return {
      agentId: child.agentId,
      label: child.label,
      parentAgentId: child.parentAgentId,
      depth: child.depth,
      subtreeStatus: services.childSubtreeStatus(hosted, child),
      directChildCount: services.directChildren(hosted, child.agentId).length,
      task: child.task,
      role: child.role,
      dependsOnAgentIds: [...child.dependsOnAgentIds],
      writePaths: [...child.writePaths],
      required: child.required,
      ...(coordinationStatus ? { coordinationStatus } : {}),
      ...(child.status === "queued"
        ? {
            queueReason: child.dependsOnAgentIds.some((agentId) => {
              const dependency = hosted.childAgents.get(agentId);
              return dependency && !isTerminalChildStatus(dependency.status);
            })
              ? ("dependency" as const)
              : ("capacity" as const),
          }
        : {}),
      status: child.status,
      health: services.childHealth(child),
      attempt: child.attempt,
      updatedAt: new Date(child.updatedAt).toISOString(),
      lastActivityAt: new Date(child.lastActivityAt).toISOString(),
      elapsedMilliseconds: now - (child.startedAt ?? child.createdAt),
      observationExpired,
      ...(child.startedAt
        ? { startedAt: new Date(child.startedAt).toISOString() }
        : {}),
      ...(child.currentTool ? { currentTool: child.currentTool } : {}),
      ...(child.currentToolStartedAt
        ? {
            currentToolStartedAt: new Date(
              child.currentToolStartedAt,
            ).toISOString(),
          }
        : {}),
      ...(child.output ? { output: child.output } : {}),
      ...(child.error ? { error: child.error } : {}),
      ...(child.customAgentSnapshot
        ? {
            customAgent: {
              definitionId: child.customAgentSnapshot.definitionId,
              definitionRevision: child.customAgentSnapshot.definitionRevision,
              name: child.customAgentSnapshot.definitionName,
              providerId: child.customAgentSnapshot.resolvedModel.providerId,
              modelId: child.customAgentSnapshot.resolvedModel.modelId,
              invocationSource: child.customAgentSnapshot.invocationSource,
              ...(child.customAgentSnapshot.invocationId
                ? { invocationId: child.customAgentSnapshot.invocationId }
                : {}),
            },
          }
        : {}),
    };
  }

  function emitChild(
    hosted: HostedThread,
    child: ChildAgentExecution,
    extra:
      Pick<ChildAgentPayload, "activityDelta"> | Record<string, never> = {},
    notifyObservers = true,
  ): void {
    child.updatedAt = Date.now();
    const snapshot = services.childSnapshot(hosted, child);
    services.sink.emit(hosted.threadId, child.turnId, {
      type: "child-agent.status",
      agentId: child.agentId,
      label: child.label,
      ...(hosted.team ? { teamId: hosted.team.teamId } : {}),
      parentAgentId: child.parentAgentId,
      depth: child.depth,
      subtreeStatus: snapshot.subtreeStatus,
      directChildCount: snapshot.directChildCount,
      role: child.role,
      dependsOnAgentIds: [...child.dependsOnAgentIds],
      writePaths: [...child.writePaths],
      required: child.required,
      coordinationStatus:
        child.status === "blocked"
          ? "blocked"
          : child.status === "completed"
            ? "ready-for-integration"
            : child.status === "running"
              ? "working"
              : child.dependsOnAgentIds.length > 0
                ? "waiting-dependency"
                : undefined,
      task: child.task,
      status: child.status,
      health: snapshot.health,
      attempt: child.attempt,
      updatedAt: snapshot.updatedAt,
      lastActivityAt: snapshot.lastActivityAt,
      ...(snapshot.startedAt ? { startedAt: snapshot.startedAt } : {}),
      ...(snapshot.customAgent ? { customAgent: snapshot.customAgent } : {}),
      ...(snapshot.currentTool ? { currentTool: snapshot.currentTool } : {}),
      ...(snapshot.currentToolStartedAt
        ? { currentToolStartedAt: snapshot.currentToolStartedAt }
        : {}),
      ...(snapshot.output && !("activityDelta" in extra)
        ? { output: snapshot.output }
        : {}),
      ...(snapshot.error ? { error: snapshot.error } : {}),
      ...extra,
    });
    if (notifyObservers) services.notifyChild(child);
    if (hosted.team?.memberAgentIds.includes(child.agentId)) {
      hosted.team.memberVersions.set(
        child.agentId,
        (hosted.team.memberVersions.get(child.agentId) ?? 0) + 1,
      );
      services.refreshTeamStatus(hosted);
    }
  }

  function notifyChild(child: ChildAgentExecution): void {
    child.activityVersion += 1;
    for (const resolve of child.activityWaiters) resolve();
    child.activityWaiters.clear();
  }

  async function observeChild(
    child: ChildAgentExecution,
    observationMilliseconds: number,
  ): Promise<{ observationExpired: boolean; elapsedMilliseconds: number }> {
    const startedAt = Date.now();
    if (isTerminalChildStatus(child.status)) {
      return { observationExpired: false, elapsedMilliseconds: 0 };
    }
    const startVersion = child.activityVersion;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wake: (() => void) | undefined;
    const changed = new Promise<"changed">((resolve) => {
      wake = () => resolve("changed");
      child.activityWaiters.add(wake);
    });
    const deadline = new Promise<"deadline">((resolve) => {
      timer = setTimeout(() => resolve("deadline"), observationMilliseconds);
    });
    const result =
      child.activityVersion !== startVersion
        ? "changed"
        : await Promise.race([
            child.done.then(() => "settled" as const),
            changed,
            deadline,
          ]);
    if (timer) clearTimeout(timer);
    if (wake) child.activityWaiters.delete(wake);
    return {
      observationExpired:
        result === "deadline" && !isTerminalChildStatus(child.status),
      elapsedMilliseconds: Math.max(0, Date.now() - startedAt),
    };
  }

  function childAgentStatus(
    threadId: string,
    agentId: string,
  ): ChildAgentSnapshot {
    const { hosted, child } = services.requireChildAgent(threadId, agentId);
    services.emitChild(hosted, child, {}, false);
    return services.childSnapshot(hosted, child);
  }

  async function waitForChildAgent(
    threadId: string,
    agentId: string,
    deadlineSeconds: number,
  ): Promise<ChildAgentSnapshot> {
    if (
      !Number.isFinite(deadlineSeconds) ||
      deadlineSeconds < 1 ||
      deadlineSeconds > 300
    ) {
      throw new Error("Sub-agent observation deadline must be 1-300 seconds.");
    }
    const { hosted, child } = services.requireChildAgent(threadId, agentId);
    const observationMilliseconds = deadlineSeconds * 1_000;
    const observation = await services.observeChild(
      child,
      observationMilliseconds,
    );
    child.recentObservationMilliseconds = [
      ...child.recentObservationMilliseconds,
      observation.elapsedMilliseconds,
    ].slice(-5);
    services.emitChild(hosted, child, {}, false);
    return services.childSnapshot(
      hosted,
      child,
      observation.observationExpired,
    );
  }
  const handlers = {
    childSnapshot,
    emitChild,
    notifyChild,
    observeChild,
    childAgentStatus,
    waitForChildAgent,
  };
  return handlers;
}

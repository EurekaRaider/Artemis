import {
  CHILD_MIN_SUSPECT_SILENCE_MILLISECONDS,
  CHILD_STALLED_SILENCE_MILLISECONDS,
  isTerminalChildStatus,
  isTerminalChildExecution,
} from "./agent-team-policy.js";

import type {
  HostedThread,
  ChildAgentExecution,
  ChildAgentSnapshot,
} from "./runtime-types.js";

import type { ChildAgentPayload } from "@artemis/protocol";

import type { AgentRuntimeDependencies } from "./agent-runtime-dependencies.js";
export function createChildTree(
  services: Pick<
    AgentRuntimeDependencies,
    | "bashExecutions"
    | "emitChild"
    | "directChildren"
    | "requestChildCancellation"
    | "descendantAgents"
    | "threads"
  >,
) {
  function childHealth(
    child: ChildAgentExecution,
  ): ChildAgentSnapshot["health"] {
    if (child.status === "failed" || child.status === "blocked") {
      return "stalled";
    }
    if (child.status === "cancelling") return "suspect";
    if (child.status !== "running") {
      return "healthy";
    }
    const recentObservationMaximum = Math.max(
      0,
      ...child.recentObservationMilliseconds.slice(-5),
    );
    const suspectAfter = Math.max(
      CHILD_MIN_SUSPECT_SILENCE_MILLISECONDS,
      recentObservationMaximum * 2,
    );
    const silenceMilliseconds = Date.now() - child.lastActivityAt;
    if (
      !child.currentTool &&
      silenceMilliseconds >=
        Math.max(CHILD_STALLED_SILENCE_MILLISECONDS, suspectAfter * 5)
    ) {
      return "stalled";
    }
    return silenceMilliseconds >= suspectAfter ? "suspect" : "healthy";
  }

  function requestChildCancellation(
    hosted: HostedThread,
    child: ChildAgentExecution,
  ): void {
    if (isTerminalChildStatus(child.status)) return;
    child.status = "cancelling";
    child.lastActivityAt = Date.now();
    child.controller.abort();
    services.bashExecutions.cancelScope({
      threadId: hosted.threadId,
      turnId: child.turnId,
      ownerId: child.agentId,
    });
    void child.session?.abort().catch(() => undefined);
    services.emitChild(hosted, child, {
      activityDelta: "\n[cancellation requested]\n",
    });
  }

  function descendantAgents(
    hosted: HostedThread,
    agentId: string,
  ): ChildAgentExecution[] {
    const descendants: ChildAgentExecution[] = [];
    const pending = [agentId];
    while (pending.length > 0) {
      const parentAgentId = pending.shift()!;
      for (const child of services.directChildren(hosted, parentAgentId)) {
        descendants.push(child);
        pending.push(child.agentId);
      }
    }
    return descendants;
  }

  function requestSubtreeCancellation(
    hosted: HostedThread,
    child: ChildAgentExecution,
  ): void {
    for (const descendant of services
      .descendantAgents(hosted, child.agentId)
      .reverse()) {
      services.requestChildCancellation(hosted, descendant);
    }
    services.requestChildCancellation(hosted, child);
  }

  function directChildren(
    hosted: HostedThread,
    agentId: string,
  ): ChildAgentExecution[] {
    const currentMembers = new Set(hosted.team?.memberAgentIds ?? []);
    return [...hosted.childAgents.values()].filter(
      (candidate) =>
        candidate.parentAgentId === agentId &&
        currentMembers.has(candidate.agentId),
    );
  }

  function childSubtreeStatus(
    hosted: HostedThread,
    child: ChildAgentExecution,
  ): NonNullable<ChildAgentPayload["subtreeStatus"]> {
    const directChildren = services.directChildren(hosted, child.agentId);
    if (directChildren.length === 0) return "leaf";
    if (child.subtreeIntegrated) return "integrated";
    if (
      directChildren.some(
        (candidate) =>
          candidate.status === "failed" ||
          candidate.status === "blocked" ||
          candidate.status === "cancelled",
      )
    ) {
      return "blocked";
    }
    return directChildren.every(isTerminalChildExecution) ? "ready" : "running";
  }

  function requireChildAgent(
    threadId: string,
    agentId: string,
  ): { hosted: HostedThread; child: ChildAgentExecution } {
    const hosted = services.threads.get(threadId);
    const child = hosted?.childAgents.get(agentId);
    if (!hosted || !child) {
      throw new Error(`Sub-agent was not found: ${agentId}`);
    }
    return { hosted, child };
  }
  const handlers = {
    childHealth,
    requestChildCancellation,
    descendantAgents,
    requestSubtreeCancellation,
    directChildren,
    childSubtreeStatus,
    requireChildAgent,
  };
  return handlers;
}

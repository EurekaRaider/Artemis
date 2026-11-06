import type { GoalBrokerRequest } from "../application/runtime-types.js";
import { isExecutionMode } from "@artemis/protocol";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { app } from "electron";
import type { AgentPayload, ThreadGoal } from "@artemis/protocol";
import {
  cleanupGoalObjective as cleanupGoalObjectiveFile,
  materializeGoalObjective as materializeGoalObjectiveFile,
  readGoalObjective as readGoalObjectiveFile,
} from "../conversation/goal-objective.js";
import {
  GOAL_CONTINUATION_RETRY_DELAY_MILLISECONDS,
  goalFailureBlocker,
  goalFailureDisposition,
} from "../conversation/goal-continuation.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "store"
  | "scheduledGoalContinuations"
  | "agentProcess"
  | "imService"
  | "activeTurns"
  | "compactingThreads"
  | "cancellingTurns"
  | "pendingApprovals"
  | "pendingUserInputs"
  | "pendingMultiUserInputs"
  | "diagnosticBundleService"
  | "startTaskTurn"
  | "openedThreads"
  | "goalCreationAuthorizations"
  | "goalBlockerRecordedTurns"
  | "goalTurnContexts"
  | "emitPayload"
  | "rejectBrokerRequest"
  | "cancelTaskTurn"
>;
export function createGoalRuntime(services: Dependencies) {
  const {
    scheduledGoalContinuations,
    activeTurns,
    compactingThreads,
    cancellingTurns,
    pendingApprovals,
    pendingUserInputs,
    pendingMultiUserInputs,
    startTaskTurn,
    openedThreads,
    goalCreationAuthorizations,
    goalBlockerRecordedTurns,
    goalTurnContexts,
    emitPayload,
    rejectBrokerRequest,
    cancelTaskTurn,
  } = services;
  function applyGoalContinuationFailure(
    threadId: string,
    goalId: string,
    failure: { message: string; code?: string | undefined },
  ): { goal: ThreadGoal; continuationDelayMs: number } | undefined {
    if (!services.store) return undefined;
    const current = services.store.getThreadGoal(threadId);
    if (!current || current.goalId !== goalId || current.status !== "active") {
      return undefined;
    }
    const disposition = goalFailureDisposition(failure);
    if (disposition === "usage-limited") {
      return {
        goal: services.store.markThreadGoalUsageLimited(threadId, goalId),
        continuationDelayMs: 0,
      };
    }
    if (disposition === "retry") {
      return {
        goal: current,
        continuationDelayMs: GOAL_CONTINUATION_RETRY_DELAY_MILLISECONDS,
      };
    }
    const recorded = services.store.recordThreadGoalBlocker(
      threadId,
      goalId,
      goalFailureBlocker(failure),
    );
    return {
      goal: recorded.goal,
      continuationDelayMs: GOAL_CONTINUATION_RETRY_DELAY_MILLISECONDS,
    };
  }

  function scheduleGoalContinuation(
    threadId: string,
    goalId: string,
    delayMs = 0,
  ): void {
    if (scheduledGoalContinuations.has(threadId)) return;
    scheduledGoalContinuations.add(threadId);
    setTimeout(() => {
      scheduledGoalContinuations.delete(threadId);
      if (!services.store || !services.agentProcess) return;
      const thread = services.store.getThread(threadId);
      if (
        !thread ||
        thread.archived ||
        services.store.plans(threadId).at(-1)?.status === "proposed" ||
        !isExecutionMode(thread.mode) ||
        thread.goal?.goalId !== goalId ||
        thread.goal.status !== "active" ||
        services.imService?.hasDelegationWait(threadId) ||
        services.imService?.hasPermissionBlock(threadId) ||
        activeTurns.has(threadId) ||
        compactingThreads.has(threadId) ||
        cancellingTurns.has(threadId) ||
        pendingApprovals.hasWhere(
          (pending) => pending.request.threadId === threadId,
        ) ||
        pendingUserInputs.hasWhere(
          (pending) => pending.request.threadId === threadId,
        ) ||
        pendingMultiUserInputs.hasWhere(
          (pending) => pending.request.threadId === threadId,
        )
      ) {
        return;
      }
      void startTaskTurn(
        {
          threadId,
          mode: thread.mode,
          text: "Continue working toward the active Goal. Inspect current evidence and state, make the next meaningful progress, and call update_goal only when completion or the repeated-blocker rule is actually satisfied.",
        },
        { source: "goal-continuation", expectedGoalId: goalId },
      ).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        const result = applyGoalContinuationFailure(threadId, goalId, {
          message,
        });
        if (result) emitGoalUpdated(result.goal);
        if (result?.goal.status === "active") {
          scheduleGoalContinuation(
            threadId,
            goalId,
            result.continuationDelayMs,
          );
        }
        services.diagnosticBundleService?.record({
          source: "main",
          severity: "error",
          message: `Goal continuation could not start: ${message}`,
        });
      });
    }, delayMs);
  }

  function goalObjectiveRoot(): string {
    return join(app.getPath("userData"), "goal-attachments");
  }

  async function materializeGoalObjective(objective: string): Promise<string> {
    return materializeGoalObjectiveFile(goalObjectiveRoot(), objective);
  }

  async function readGoalObjective(objective: string): Promise<string> {
    return readGoalObjectiveFile(goalObjectiveRoot(), objective);
  }

  async function cleanupGoalObjective(
    objective: string | undefined,
  ): Promise<void> {
    try {
      await cleanupGoalObjectiveFile(goalObjectiveRoot(), objective);
    } catch (error) {
      console.warn(
        `Managed Goal objective cleanup skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async function steerGoalObjectiveUpdate(goal: ThreadGoal): Promise<void> {
    if (!services.agentProcess || !services.store) return;
    if (goal.status !== "active") return;
    const thread = services.store.getThread(goal.threadId);
    if (!thread) return;
    if (activeTurns.has(goal.threadId) && openedThreads.has(goal.threadId)) {
      const objective = await readGoalObjective(goal.objective);
      await services.agentProcess.request({
        type: "turn.steer",
        requestId: randomUUID(),
        threadId: goal.threadId,
        text: `The persistent Goal objective was edited by the user. Pursue the updated objective now:\n\n${objective}`,
      });
      return;
    }
    scheduleGoalContinuation(goal.threadId, goal.goalId);
  }

  function accountGoalPayload(
    turnId: string | undefined,
    payload: AgentPayload,
  ): void {
    if (!services.store || !turnId) return;
    if (payload.type === "turn.completed" || payload.type === "turn.failed") {
      goalCreationAuthorizations.delete(turnId);
      for (const key of goalBlockerRecordedTurns) {
        if (key.startsWith(`${turnId}\0`)) goalBlockerRecordedTurns.delete(key);
      }
    }
    const context = goalTurnContexts.get(turnId);
    if (!context) return;
    const current = services.store.getThreadGoal(context.threadId);
    if (!current || current.goalId !== context.goalId) {
      goalTurnContexts.delete(turnId);
      return;
    }
    if (payload.type === "assistant.usage") {
      const updated = services.store.updateThreadGoalAccounting(
        context.threadId,
        context.goalId,
        payload.totalTokens,
        0,
      );
      if (updated) emitGoalUpdated(updated, turnId);
      return;
    }
    if (payload.type !== "turn.completed" && payload.type !== "turn.failed") {
      return;
    }
    goalTurnContexts.delete(turnId);
    let goal = services.store.updateThreadGoalAccounting(
      context.threadId,
      context.goalId,
      0,
      0,
    );
    if (!goal) return;
    let continuationDelayMs = 0;
    if (goal.status === "active" && payload.type === "turn.failed") {
      const result = applyGoalContinuationFailure(
        context.threadId,
        context.goalId,
        payload,
      );
      if (result) {
        goal = result.goal;
        continuationDelayMs = result.continuationDelayMs;
      }
    } else if (
      goal.status === "active" &&
      payload.type === "turn.completed" &&
      payload.reason === "cancelled"
    ) {
      goal = services.store.pauseThreadGoal(context.threadId);
    }
    emitGoalUpdated(goal, turnId);
    if (goal.status === "active") {
      scheduleGoalContinuation(
        context.threadId,
        context.goalId,
        continuationDelayMs,
      );
    }
  }

  function emitGoalUpdated(goal: ThreadGoal, turnId?: string): void {
    emitPayload(goal.threadId, turnId, {
      type: "thread.goal.updated",
      goal,
    });
  }

  function emitGoalCleared(
    threadId: string,
    cleared: { goalId: string; revision: number },
    turnId?: string,
  ): void {
    emitPayload(threadId, turnId, {
      type: "thread.goal.cleared",
      goalId: cleared.goalId,
      revision: cleared.revision,
    });
  }

  function resolveGoalBrokerRequest(
    workerRequestId: string,
    request: GoalBrokerRequest,
    data: unknown,
  ): void {
    services.agentProcess?.post({
      type: "broker.resolve",
      requestId: workerRequestId,
      resolution: {
        approvalId: request.approvalId,
        nonce: randomUUID(),
        approved: true,
        scope: "once",
        source: "policy",
      },
      result: data,
    });
  }

  async function handleGoalBrokerRequest(
    workerRequestId: string,
    request: GoalBrokerRequest,
  ): Promise<void> {
    if (!services.agentProcess || !services.store) return;
    const thread = services.store.getThread(request.threadId);
    if (
      !thread ||
      activeTurns.get(request.threadId) !== request.turnId ||
      thread.mode !== request.mode
    ) {
      rejectBrokerRequest(
        workerRequestId,
        request,
        "Goal tools require the active task turn.",
      );
      return;
    }
    if (request.kind === "goal.get") {
      const goal = services.store.getThreadGoal(request.threadId);
      resolveGoalBrokerRequest(workerRequestId, request, {
        goal: goal
          ? { ...goal, objective: await readGoalObjective(goal.objective) }
          : null,
        remainingTokens:
          goal?.tokenBudget === undefined
            ? null
            : Math.max(0, goal.tokenBudget - goal.tokensUsed),
      });
      return;
    }
    if (!isExecutionMode(request.mode)) {
      rejectBrokerRequest(
        workerRequestId,
        request,
        "Goal mutations require Work or Codemode mode.",
      );
      return;
    }
    try {
      if (request.kind === "goal.create") {
        if (!goalCreationAuthorizations.has(request.turnId)) {
          throw new Error(
            "A Goal can be created only when the user or system explicitly requested it.",
          );
        }
        const persistedObjective = await materializeGoalObjective(
          request.objective,
        );
        let goal: ThreadGoal;
        try {
          goal = services.store.setThreadGoal(
            request.threadId,
            persistedObjective,
            request.tokenBudget,
          );
        } catch (error) {
          await cleanupGoalObjective(persistedObjective);
          throw error;
        }
        goalTurnContexts.set(request.turnId, {
          threadId: request.threadId,
          goalId: goal.goalId,
          mode: request.mode,
          source: "user",
        });
        emitGoalUpdated(goal, request.turnId);
        resolveGoalBrokerRequest(workerRequestId, request, { goal });
        return;
      }
      const goal = services.store.getThreadGoal(request.threadId);
      if (!goal) throw new Error("This task has no active Goal.");
      if (request.status === "complete") {
        const completed = services.store.completeThreadGoal(
          request.threadId,
          goal.goalId,
        );
        emitGoalUpdated(completed, request.turnId);
        resolveGoalBrokerRequest(workerRequestId, request, { goal: completed });
        return;
      }
      const blocker = request.blocker?.trim().replace(/\s+/gu, " ");
      if (!blocker) throw new Error("A blocked Goal requires a blocker.");
      const blockerTurnKey = `${request.turnId}\0${goal.goalId}`;
      if (goalBlockerRecordedTurns.has(blockerTurnKey)) {
        throw new Error(
          "A blocker can be counted only once in each Goal turn.",
        );
      }
      goalBlockerRecordedTurns.add(blockerTurnKey);
      const recorded = services.store.recordThreadGoalBlocker(
        request.threadId,
        goal.goalId,
        blocker.toLocaleLowerCase(),
      );
      emitGoalUpdated(recorded.goal, request.turnId);
      if (recorded.attempts < 3) {
        throw new Error(
          `The blocker was recorded for ${recorded.attempts}/3 consecutive Goal turns. Continue if meaningful progress is still possible.`,
        );
      }
      resolveGoalBrokerRequest(workerRequestId, request, {
        goal: recorded.goal,
      });
    } catch (error) {
      rejectBrokerRequest(
        workerRequestId,
        request,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async function cancelRunningGoalContinuation(
    threadId: string,
  ): Promise<void> {
    const turnId = activeTurns.get(threadId);
    const context = turnId ? goalTurnContexts.get(turnId) : undefined;
    if (context?.source === "goal-continuation") {
      await cancelTaskTurn(threadId);
    }
  }
  return {
    applyGoalContinuationFailure,
    scheduleGoalContinuation,
    goalObjectiveRoot,
    materializeGoalObjective,
    readGoalObjective,
    cleanupGoalObjective,
    steerGoalObjectiveUpdate,
    accountGoalPayload,
    emitGoalUpdated,
    emitGoalCleared,
    resolveGoalBrokerRequest,
    handleGoalBrokerRequest,
    cancelRunningGoalContinuation,
  };
}

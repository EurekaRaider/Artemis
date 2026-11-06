import { randomUUID } from "node:crypto";
import { type StartTurnInput, type StartTurnResult } from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "preparingUpdate"
  | "shuttingDown"
  | "cleaningWorktreeThreads"
  | "startingTurns"
  | "imService"
  | "startTaskTurnUnchecked"
  | "computerUseHost"
  | "activeMcpCalls"
  | "activeTurns"
  | "agentProcess"
  | "store"
  | "parseThreadCommand"
  | "pendingApprovals"
  | "cancellingTurns"
  | "attachmentReads"
  | "hooksService"
  | "emitPayload"
  | "pendingUserInputs"
  | "pendingMultiUserInputs"
  | "activeTurnDispatches"
>;
export function createTurnControl(services: Dependencies) {
  const {
    cleaningWorktreeThreads,
    startingTurns,
    startTaskTurnUnchecked,
    activeMcpCalls,
    activeTurns,
    parseThreadCommand,
    pendingApprovals,
    cancellingTurns,
    attachmentReads,
    emitPayload,
    pendingUserInputs,
    pendingMultiUserInputs,
    activeTurnDispatches,
  } = services;
  async function startTaskTurn(
    input: StartTurnInput,
    options: Parameters<typeof startTaskTurnUnchecked>[1] = {},
  ): Promise<StartTurnResult> {
    if (services.preparingUpdate || services.shuttingDown)
      throw new Error("Application is preparing to exit; retry after restart.");
    if (cleaningWorktreeThreads.has(input.threadId)) {
      throw new Error(
        "Worktree cleanup is in progress. Retry after it finishes.",
      );
    }
    if (startingTurns.has(input.threadId))
      throw new Error("Task is already starting a turn.");
    const release = services.imService?.reserveStart(
      input.threadId,
      input.mode,
      options.origin === "desktop" ? false : undefined,
    );
    startingTurns.add(input.threadId);
    try {
      return await startTaskTurnUnchecked(input, options);
    } finally {
      startingTurns.delete(input.threadId);
      release?.();
    }
  }

  async function cancelTaskTurn(threadId: string): Promise<void> {
    services.computerUseHost?.endTurn(threadId);
    for (const call of activeMcpCalls.values())
      if (call.threadId === threadId) call.controller.abort();
    services.imService?.cancelOperations(threadId);
    const results = await Promise.allSettled([
      ...(activeTurns.has(threadId) ? [cancelLocalTaskTurn(threadId)] : []),
      services.imService?.cancelThreadDelegations(threadId),
    ]);
    const failed = results.find((r) => r.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }

  async function cancelLocalTaskTurn(threadId: string): Promise<void> {
    services.computerUseHost?.endTurn(threadId);
    for (const call of activeMcpCalls.values())
      if (call.threadId === threadId) call.controller.abort();
    services.imService?.cancelOperations(threadId);
    if (!services.agentProcess || !services.store) {
      throw new Error("Application is not ready.");
    }
    const command = parseThreadCommand({ type: "turn.cancel", threadId });
    const thread = services.store.getThread(command.threadId);
    const turnId = activeTurns.get(command.threadId);
    if (
      !thread ||
      (thread.status !== "running" && thread.status !== "waiting-approval") ||
      !turnId
    ) {
      throw new Error("Task has no active turn.");
    }
    const cancelledApprovals = pendingApprovals.cancelWhere(
      (pending) => pending.request.threadId === thread.id,
    );
    cancellingTurns.add(thread.id);
    for (const controller of attachmentReads.get(thread.id) ?? [])
      controller.abort();
    services.hooksService?.cancelThread(thread.id);
    // Persist the user's Stop before awaiting the worker, including during restart.
    services.store.clearTurnCheckpoint(thread.id, turnId);
    for (const cancelled of cancelledApprovals) {
      emitPayload(
        cancelled.value.request.threadId,
        cancelled.value.request.turnId,
        {
          type: "approval.resolved",
          approvalId: cancelled.approvalId,
          nonce: cancelled.nonce,
          approved: false,
          scope: "once",
        },
      );
      services.agentProcess.post({
        type: "broker.resolve",
        requestId: cancelled.value.workerRequestId,
        resolution: {
          approvalId: cancelled.approvalId,
          nonce: cancelled.nonce,
          approved: false,
          scope: "once",
        },
        error: "The turn was cancelled.",
      });
    }
    const cancelledUserInputs = pendingUserInputs.cancelWhere(
      (pending) => pending.request.threadId === thread.id,
    );
    for (const cancelled of cancelledUserInputs) {
      if (cancelled.value.timeout !== undefined) {
        clearTimeout(cancelled.value.timeout);
      }
      emitPayload(
        cancelled.value.request.threadId,
        cancelled.value.request.turnId,
        {
          type: "user-input.resolved",
          requestId: cancelled.requestId,
          nonce: cancelled.nonce,
          answer: "",
          source: "cancelled",
        },
      );
      services.agentProcess.post({
        type: "broker.resolve",
        requestId: cancelled.value.workerRequestId,
        resolution: {
          approvalId: cancelled.requestId,
          nonce: cancelled.nonce,
          approved: false,
          scope: "once",
          source: "user",
        },
        error: "The turn was cancelled.",
      });
    }
    const cancelledMultiUserInputs = pendingMultiUserInputs.cancelWhere(
      (pending) => pending.request.threadId === thread.id,
    );
    for (const cancelled of cancelledMultiUserInputs) {
      for (const timeout of cancelled.value.timeouts.values()) {
        clearTimeout(timeout);
      }
      // Kind-less cancelled resolution: the reducer's translation layer closes
      // every still-pending question; the agent-host must not hang waiting.
      emitPayload(
        cancelled.value.request.threadId,
        cancelled.value.request.turnId,
        {
          type: "user-input.resolved",
          requestId: cancelled.requestId,
          nonce: cancelled.nonce,
          answer: "",
          source: "cancelled",
        },
      );
      services.agentProcess.post({
        type: "broker.resolve",
        requestId: cancelled.value.workerRequestId,
        resolution: {
          approvalId: cancelled.requestId,
          nonce: cancelled.nonce,
          approved: false,
          scope: "once",
          source: "user",
        },
        error: "The turn was cancelled.",
      });
    }
    try {
      if (activeTurnDispatches.has(thread.id)) {
        await services.agentProcess.request({
          type: "turn.cancel",
          requestId: randomUUID(),
          threadId: command.threadId,
        });
      }
    } finally {
      cancellingTurns.delete(command.threadId);
    }
    activeTurns.delete(command.threadId);
    emitPayload(command.threadId, turnId, {
      type: "turn.completed",
      reason: "cancelled",
    });
  }
  return { startTaskTurn, cancelTaskTurn, cancelLocalTaskTurn };
}

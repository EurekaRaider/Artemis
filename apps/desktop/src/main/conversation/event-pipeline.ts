import { isExecutionMode } from "@artemis/protocol";
import { isAttachmentReference, attachmentIsImage } from "@artemis/protocol";
import { type TurnCheckpoint } from "../conversation/turn-recovery.js";
import { randomUUID } from "node:crypto";
import type {
  AgentEvent,
  AgentHostEvent,
  AgentPayload,
  PromptAttachment,
  PromptImage,
} from "@artemis/protocol";
import { canTransitionInvocation } from "@artemis/protocol";
import { type PlanAcceptance } from "@artemis/protocol";
import { partitionAgentHostEvents } from "../agent/agent-event-routing.js";
import { AppStore } from "../settings/store.js";
import { IPC, type StartTurnInput } from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "store"
  | "computerUseHost"
  | "publishAutomationRun"
  | "pendingApprovals"
  | "pendingUserInputs"
  | "pendingMultiUserInputs"
  | "panelSendEntry"
  | "automationDeleted"
  | "activeMcpCalls"
  | "activeTurns"
  | "withPersistedTurnDuration"
  | "observeTurnPayload"
  | "imService"
  | "mainWindow"
  | "accountGoalPayload"
  | "observeTaskNotification"
  | "taskNotifications"
  | "turnChangeSetService"
  | "turnChangeSetCompletionTails"
  | "diagnosticBundleService"
  | "recoverableTurnQueues"
  | "taskSourceImages"
>;
export function createEventPipeline(services: Dependencies) {
  const {
    publishAutomationRun,
    pendingApprovals,
    pendingUserInputs,
    pendingMultiUserInputs,
    automationDeleted,
    activeMcpCalls,
    activeTurns,
    withPersistedTurnDuration,
    observeTurnPayload,
    accountGoalPayload,
    observeTaskNotification,
    turnChangeSetCompletionTails,
    recoverableTurnQueues,
    taskSourceImages,
  } = services;
  function applyPayloadSideEffects(
    threadId: string,
    payload: AgentPayload,
    threadAlreadyUpdated = false,
    turnId?: string,
  ): void {
    if (!services.store) throw new Error("Application store is not ready.");
    switch (payload.type) {
      case "turn.started":
        if (!isExecutionMode(payload.mode))
          services.computerUseHost?.clearTask(
            threadId,
            "Task left Work or Codemode mode",
          );
        if (!threadAlreadyUpdated) {
          services.store.updateThread(threadId, {
            mode: payload.mode,
            status: "running",
          });
        }
        publishAutomationRun(
          services.store.updateAutomationRunForThread(threadId, "running"),
        );
        break;
      case "approval.requested":
      case "user-input.requested":
        services.store.updateThread(threadId, { status: "waiting-approval" });
        publishAutomationRun(
          services.store.updateAutomationRunForThread(
            threadId,
            "waiting-approval",
          ),
        );
        break;
      case "approval.resolved":
      case "user-input.resolved": {
        const stillWaiting =
          pendingApprovals.hasWhere(
            (pending) => pending.request.threadId === threadId,
          ) ||
          pendingUserInputs.hasWhere(
            (pending) => pending.request.threadId === threadId,
          ) ||
          pendingMultiUserInputs.hasWhere(
            (pending) => pending.request.threadId === threadId,
          );
        services.store.updateThread(threadId, {
          status: stillWaiting ? "waiting-approval" : "running",
        });
        publishAutomationRun(
          services.store.updateAutomationRunForThread(
            threadId,
            stillWaiting ? "waiting-approval" : "running",
          ),
        );
        break;
      }
      case "turn.completed":
        services.store.updateThread(threadId, { status: "idle" });
        // P2-10：只结算绑定到该 turn 的提交；其他 turn 或未发送的草稿不动。
        services.panelSendEntry?.reconcileTurnOutcome(
          threadId,
          payload.reason === "cancelled" ? "cancelled" : "completed",
          turnId,
        );
        {
          const completion =
            services.store.completeAutomationRunForThread(threadId);
          publishAutomationRun(completion?.run);
          if (completion?.deletedAutomationId) {
            automationDeleted(completion.deletedAutomationId);
          }
        }
        services.computerUseHost?.endTurn(threadId);
        for (const call of activeMcpCalls.values())
          if (call.threadId === threadId) call.controller.abort();
        activeTurns.delete(threadId);
        break;
      case "custom-agent.route":
        // Routing audits (D#152 PR5) are durable event-log records only;
        // projectId enrichment happened before append, and there is no
        // thread-status side effect.
        break;
      case "child-agent.status": {
        // Bind custom-agent invocation records to their materialized
        // instance and close them out on terminal status (D#152 section 6).
        // Event replay can re-deliver terminal states, so transitions are
        // gated on the contract state machine instead of assumed legal.
        const customAgent = payload.customAgent;
        if (!customAgent?.invocationId) break;
        const invocationRecord = services.store.getCustomAgentInvocation(
          threadId,
          customAgent.invocationId,
        );
        if (!invocationRecord) break;
        services.store.bindCustomAgentInvocationInstance(
          threadId,
          customAgent.invocationId,
          payload.agentId,
        );
        const terminalInvocationStatus =
          payload.status === "completed" || payload.status === "failed"
            ? "finished"
            : payload.status === "cancelled"
              ? "cancelled"
              : undefined;
        if (
          terminalInvocationStatus &&
          canTransitionInvocation(
            invocationRecord.status,
            terminalInvocationStatus,
          )
        ) {
          services.store.transitionCustomAgentInvocation(
            threadId,
            customAgent.invocationId,
            terminalInvocationStatus,
            { instanceId: payload.agentId },
          );
        }
        break;
      }
      case "turn.failed":
        services.store.updateThread(threadId, { status: "failed" });
        services.panelSendEntry?.reconcileTurnOutcome(
          threadId,
          "failed",
          turnId,
        );
        publishAutomationRun(
          services.store.updateAutomationRunForThread(
            threadId,
            "failed",
            payload.message,
          ),
        );
        // A coded CUSTOM_AGENT_/INVOCATION_ failure means the explicit
        // dispatch was rejected before any instance could start; cancel the
        // committed record instead of leaving it ambiguous (D#152). The
        // failing turn is the thread's active turn at this point.
        {
          const failedTurnId = activeTurns.get(threadId);
          if (/^(?:CUSTOM_AGENT|INVOCATION)_/.test(payload.message)) {
            for (const record of services.store.listCustomAgentInvocationsForThread(
              threadId,
            )) {
              if (
                record.turnId === failedTurnId &&
                record.status === "dispatch-committed" &&
                !record.instanceId
              ) {
                services.store.transitionCustomAgentInvocation(
                  threadId,
                  record.invocationId,
                  "cancelled",
                );
              }
            }
          }
        }
        services.computerUseHost?.endTurn(threadId);
        for (const call of activeMcpCalls.values())
          if (call.threadId === threadId) call.controller.abort();
        activeTurns.delete(threadId);
        break;
    }
  }

  function enrichCustomAgentRoutePayload(
    threadId: string,
    payload: AgentPayload,
  ): AgentPayload {
    if (payload.type !== "custom-agent.route" || payload.projectId !== null) {
      return payload;
    }
    return {
      ...payload,
      projectId: services.store?.getThread(threadId)?.projectId ?? null,
    };
  }

  function emitPayload(
    threadId: string,
    turnId: string | undefined,
    payload: AgentPayload,
    // Optional stamp override used by the multi-question expiry clamp: the
    // emitted timestamp is pinned onto the question's frozen deadline so the
    // reducer's time gates always agree with the main-process gate (review
    // item 1, scenarios A and B).
    timestamp?: string,
  ): AgentEvent {
    if (!services.store) {
      throw new Error("Application store is not ready.");
    }
    const preparedPayload = enrichCustomAgentRoutePayload(
      threadId,
      withPersistedTurnDuration(
        turnId,
        prepareRecoverableQueuePayload(threadId, payload, turnId),
      ),
    );
    observeTurnPayload(turnId, preparedPayload);
    const event = services.store.appendEvent(
      randomUUID(),
      threadId,
      turnId,
      preparedPayload,
      timestamp,
    );
    services.imService?.observe([event]);
    services.mainWindow?.webContents.send(IPC.agentEvent, event);
    applyPayloadSideEffects(threadId, preparedPayload);
    accountGoalPayload(turnId, preparedPayload);
    scheduleTurnChangeSetCompletion(threadId, turnId, preparedPayload);
    observeTaskNotification(event);
    return event;
  }

  function emitPayloadBatch(events: readonly AgentHostEvent[]): AgentEvent[] {
    if (!services.store || events.length === 0) return [];
    const preparedEvents = events
      .filter((event) => !event.payload.type.startsWith("plan."))
      .map((event) => ({
        ...event,
        payload: enrichCustomAgentRoutePayload(
          event.threadId,
          withPersistedTurnDuration(
            event.turnId,
            prepareRecoverableQueuePayload(
              event.threadId,
              event.payload,
              event.turnId,
            ),
          ),
        ),
      }));
    const { durable: durableEvents, liveActivities } =
      partitionAgentHostEvents(preparedEvents);
    if (liveActivities.length > 0) {
      services.mainWindow?.webContents.send(
        IPC.agentActivities,
        liveActivities,
      );
    }
    if (durableEvents.length === 0) return [];
    const threadId = durableEvents[0]!.threadId;
    if (durableEvents.some((event) => event.threadId !== threadId)) {
      return durableEvents.map((event) =>
        emitPayload(event.threadId, event.turnId, event.payload),
      );
    }
    for (const event of durableEvents) {
      observeTurnPayload(event.turnId, event.payload);
    }
    const persisted = services.store.appendEvents(
      threadId,
      durableEvents.map((event) => ({
        eventId: randomUUID(),
        ...(event.turnId ? { turnId: event.turnId } : {}),
        payload: event.payload,
      })),
    );
    services.imService?.observe(persisted);
    services.mainWindow?.webContents.send(IPC.agentEvents, persisted);
    for (const event of durableEvents) {
      applyPayloadSideEffects(threadId, event.payload, false, event.turnId);
      accountGoalPayload(event.turnId, event.payload);
      scheduleTurnChangeSetCompletion(threadId, event.turnId, event.payload);
    }
    const notificationUpdates = persisted.flatMap((event) => {
      const update = observeTaskNotification(event, true);
      return update ? [update] : [];
    });
    if (notificationUpdates.length > 0) {
      services.taskNotifications?.refresh();
      for (const update of notificationUpdates) {
        if (update.notice) services.taskNotifications?.show(update.notice);
      }
    }
    return persisted;
  }

  function scheduleTurnChangeSetCompletion(
    threadId: string,
    turnId: string | undefined,
    payload: AgentPayload,
  ): void {
    if (
      !turnId ||
      !services.turnChangeSetService ||
      (payload.type !== "turn.completed" && payload.type !== "turn.failed") ||
      turnChangeSetCompletionTails.has(threadId)
    ) {
      return;
    }
    const completion = (async () => {
      try {
        const changeSet = await services.turnChangeSetService!.complete(
          threadId,
          turnId,
          payload.backgroundProcessesRunning === true,
        );
        if (changeSet) emitPayload(threadId, turnId, changeSet);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await services.turnChangeSetService?.discard(turnId);
        services.diagnosticBundleService?.record({
          source: "main",
          severity: "warning",
          message: `Turn change-set capture failed for ${turnId}: ${message}`,
        });
        emitPayload(threadId, turnId, {
          type: "turn.change-set.updated",
          status: "unavailable",
          files: [],
          additions: 0,
          deletions: 0,
          undoAvailable: false,
          message,
        });
      }
    })();
    turnChangeSetCompletionTails.set(threadId, completion);
    void completion.finally(() => {
      if (turnChangeSetCompletionTails.get(threadId) === completion) {
        turnChangeSetCompletionTails.delete(threadId);
      }
    });
  }

  function prepareRecoverableQueuePayload(
    threadId: string,
    payload: AgentPayload,
    turnId?: string,
  ): AgentPayload {
    if (turnId === `compaction-queue:${threadId}`) return payload;
    if (payload.type === "user.message") {
      return {
        ...payload,
        text: recoverableTurnQueues.displayText(threadId, payload.text),
      };
    }
    if (payload.type === "queue.updated") {
      const queue = recoverableTurnQueues.reconcile(
        threadId,
        payload.steering,
        payload.followUp,
      );
      return { ...payload, ...queue };
    }
    if (payload.type === "queue.recovered") {
      if (turnId)
        services.panelSendEntry?.recoverInterruptedSubmissions(
          threadId,
          turnId,
        );
      if (payload.items) {
        recoverableTurnQueues.discard(threadId);
        return payload;
      }
      const items = recoverableTurnQueues.recover(threadId, payload.messages);
      return { ...payload, items };
    }
    if (payload.type === "turn.completed" || payload.type === "turn.failed") {
      recoverableTurnQueues.discard(threadId);
    }
    return payload;
  }

  async function emitInitialTurn(
    threadId: string,
    turnId: string,
    text: string,
    mode: StartTurnInput["mode"],
    attachments: PromptAttachment[],
    visibleUserMessage = true,
    checkpoint?: TurnCheckpoint,
    acceptance?: PlanAcceptance,
  ): Promise<AgentEvent[]> {
    if (!services.store) throw new Error("Application store is not ready.");
    const attachmentPayloads = attachments.map((attachment) => ({
      type: "task.source.added" as const,
      sourceId: randomUUID(),
      name: attachment.name,
      mimeType: attachment.mimeType,
      kind: attachmentIsImage(attachment)
        ? ("image" as const)
        : ("file" as const),
      attachment,
    }));
    const savedImages = attachmentPayloads.filter(
      (
        source,
      ): source is typeof source & {
        kind: "image";
        attachment: PromptImage;
      } => source.kind === "image" && !("type" in source.attachment),
    );
    try {
      if (savedImages.length)
        await Promise.all(
          savedImages.map((source) =>
            taskSourceImages().save(
              threadId,
              source.sourceId,
              source.attachment,
            ),
          ),
        );
    } catch (error) {
      await Promise.allSettled(
        savedImages.map((source) =>
          taskSourceImages().delete(threadId, source.sourceId),
        ),
      );
      throw error;
    }
    const payloads: AgentPayload[] = [
      ...(visibleUserMessage
        ? [{ type: "user.message" as const, messageId: randomUUID(), text }]
        : []),
      ...attachmentPayloads.map(({ attachment, ...payload }): AgentPayload => ({
        ...payload,
        ...(isAttachmentReference(attachment) ? { attachment } : {}),
      })),
      { type: "turn.started", mode },
    ];
    for (const payload of payloads) observeTurnPayload(turnId, payload);
    let result: ReturnType<AppStore["appendEventsAndUpdateThread"]>;
    try {
      result = services.store.appendEventsAndUpdateThread(
        threadId,
        payloads.map((payload) => ({
          eventId: randomUUID(),
          turnId,
          payload,
        })),
        { mode, status: "running" },
        checkpoint,
        acceptance,
      );
    } catch (error) {
      await Promise.allSettled(
        savedImages.map((source) =>
          taskSourceImages().delete(threadId, source.sourceId),
        ),
      );
      throw error;
    }
    services.mainWindow?.webContents.send(IPC.agentEvents, result.events);
    for (const payload of payloads) {
      applyPayloadSideEffects(
        threadId,
        payload,
        payload.type === "turn.started",
        turnId,
      );
    }
    return result.events;
  }
  return {
    applyPayloadSideEffects,
    enrichCustomAgentRoutePayload,
    emitPayload,
    emitPayloadBatch,
    scheduleTurnChangeSetCompletion,
    prepareRecoverableQueuePayload,
    emitInitialTurn,
  };
}

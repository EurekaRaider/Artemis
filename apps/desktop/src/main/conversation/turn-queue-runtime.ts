import { isAttachmentReference, attachmentIsImage } from "@artemis/protocol";
import { randomUUID } from "node:crypto";
import { appendPromptFiles } from "@artemis/agent-host/turn-prompt";
import type { Thread } from "@artemis/protocol";
import {
  type QueueTurnInput,
  type ReplaceQueuedTurnInput,
  type SteerQueuedTurnInput,
} from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "compactionFollowUps"
  | "emitPayload"
  | "startTaskTurn"
  | "activeTurns"
  | "store"
  | "agentProcess"
  | "parseThreadCommand"
  | "panelSendEntry"
  | "compactingThreads"
  | "attachmentScope"
  | "attachmentStore"
  | "openedThreads"
  | "recoverableTurnQueues"
>;
export function createTurnQueueRuntime(services: Dependencies) {
  const {
    compactionFollowUps,
    emitPayload,
    startTaskTurn,
    activeTurns,
    parseThreadCommand,
    compactingThreads,
    attachmentScope,
    attachmentStore,
    openedThreads,
    recoverableTurnQueues,
  } = services;
  function publishCompactionQueue(threadId: string): void {
    emitPayload(threadId, `compaction-queue:${threadId}`, {
      type: "queue.updated",
      ...compactionFollowUps.snapshot(threadId),
    });
  }

  async function resumeCompactionFollowUps(thread: Thread): Promise<void> {
    let pending = compactionFollowUps.takeForDispatch(thread.id);
    while (pending.length > 0) {
      const { displayText, ...item } = pending[0]!;
      try {
        if (activeTurns.has(thread.id)) {
          await queueTurn(
            "turn.follow-up",
            { threadId: thread.id, ...item },
            true,
            displayText,
          );
        } else {
          await startTaskTurn(
            { threadId: thread.id, mode: thread.mode, ...item },
            {
              origin: "desktop",
              afterCompaction: true,
              displayText,
            },
          );
        }
        pending.shift();
      } catch (error) {
        const items = [
          ...pending.map(({ displayText, ...item }) => ({
            ...item,
            text: displayText,
          })),
          ...compactionFollowUps.recover(thread.id),
        ];
        emitPayload(thread.id, `compaction-queue:${thread.id}`, {
          type: "queue.recovered",
          messages: items.map((item) => item.text),
          items,
        });
        throw error;
      }
      if (pending.length === 0)
        pending = compactionFollowUps.takeForDispatch(thread.id);
    }
  }

  async function queueTurn(
    type: "turn.steer" | "turn.follow-up",
    input: QueueTurnInput,
    afterCompaction = false,
    displayText?: string,
  ): Promise<void> {
    if (!services.store || !services.agentProcess) {
      throw new Error("Agent process is not ready.");
    }
    const command = parseThreadCommand({ type, ...input });
    const thread = services.store.getThread(command.threadId);
    if (input.designPanelCredential) {
      if (!thread || !services.panelSendEntry)
        throw new Error("Send entry unavailable.");
      services.panelSendEntry.validateForThread(
        input.designPanelCredential,
        thread.id,
        thread.typeBinding?.bindingRevision ?? "unbound-preview",
      );
      if (compactingThreads.has(thread.id))
        throw new Error(
          "Wait for context compaction before sending the design candidate.",
        );
    }
    if (thread && command.attachments?.length)
      command.attachments = await attachmentStore().bind(
        attachmentScope(thread.id),
        command.attachments,
      );
    if (thread && compactingThreads.has(thread.id) && !afterCompaction) {
      if (type !== "turn.follow-up")
        throw new Error(
          "Wait for context compaction before steering this task.",
        );
      compactionFollowUps.add(
        thread.id,
        "followUp",
        displayText ?? command.text,
        command.attachments,
        command.text,
      );
      publishCompactionQueue(thread.id);
      return;
    }
    if (
      !thread ||
      (thread.status !== "running" && thread.status !== "waiting-approval")
    ) {
      throw new Error("Task has no active turn.");
    }
    const turnId = activeTurns.get(thread.id);
    if (!turnId || !openedThreads.has(thread.id)) {
      throw new Error("Active Pi turn is not available.");
    }

    const recoverableId = recoverableTurnQueues.add(
      thread.id,
      type === "turn.steer" ? "steering" : "followUp",
      displayText ?? command.text,
      command.attachments,
      appendPromptFiles(command.text, command.attachments),
    );
    let panelSubmissionId: string | undefined;
    try {
      if (input.designPanelCredential) {
        panelSubmissionId = services.panelSendEntry!.consumeForTurn(
          input.designPanelCredential,
          thread.id,
          services.store.getThread(thread.id)?.typeBinding?.bindingRevision ??
            "unbound-preview",
          turnId,
        ).submissionId;
      }
      await services.agentProcess.request({
        type,
        requestId: randomUUID(),
        threadId: thread.id,
        text: command.text,
        ...(command.attachments?.length
          ? { attachments: command.attachments }
          : {}),
      });
    } catch (error) {
      recoverableTurnQueues.remove(thread.id, recoverableId);
      if (panelSubmissionId)
        services.panelSendEntry?.markOutcome(panelSubmissionId, "failed");
      throw error;
    }
    for (const attachment of command.attachments ?? []) {
      emitPayload(thread.id, turnId, {
        type: "task.source.added",
        sourceId: randomUUID(),
        name: attachment.name,
        mimeType: attachment.mimeType,
        kind: attachmentIsImage(attachment) ? "image" : "file",
        ...(isAttachmentReference(attachment) ? { attachment } : {}),
      });
    }
  }

  async function controlTurnQueue(
    type: "turn.queue.clear" | "turn.queue.steer",
    threadId: string,
  ): Promise<{ steering: string[]; followUp: string[] } | undefined> {
    if (!services.store || !services.agentProcess) {
      throw new Error("Agent process is not ready.");
    }
    const command = parseThreadCommand({ type, threadId });
    const thread = services.store.getThread(command.threadId);
    if (thread && compactingThreads.has(thread.id)) {
      if (type !== "turn.queue.clear")
        throw new Error(
          "Wait for context compaction before steering this task.",
        );
      const snapshot = compactionFollowUps.snapshot(thread.id);
      compactionFollowUps.discard(thread.id);
      publishCompactionQueue(thread.id);
      return snapshot;
    }
    if (
      !thread ||
      (thread.status !== "running" && thread.status !== "waiting-approval") ||
      !activeTurns.has(thread.id) ||
      !openedThreads.has(thread.id)
    ) {
      throw new Error("Task has no active turn.");
    }

    const queuedTurnId = activeTurns.get(thread.id);
    const result = await services.agentProcess.request<{
      steering: string[];
      followUp: string[];
    }>({
      type,
      requestId: randomUUID(),
      threadId: thread.id,
    });
    if (type === "turn.queue.clear") {
      services.panelSendEntry?.recoverInterruptedSubmissions(
        thread.id,
        queuedTurnId,
      );
      recoverableTurnQueues.discard(thread.id);
    }
    return result;
  }

  async function replaceTurnQueue(
    input: ReplaceQueuedTurnInput,
  ): Promise<void> {
    if (!services.store || !services.agentProcess) {
      throw new Error("Agent process is not ready.");
    }
    const command = parseThreadCommand({
      type: "turn.queue.replace",
      ...input,
    });
    const thread = services.store.getThread(command.threadId);
    if (thread && compactingThreads.has(thread.id)) {
      compactionFollowUps.replaceFollowUp(
        thread.id,
        command.expectedFollowUp,
        command.followUp,
        (text) => text,
      );
      publishCompactionQueue(thread.id);
      return;
    }
    if (
      !thread ||
      (thread.status !== "running" && thread.status !== "waiting-approval") ||
      !activeTurns.has(thread.id) ||
      !openedThreads.has(thread.id)
    ) {
      throw new Error("Task has no active turn.");
    }

    const queuedTurnId = activeTurns.get(thread.id);
    const rollback = recoverableTurnQueues.replaceFollowUp(
      thread.id,
      command.expectedFollowUp,
      command.followUp,
      appendPromptFiles,
    );
    try {
      await services.agentProcess.request({
        type: "turn.queue.replace",
        requestId: randomUUID(),
        threadId: thread.id,
        expectedFollowUp: rollback.runtimeExpectedFollowUp,
        followUp: rollback.runtimeFollowUp,
      });
      services.panelSendEntry?.recoverInterruptedSubmissions(
        thread.id,
        queuedTurnId,
      );
    } catch (error) {
      recoverableTurnQueues.rollbackFollowUp(rollback);
      throw error;
    }
  }

  async function steerQueuedTurn(input: SteerQueuedTurnInput): Promise<void> {
    if (!services.store || !services.agentProcess) {
      throw new Error("Agent process is not ready.");
    }
    const command = parseThreadCommand({
      type: "turn.queue.steer-item",
      ...input,
    });
    const thread = services.store.getThread(command.threadId);
    if (
      !thread ||
      (thread.status !== "running" && thread.status !== "waiting-approval") ||
      !activeTurns.has(thread.id) ||
      !openedThreads.has(thread.id)
    ) {
      throw new Error("Task has no active turn.");
    }

    await services.agentProcess.request({
      type: "turn.queue.steer-item",
      requestId: randomUUID(),
      threadId: thread.id,
      followUpIndex: command.followUpIndex,
      expectedFollowUp: recoverableTurnQueues.runtimeFollowUpSnapshot(
        thread.id,
        command.expectedFollowUp,
      ),
    });
  }
  return {
    publishCompactionQueue,
    resumeCompactionFollowUps,
    queueTurn,
    controlTurnQueue,
    replaceTurnQueue,
    steerQueuedTurn,
  };
}

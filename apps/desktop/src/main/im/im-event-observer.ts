import type { Binding, PendingAction } from "./im-runtime-types.js";

import { randomUUID } from "node:crypto";

import { imIdentityKey, type AgentEvent } from "@artemis/protocol";

import type { ImCoordinatorDependencies } from "./im-coordinator-dependencies.js";
export function createImEventObserver(
  services: Pick<
    ImCoordinatorDependencies,
    | "closed"
    | "db"
    | "observeEvent"
    | "observeGroupActivity"
    | "get"
    | "hasDelegationWait"
    | "ops"
    | "put"
    | "checkContext"
    | "text"
    | "reply"
    | "list"
    | "remove"
    | "replyApprovalResult"
    | "observeReplyStream"
    | "finalText"
    | "clearReplyStream"
    | "restoreBinding"
  >,
) {
  function observe(events: readonly AgentEvent[]): void {
    if (services.closed) return;
    for (const event of events) {
      services.db.exec("BEGIN IMMEDIATE");
      try {
        services.observeEvent(event);
        services.db.exec("COMMIT");
      } catch (error) {
        services.db.exec("ROLLBACK");
        throw error;
      }
      // Group activity emits another persisted event through observe(). Keep
      // that callback outside the transaction which records the task reply.
      services.observeGroupActivity(event);
    }
  }

  function observeGroupActivity(event: AgentEvent): void {
    const binding = services.get<Binding>("bindings", event.threadId);
    if (
      binding?.renewedAfterSequence !== undefined &&
      event.seq <= binding.renewedAfterSequence
    )
      return;
    if (
      binding?.parentThreadId &&
      !services.get("group-observed", event.eventId)
    ) {
      const p = event.payload;
      const phase =
        (p.type === "turn.completed" || p.type === "turn.failed") &&
        services.get(
          "delegation-interrupted-turns",
          JSON.stringify([event.threadId, event.turnId]),
        )
          ? "failed"
          : p.type === "turn.completed" &&
              p.reason === "completed" &&
              !services.hasDelegationWait(event.threadId)
            ? "completed"
            : p.type === "turn.failed"
              ? "failed"
              : p.type === "approval.requested"
                ? "approval-required"
                : p.type === "user-input.requested"
                  ? "input-required"
                  : undefined;
      if (phase) {
        services.ops.groupActivity?.(
          binding.parentThreadId,
          event.threadId,
          phase,
        );
        services.put("group-observed", event.eventId, true);
      }
    }
  }

  function observeEvent(event: AgentEvent): void {
    const binding = services.get<Binding>("bindings", event.threadId);
    if (
      binding?.renewedAfterSequence !== undefined &&
      event.seq <= binding.renewedAfterSequence
    )
      return;
    if (
      binding?.parentThreadId &&
      [
        "tool.started",
        "turn.completed",
        "turn.failed",
        "approval.requested",
        "user-input.requested",
      ].includes(event.payload.type)
    ) {
      services.put("native-timeline", event.eventId, {
        version: 1,
        id: event.eventId,
        parentThreadId: binding.parentThreadId,
        taskId: binding.threadId,
        time: Date.parse(event.timestamp),
        kind: event.payload.type,
        visibility: binding.privateLocal ? "local" : "group",
      });
    }
    if (
      !binding ||
      binding.privateLocal ||
      !services.get("subscriptions", event.threadId)
    )
      return;
    if (services.get("observed", event.eventId)) return;
    services.put("observed", event.eventId, true);
    if (
      services.get(
        "delegation-interrupted-turns",
        JSON.stringify([event.threadId, event.turnId]),
      )
    )
      return;
    try {
      services.checkContext(binding);
    } catch {
      return;
    }
    const payload = event.payload;
    if (
      payload.type === "approval.requested" ||
      payload.type === "user-input.requested"
    ) {
      const action: PendingAction = {
        token: randomUUID(),
        ...(binding.security ? { revision: binding.security.revision } : {}),
        threadId: event.threadId,
        identity: imIdentityKey(binding.request.identity),
        expiresAt: Date.now() + 300000,
        payload,
      };
      services.put("actions", action.token, action);
      const detail =
        payload.type === "approval.requested"
          ? `${payload.summary}\n/approve ${action.token} yes|no`
          : payload.kind === "multi-question"
            ? payload.questions
                .map(
                  (q) =>
                    `${q.questionId}: ${q.question}\n${q.options.map((o) => o.label).join(" / ")}\n/answer ${action.token} ${q.questionId} ${services.text("answerPlaceholder", binding.request)}`,
                )
                .join("\n")
            : `${payload.question}\n${payload.options.map((o) => o.label).join(" / ")}\n/answer ${action.token} ${services.text("answerPlaceholder", binding.request)}`;
      services.reply(
        binding.request,
        `${services.text("task", binding.request, { id: event.threadId })}\n${detail}`,
        event.threadId,
        false,
        "owner",
        event.eventId,
        undefined,
        false,
        undefined,
        payload.type === "approval.requested"
          ? { token: action.token, expiresAt: action.expiresAt }
          : undefined,
      );
      services.reply(
        binding.request,
        `${services.text("task", binding.request, { id: event.threadId })}\n${services.text("ownerConfirmation", binding.request)}`,
        event.threadId,
        false,
        "conversation",
        `${event.eventId}:status`,
        undefined,
        false,
        "waiting",
      );
      return;
    }
    if (
      payload.type === "approval.resolved" ||
      payload.type === "user-input.resolved"
    ) {
      let resolvedAction = false;
      for (const action of services.list<PendingAction>("actions")) {
        const p = action.payload;
        if (action.threadId !== event.threadId) continue;
        if (
          payload.type === "user-input.resolved" &&
          payload.kind === "multi-question" &&
          p.type === "user-input.requested" &&
          p.kind === "multi-question" &&
          p.requestId === payload.requestId
        ) {
          resolvedAction = true;
          p.questions = p.questions.filter(
            (q) => q.questionId !== payload.questionId,
          );
          if (p.questions.length) services.put("actions", action.token, action);
          else services.remove("actions", action.token);
          continue;
        }
        if (
          (payload.type === "approval.resolved" &&
            p.type === "approval.requested" &&
            payload.approvalId === p.approvalId) ||
          (payload.type === "user-input.resolved" &&
            p.type === "user-input.requested" &&
            payload.requestId === p.requestId &&
            payload.kind !== "multi-question")
        ) {
          resolvedAction = true;
          if (payload.type === "approval.resolved")
            services.replyApprovalResult(
              binding,
              action,
              payload.approved,
              event.eventId,
            );
          services.remove("actions", action.token);
        }
      }
      if (
        resolvedAction &&
        !services
          .list<PendingAction>("actions")
          .some((action) => action.threadId === event.threadId)
      )
        services.reply(
          binding.request,
          `${services.text("task", binding.request, { id: event.threadId })}\n${services.text("approvalContinue", binding.request)}`,
          event.threadId,
          false,
          "conversation",
          `${event.eventId}:status`,
          undefined,
          false,
          "running",
        );
      return;
    }
    if (payload.type === "message.part.delta" && payload.partType === "text") {
      services.observeReplyStream(
        binding,
        event.threadId,
        event.turnId ?? "",
        payload.delta ?? "",
      );
      return;
    }
    if (
      payload.type === "tool.started" &&
      Date.now() -
        (services.get<number>("progress-time", event.threadId) ?? 0) >
        30000
    ) {
      const progress = services.finalText(event.threadId, event.turnId);
      if (progress) {
        services.reply(binding.request, progress.slice(-2000), event.threadId);
        services.put("progress-time", event.threadId, Date.now());
      }
    }
    if (payload.type === "turn.completed" || payload.type === "turn.failed") {
      services.clearReplyStream(event.threadId);
      const permission = services.get<{ result: { message: string } }>(
        "permission-blocks",
        event.threadId,
      );
      if (permission) {
        services.reply(
          binding.request,
          permission.result.message,
          event.threadId,
          false,
          "conversation",
          event.eventId,
          undefined,
          false,
          "waiting",
        );
        return;
      }
      const finalText =
        payload.type === "turn.failed"
          ? services.text("taskFailed", binding.request, {
              message: payload.message,
            })
          : payload.reason === "cancelled"
            ? services.text("taskStopped", binding.request)
            : services.finalText(
                event.threadId,
                event.turnId,
                payload.finalPartId,
              ) || services.text("taskComplete", binding.request);
      services.reply(
        binding.request,
        finalText,
        event.threadId,
        !services.hasDelegationWait(event.threadId),
        "conversation",
        event.eventId,
        services.hasDelegationWait(event.threadId)
          ? undefined
          : payload.type === "turn.failed"
            ? "failed"
            : payload.reason === "cancelled"
              ? "cancelled"
              : "completed",
        false,
        services.hasDelegationWait(event.threadId) ? "waiting" : undefined,
      );
      if (
        binding.request.nativeTaskId &&
        !services.hasDelegationWait(event.threadId)
      )
        services.restoreBinding(event.threadId);
    }
  }
  const handlers = { observe, observeGroupActivity, observeEvent };
  return handlers;
}

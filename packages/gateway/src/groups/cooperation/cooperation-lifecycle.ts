import { terminal } from "./cooperation-values.js";
import type { NativeTask } from "./cooperation-types.js";
import { imText } from "../../i18n/im-localization.js";

import type {
  CollaborationSpace,
  ImReply,
  RemoteInvocationContext,
} from "@artemis/protocol";

import type { CooperationDependencies } from "./cooperation-dependencies.js";
export function createCooperationLifecycle(
  services: Pick<
    CooperationDependencies,
    | "store"
    | "task"
    | "now"
    | "saveTask"
    | "router"
    | "respond"
    | "group"
    | "frame"
    | "send"
  >,
) {
  function localTaskDeleted(
    deviceId: string,
    invocationId: string,
    threadId: string,
  ): void {
    const request = services.store.get<RemoteInvocationContext>(
      "invocations",
      invocationId,
    );
    if (!request) return; // The gateway may have already pruned this invocation.
    if (request.deviceId !== deviceId || !request.nativeTaskId)
      throw new Error("Deleted task does not belong to this device.");
    const task = services.task(
      request.conversation.spaceId!,
      request.nativeTaskId,
    );
    if (!task) return;
    if (
      task.direction !== "incoming" ||
      task.invocationId !== invocationId ||
      (task.threadId && task.threadId !== threadId)
    )
      throw new Error("Deleted task does not match the received assignment.");
    if (terminal(task.state)) return;
    services.store.transaction(() => {
      const updated: NativeTask = {
        ...task,
        state: "cancelled",
        result: "Local task was deleted; execution has stopped.",
        updatedAt: services.now(),
      };
      services.saveTask(updated);
      // Local cleanup survives revoked/changed sharing. Never replay old task
      // content to a changed audience just to repair a lifecycle record.
      if (services.router.isInvocationAuthorized(request))
        services.respond(
          services.group(task.groupId),
          updated,
          "cancelled",
          updated.result!,
        );
    });
  }

  function reply(request: RemoteInvocationContext, reply: ImReply): void {
    if (!request.nativeTaskId || reply.visibility === "owner") return;
    const task = services.task(
      request.conversation.spaceId!,
      request.nativeTaskId,
    );
    if (!task || task.direction !== "incoming" || terminal(task.state)) return;
    const group = services.group(task.groupId);
    if (reply.heartbeat) {
      services.respond(
        group,
        task,
        "heartbeat",
        imText(task.envelope.locale, "heartbeat"),
      );
      return;
    }
    const final = reply.final && reply.deliveryState !== "pending";
    const oversized =
      final &&
      (reply.text.length > 8000 || Buffer.byteLength(reply.text) > 12000);
    const rejected =
      final && reply.outcome === "failed" && !task.threadId && !reply.taskId;
    const state = rejected
      ? "rejected"
      : oversized
        ? "failed"
        : final
          ? (reply.outcome ?? "completed")
          : reply.started
            ? "running"
            : task.state;
    const updated = {
      ...task,
      state,
      ...(reply.taskId ? { threadId: reply.taskId } : {}),
      result: oversized
        ? "Result exceeds the IM protocol limit; publish an IM attachment or provide a bounded summary."
        : reply.text,
      updatedAt: services.now(),
    };
    services.saveTask(updated);
    services.respond(
      group,
      updated,
      rejected
        ? "rejected"
        : oversized
          ? "failed"
          : final
            ? (reply.outcome ?? "completed")
            : "progress",
      updated.result,
      request.control === "cancel" && final && reply.outcome === "cancelled",
    );
  }

  function tick(): void {
    for (const task of services.store.list<NativeTask>("native-tasks")) {
      if (terminal(task.state)) continue;
      const request = services.store.get<RemoteInvocationContext>(
        "invocations",
        task.invocationId,
      );
      if (!request || !services.router.isInvocationAuthorized(request)) {
        if (
          request &&
          task.direction === "outgoing" &&
          !["cancel-sent", "blocked"].includes(task.state)
        ) {
          const group = services.store.get<CollaborationSpace>(
            "native-groups",
            task.groupId,
          );
          if (
            group &&
            services.store.get("connections", group.endpoints[0]!.connectionId)
          )
            services.store.transaction(() => {
              const cancel = services.frame(
                group,
                task.peer,
                "cancel",
                "",
                task.id,
                task.workflow,
              );
              if (task.envelope.locale) cancel.locale = task.envelope.locale;
              cancel.expiresAt = services.now() + 300000;
              services.store.put("native-revocation-cancels", cancel.id, {
                groupId: group.id,
                peer: task.peer,
                expiresAt: cancel.expiresAt,
              });
              services.send(group, cancel);
              services.saveTask({
                ...task,
                state: "cancel-sent",
                cancelId: cancel.id,
                result:
                  "Authorization revoked; cancellation requested through IM.",
                updatedAt: services.now(),
              });
            });
        }
        continue;
      }
      if (
        task.direction === "incoming" &&
        task.state === "accepted" &&
        task.envelope.expiresAt <= services.now()
      ) {
        const row = services.store.db
          .prepare("SELECT state FROM queue WHERE bucket='device' AND id=?")
          .get(task.invocationId);
        if (row?.state === "pending" || row?.state === "expired")
          services.store.transaction(() => {
            services.store.mark("device", task.invocationId, "expired");
            services.saveTask({
              ...task,
              state: "failed",
              result: "Assignment expired before execution.",
              updatedAt: services.now(),
            });
            services.respond(
              services.group(task.groupId),
              task,
              "failed",
              "Assignment expired before execution.",
            );
          });
        continue;
      }
      if (
        task.direction === "outgoing" &&
        ["sent", "cancel-sent"].includes(task.state)
      ) {
        const row = services.store.db
          .prepare("SELECT state FROM queue WHERE bucket='outgoing' AND id=?")
          .get(`native:${task.cancelId ?? task.envelope.id}`);
        if (
          task.state === "sent" &&
          task.envelope.expiresAt <= services.now() &&
          row?.state === "pending"
        ) {
          services.store.mark(
            "outgoing",
            `native:${task.envelope.id}`,
            "expired",
          );
          services.saveTask({
            ...task,
            state: "failed",
            result: "Assignment expired before IM delivery.",
            updatedAt: services.now(),
          });
          continue;
        }
        if (
          row?.state === "uncertain" ||
          (task.state === "sent" && task.envelope.expiresAt <= services.now())
        ) {
          services.saveTask({
            ...task,
            state: "uncertain",
            result:
              "Awaiting verification; never automatically replay execution.",
            updatedAt: services.now(),
          });
          continue;
        }
        if (["failed", "revoked"].includes(String(row?.state))) {
          services.saveTask({
            ...task,
            state: "failed",
            result: "IM delivery failed or authorization revoked.",
            updatedAt: services.now(),
          });
          continue;
        }
      }
      if (task.direction === "outgoing" && task.state === "blocked") {
        if (task.envelope.expiresAt <= services.now()) {
          services.saveTask({
            ...task,
            state: "failed",
            result: "Assignment expired before dependencies completed.",
            updatedAt: services.now(),
          });
          continue;
        }

        const dependencies = task.dependencies.map((id) =>
          services.task(task.groupId, id),
        );
        if (
          dependencies.some(
            (t) => t && terminal(t.state) && t.state !== "completed",
          )
        ) {
          services.saveTask({
            ...task,
            state: "failed",
            result: "A prerequisite failed; owner action required.",
            updatedAt: services.now(),
          });
        } else if (
          dependencies.every(
            (t) => t?.state === "completed" && t.result?.trim(),
          )
        ) {
          services.store.transaction(() => {
            const text = `${task.text}\n\nPrerequisite results:\n${dependencies.map((t) => t!.result).join("\n")}`;
            if (text.length > 8000 || Buffer.byteLength(text) > 12000) {
              services.saveTask({
                ...task,
                state: "failed",
                result:
                  "Prerequisite results exceed the IM protocol limit; owner action required.",
                updatedAt: services.now(),
              });
              return;
            }
            const envelope = { ...task.envelope, text };
            services.send(services.group(task.groupId), envelope, request.id);
            services.saveTask({
              ...task,
              envelope,
              state: "sent",
              updatedAt: services.now(),
            });
          });
        }
      }
    }
  }
  const handlers = { localTaskDeleted, reply, tick };
  return handlers;
}

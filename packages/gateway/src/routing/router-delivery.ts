import type { Delivery } from "../runtime/routing-contracts.js";
import { imText } from "../i18n/im-localization.js";

import { splitSlackMarkdown } from "../channels/slack/slack-format.js";

import {
  imConversationKey,
  imIdentityKey,
  imReplySchema,
  type CollaborationSpace,
  type CollaborationTask,
  type ImConversation,
  type ImIdentity,
  type ImReply,
  type RemoteInvocationContext,
} from "@artemis/protocol";

import { splitImText } from "../channels/channels.js";
import type { FeishuTyping } from "../channels/feishu/feishu-typing.js";
import type { FeishuApprovalCard } from "../channels/feishu/feishu-approval.js";
import type { RouterDependencies } from "./router-dependencies.js";
export function createRouterDelivery(
  services: Pick<
    RouterDependencies,
    | "store"
    | "queueDelivery"
    | "isInvocationAuthorized"
    | "native"
    | "broadcast"
    | "assignmentForThread"
    | "deviceLocale"
    | "inheritSecurity"
  >,
) {
  function queueDelivery(id: string, delivery: Delivery): void {
    if (
      services.store.get(
        "retired-groups",
        imConversationKey(delivery.conversation),
      )
    )
      return;
    const invocationId = delivery.invocationId;
    if (invocationId) {
      const request = services.store.get<RemoteInvocationContext>(
        "invocations",
        invocationId,
      );
      if (request?.locale) delivery = { ...delivery, locale: request.locale };
      const security = services.store.get<NonNullable<Delivery["security"]>>(
        "invocation-security",
        invocationId,
      );
      if (security) delivery = { ...delivery, security };
    }
    const entry = services.store.get<{ sealed: string }>(
      "connections",
      delivery.conversation.connectionId,
    );
    const connection = entry
      ? services.store.unseal<{ channel: string }>(entry.sealed)
      : undefined;
    if (delivery.cardKey) {
      services.store.db
        .prepare(
          "UPDATE queue SET state='superseded' WHERE bucket='outgoing' AND state='pending' AND recipient=? AND json_extract(payload,'$.cardKey')=? AND json_extract(payload,'$.conversation.id')=? AND json_extract(payload,'$.conversation.kind')=? AND json_extract(payload,'$.stream')=1 AND id<>?",
        )
        .run(
          delivery.conversation.connectionId,
          delivery.cardKey,
          delivery.conversation.id,
          delivery.conversation.kind,
          `${id}:0`,
        );
    }
    // Stream payloads contain cumulative text for one card, not message chunks.
    const chunks = delivery.stream
      ? [delivery.text.slice(-30000)]
      : connection?.channel === "slack"
        ? splitSlackMarkdown(delivery.text)
        : splitImText(delivery.text);
    chunks.forEach((text, index) =>
      services.store.enqueue(
        "outgoing",
        `${id}:${index}`,
        delivery.conversation.connectionId,
        {
          ...delivery,
          text,
          ...(index > 0
            ? { approval: undefined, mentionUserId: undefined }
            : {}),
        },
      ),
    );
  }

  function broadcast(
    space: CollaborationSpace,
    id: string,
    text: string,
    except?: ImConversation,
    invocationId?: string,
    taskId?: string,
    cardKey?: string,
    replyId?: string,
    mention?: ImIdentity,
  ): void {
    for (const endpoint of space.endpoints) {
      if (except && imConversationKey(except) === imConversationKey(endpoint))
        continue;
      services.queueDelivery(`${id}:${imConversationKey(endpoint)}`, {
        conversation: {
          ...endpoint,
          spaceId: space.id,
          ...(space.revision ? { spaceRevision: space.revision } : {}),
        },
        text,
        ...(mention?.connectionId === endpoint.connectionId &&
        endpoint.kind === "group"
          ? { mentionUserId: mention.userId }
          : {}),
        ...(replyId ? { replyId } : {}),
        ...(invocationId ? { invocationId } : {}),
        ...(taskId ? { taskId } : {}),
        ...(cardKey ? { cardKey } : {}),
      });
    }
  }

  function receiveReply(deviceId: string, input: unknown): void {
    const parsedReply = imReplySchema.parse(input);
    if (
      parsedReply.approval &&
      (parsedReply.visibility !== "owner" || !parsedReply.taskId)
    )
      throw new Error("Approval cards must target the task owner.");
    const reply = { ...parsedReply, id: `${deviceId}:${parsedReply.id}` };
    const request = services.store.get<RemoteInvocationContext>(
      "invocations",
      reply.invocationId,
    );
    if (!request || request.deviceId !== deviceId)
      throw new Error("Reply does not belong to this device.");
    if (!services.isInvocationAuthorized(request)) return;
    if (
      reply.stream &&
      (request.identity.channel !== "feishu" ||
        request.conversation.kind !== "direct" ||
        request.conversation.spaceId ||
        request.nativeTaskId)
    )
      return;
    const replyKey = JSON.stringify([deviceId, reply.id]);
    services.store.transaction(() => {
      if (services.store.get("replies", replyKey)) return;
      services.store.put("replies", replyKey, reply);
      if (request.nativeTaskId) {
        services.native.reply(request, parsedReply);
        return;
      }
      if (reply.approval?.resolved) {
        const key = `${request.identity.connectionId}:${reply.approval.token}`;
        const card = services.store.get<FeishuApprovalCard>(
          "approval-cards",
          key,
        );
        if (card && card.invocationId !== request.id)
          throw new Error(
            "Approval result does not belong to this invocation.",
          );
        services.store.put("approval-results", key, reply.approval);
        if (card)
          services.store.put("approval-cards", key, {
            ...card,
            approval: reply.approval,
            consumed: true,
            closed: false,
          });
      }
      if (
        request.identity.channel === "feishu" &&
        !request.originator &&
        !request.collaboration &&
        reply.taskId &&
        (reply.started || reply.status || reply.final)
      ) {
        const taskKey = `${deviceId}:${reply.taskId}`;
        const key = `${request.identity.connectionId}:${request.messageId}`;
        for (const prior of services.store.list<FeishuTyping>(
          "feishu-typing",
        )) {
          if (
            prior.taskKey === taskKey &&
            prior.messageId !== request.messageId
          )
            services.store.put(
              "feishu-typing",
              `${prior.connectionId}:${prior.messageId}`,
              { ...prior, active: false },
            );
        }
        services.store.put("feishu-typing", key, {
          ...services.store.get<FeishuTyping>("feishu-typing", key),
          connectionId: request.identity.connectionId,
          messageId: request.messageId,
          invocationId: request.id,
          conversation: request.conversation,
          taskKey,
          active:
            !reply.final && (reply.status === "running" || !!reply.started),
          expiresAt: Date.now() + 300000,
        } satisfies FeishuTyping);
      }
      const space = request.conversation.spaceId
        ? services.store.get<CollaborationSpace>(
            "native-groups",
            request.conversation.spaceId,
          )
        : undefined;
      const ownerRoute = services.store.get<ImConversation>(
        "direct-routes",
        imIdentityKey(request.identity),
      );
      const cardKey =
        reply.taskId && reply.status && reply.visibility === "conversation"
          ? `${deviceId}:${reply.taskId}`
          : undefined;
      // Notify the actual sender, not the receiving bot's owner. Keep progress
      // card updates quiet; actionable waits and final results need a new message.
      const mention =
        reply.taskId &&
        reply.visibility === "conversation" &&
        request.conversation.kind === "group" &&
        !reply.heartbeat &&
        (reply.final || reply.status === "waiting")
          ? (request.originator ?? request.identity)
          : undefined;
      if (cardKey && (reply.final || mention)) {
        const text = `${imText(request.locale, "task", { id: reply.taskId! })}\n${imText(request.locale, reply.status!)}`;
        if (space)
          services.broadcast(
            space,
            `${reply.id}:status`,
            text,
            undefined,
            request.id,
            reply.taskId,
            cardKey,
          );
        else
          services.queueDelivery(`${reply.id}:status`, {
            conversation: request.conversation,
            invocationId: request.id,
            ...(reply.taskId ? { taskId: reply.taskId } : {}),
            text,
            cardKey,
          });
      }
      if (reply.stream) {
        if (
          cardKey &&
          !reply.final &&
          !space &&
          request.identity.channel === "feishu" &&
          request.conversation.kind === "direct"
        ) {
          services.queueDelivery(`${reply.id}:stream`, {
            conversation: request.conversation,
            invocationId: request.id,
            ...(reply.taskId ? { taskId: reply.taskId } : {}),
            text: reply.text,
            cardKey,
            stream: true,
          });
        }
      } else if (reply.visibility === "owner") {
        if (ownerRoute)
          services.queueDelivery(reply.id, {
            conversation: ownerRoute,
            text: reply.text,
            invocationId: request.id,
            ...(reply.taskId ? { taskId: reply.taskId } : {}),
            ...(reply.approval ? { approval: reply.approval } : {}),
          });
        else
          services.queueDelivery(reply.id, {
            conversation: request.conversation,
            text: imText(request.locale, "ownerDesktop"),
          });
      } else if (space) {
        services.broadcast(
          space,
          reply.id,
          reply.text,
          undefined,
          request.id,
          reply.taskId,
          reply.final || mention ? undefined : cardKey,
          parsedReply.id,
          mention,
        );
      } else
        services.queueDelivery(reply.id, {
          conversation: request.conversation,
          text: reply.text,
          invocationId: request.id,
          ...(reply.taskId ? { taskId: reply.taskId } : {}),
          ...(mention ? { mentionUserId: mention.userId } : {}),
          ...(!reply.final && !mention && cardKey ? { cardKey } : {}),
        });
      const assignment = request.collaboration
        ? services.store.get<CollaborationTask>(
            "collaboration-tasks",
            request.collaboration.taskId,
          )
        : reply.taskId
          ? services.assignmentForThread(deviceId, reply.taskId)
          : undefined;
      if (assignment && reply.started && assignment.state === "queued") {
        assignment.state = "working";
        services.store.put("collaboration-tasks", assignment.id, assignment);
      }
      if (assignment && reply.final) {
        const task = assignment;
        if (task && task.state !== "cancelled") {
          task.deliveryState = reply.deliveryState ?? "delivered";
          if (task.deliveryState === "delivered") task.result = reply.text;
          task.state = reply.outcome ?? "completed";
          services.store.put("collaboration-tasks", task.id, task);
          // Completion is delivered once to the original coordinator; it has no authority to expand grants.
          const parent = services.store
            .list<RemoteInvocationContext>("invocations")
            .find(
              (item) =>
                item.deviceId === task.coordinatorDeviceId &&
                item.conversation.spaceId === task.spaceId &&
                services.store.get<ImReply>(
                  "thread-links",
                  `${task.coordinatorDeviceId}:${task.coordinatorThreadId}`,
                )?.invocationId === item.id,
            );
          if (
            parent &&
            !parent.desktopTurnId &&
            task.deliveryState === "delivered"
          ) {
            const result = {
              ...parent,
              id: `result:${task.id}`,
              sourceKind: "tool-result" as const,
              taskId: task.coordinatorThreadId,
              text: `[${imText(services.deviceLocale(parent.deviceId), "collaborationResultLabel", { id: task.id })}]\n${task.result}`,
              attachments: [],
              expiresAt: Math.min(parent.expiresAt, task.expiresAt),
            };
            services.inheritSecurity(request.id, result.id);
            services.store.put("invocations", result.id, result);
            services.store.enqueue(
              "device",
              result.id,
              parent.deviceId,
              result,
            );
          }
        }
      }
      if (reply.taskId && (reply.started || reply.final)) {
        if (!services.store.get("thread-links", `${deviceId}:${reply.taskId}`))
          services.store.put(
            "thread-links",
            `${deviceId}:${reply.taskId}`,
            reply,
          );
        if (assignment)
          services.store.put("assignment-threads", assignment.id, reply.taskId);
      }
    });
  }

  function acknowledge(deviceId: string, id: string): void {
    const request = services.store.get<RemoteInvocationContext>(
      "invocations",
      id,
    );
    if (!request || request.deviceId !== deviceId)
      throw new Error("Cannot acknowledge another device's request.");
    services.store.mark("device", id, "done");
  }
  const handlers = { queueDelivery, broadcast, receiveReply, acknowledge };
  return handlers;
}

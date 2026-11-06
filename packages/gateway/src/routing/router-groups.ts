import type { IdentityBinding } from "./router-types.js";

import { imText } from "../i18n/im-localization.js";
import type { AppLocale } from "@artemis/protocol";

import {
  imConversationKey,
  imIdentityKey,
  remoteInvocationSchema,
  type CollaborationCommand,
  type CollaborationSpace,
  type CollaborationTask,
  type ImConversation,
  type ImReply,
  type RemoteInvocationContext,
} from "@artemis/protocol";
import { digest } from "../store.js";

import type { RouterDependencies } from "./router-dependencies.js";
export function createRouterGroups(
  services: Pick<
    RouterDependencies,
    "store" | "deviceLocale" | "now" | "isInvocationAuthorized"
  >,
) {
  function deviceLocale(deviceId: string): AppLocale {
    return services.store.get<AppLocale>("device-locales", deviceId) ?? "zh-CN";
  }

  function findSpace(
    conversation: ImConversation,
  ): CollaborationSpace | undefined {
    return services.store
      .list<CollaborationSpace>("native-groups")
      .find(
        (space) =>
          space.nativeGroup?.version === 1 &&
          space.nativeGroup.enabled &&
          space.endpoints.length === 1 &&
          space.endpoints.some(
            (endpoint) =>
              imConversationKey(endpoint) === imConversationKey(conversation),
          ) &&
          space.endpoints.every((endpoint) =>
            (
              services.store.get<string[]>("space-confirmations", space.id) ??
              []
            ).includes(imConversationKey(endpoint)),
          ),
      );
  }

  function participantName(
    space: CollaborationSpace,
    deviceId: string,
  ): string {
    return (
      space.participants.findLast((p) => p.deviceId === deviceId)?.name ??
      "Artemis"
    );
  }

  function assignmentForThread(
    deviceId: string,
    threadId: string,
  ): CollaborationTask | undefined {
    return services.store
      .list<CollaborationTask>("collaboration-tasks")
      .find(
        (task) =>
          task.participantDeviceId === deviceId &&
          services.store.get<string>("assignment-threads", task.id) ===
            threadId,
      );
  }

  function groupConversationContext(
    deviceId: string,
    spaceId: string,
  ): RemoteInvocationContext {
    const space = services.store.get<CollaborationSpace>(
      "native-groups",
      spaceId,
    );
    const participant = space?.participants.find(
      (p) =>
        p.deviceId === deviceId &&
        services.store.get<IdentityBinding>(
          "identities",
          imIdentityKey(p.identity),
        )?.deviceId === deviceId,
    );
    const endpoint =
      participant &&
      space?.endpoints.find(
        (e) => e.connectionId === participant.identity.connectionId,
      );
    if (!space || !participant || !endpoint)
      throw new Error(
        "Only a paired member can open this group's conversation.",
      );
    const id = `group:${digest(JSON.stringify([deviceId, spaceId, space.revision]))}`;
    const request = remoteInvocationSchema.parse({
      version: 1,
      id,
      deviceId,
      locale: services.deviceLocale(deviceId),
      identity: participant.identity,
      conversation: { ...endpoint, spaceId, spaceRevision: space.revision },
      messageId: id,
      text: "",
      attachments: [],
      expiresAt: services.now() + 30 * 60_000,
    });
    if (!services.isInvocationAuthorized(request))
      throw new Error(
        "Every group must be confirmed before opening the conversation.",
      );
    services.store.put("invocations", id, request);
    return request;
  }

  function desktopCollaborationContext(
    deviceId: string,
    invocationId: string,
    threadId: string,
    turnId: string,
  ): string {
    const original = services.store.get<RemoteInvocationContext>(
      "invocations",
      invocationId,
    );
    if (
      !original ||
      original.deviceId !== deviceId ||
      original.conversation.kind !== "group" ||
      !services.isInvocationAuthorized({ ...original, originator: undefined })
    )
      throw new Error(
        "Desktop collaboration requires a current authorized group binding.",
      );
    const id = `desktop:${digest(JSON.stringify([deviceId, threadId, turnId]))}`;
    const existing = services.store.get<RemoteInvocationContext>(
      "invocations",
      id,
    );
    if (existing) {
      if (existing.expiresAt <= services.now())
        throw new Error(
          "This desktop collaboration turn has expired. Start a new turn.",
        );
      return id;
    }
    const request = remoteInvocationSchema.parse({
      version: 1,
      id,
      deviceId,
      locale: services.deviceLocale(deviceId),
      identity: original.identity,
      conversation: original.conversation,
      messageId: id,
      text: "Desktop group collaboration",
      desktopTurnId: turnId,
      attachments: [],
      expiresAt: services.now() + 30 * 60_000,
    });
    services.store.put("invocations", id, request);
    services.store.put("thread-links", `${deviceId}:${threadId}`, {
      version: 1,
      id,
      invocationId: id,
      taskId: threadId,
      text: "",
      final: false,
      visibility: "conversation",
    } satisfies ImReply);
    services.store.delete("finished-collaborations", `${deviceId}:${threadId}`);
    return id;
  }

  function collaborate(
    _deviceId: string,
    _invocationId: string,
    _threadId: string,
    _command: CollaborationCommand,
  ): unknown {
    throw new Error(imText(services.deviceLocale(_deviceId), "manualOnly"));
  }

  function queueAssignmentCancellation(
    task: CollaborationTask,
    id: string,
  ): void {
    const assignment = services.store.get<RemoteInvocationContext>(
      "invocations",
      task.invocationId,
    );
    if (!assignment) return;
    const cancel = {
      ...assignment,
      id,
      text: "",
      control: "cancel" as const,
      expiresAt: services.now() + 300000,
    };
    services.store.put("invocations", cancel.id, cancel);
    services.store.enqueue("device", cancel.id, assignment.deviceId, cancel);
  }
  const handlers = {
    deviceLocale,
    findSpace,
    participantName,
    assignmentForThread,
    groupConversationContext,
    desktopCollaborationContext,
    collaborate,
    queueAssignmentCancellation,
  };
  return handlers;
}

import type { IdentityBinding } from "./router-types.js";

import { imText } from "../i18n/im-localization.js";

import { NATIVE_PREFIX } from "../channels/native-protocol.js";
import { randomUUID } from "node:crypto";
import {
  channelEventSchema,
  imConversationKey,
  imIdentityKey,
  remoteInvocationSchema,
  type ChannelEvent,
  type CollaborationSpace,
  type ImIdentity,
  type ImReply,
  type RemoteInvocationContext,
} from "@artemis/protocol";
import { digest } from "../store.js";

import type { RouterDependencies } from "./router-dependencies.js";
export function createRouterIngress(
  services: Pick<
    RouterDependencies,
    | "store"
    | "native"
    | "eventKey"
    | "now"
    | "findSpace"
    | "broadcast"
    | "queueDelivery"
    | "deviceLocale"
    | "handlePausedGroup"
    | "routeTargetedCommand"
    | "isInvocationAuthorized"
    | "participantName"
  >,
) {
  function ingest(input: unknown): boolean {
    const event = channelEventSchema.parse(input);
    if (
      services.store.get(
        "retired-groups",
        imConversationKey(event.conversation),
      )
    )
      return false;
    if (event.conversation.connectionId !== event.identity.connectionId)
      throw new Error("Channel identity does not match the conversation.");
    if (event.text.trim().startsWith(NATIVE_PREFIX))
      return services.native.receive(event);
    if (event.bot || (event.conversation.kind === "group" && !event.mentioned))
      return false;

    return services.store.enqueue(
      "incoming",
      services.eventKey(event),
      event.identity.connectionId,
      event,
    );
  }

  function eventKey(event: ChannelEvent): string {
    return digest(`${event.identity.connectionId}\0${event.messageId}`);
  }

  function processIncoming(): void {
    for (const row of services.store.db
      .prepare(
        "SELECT id,payload FROM queue WHERE bucket='device' AND state='pending' AND json_extract(payload,'$.expiresAt')<=? LIMIT 100",
      )
      .all(services.now())) {
      const request = remoteInvocationSchema.parse(
        JSON.parse(String(row.payload)),
      );
      services.store.transaction(() => {
        services.store.mark("device", String(row.id), "expired");
        const space = request.conversation.spaceId
          ? services.findSpace(request.conversation)
          : undefined;
        const text = imText(request.locale, "queueExpired");
        if (space && space.revision === request.conversation.spaceRevision)
          services.broadcast(
            space,
            `expired:${String(row.id)}`,
            text,
            undefined,
            request.id,
          );
        else
          services.queueDelivery(`expired:${String(row.id)}`, {
            conversation: request.conversation,
            invocationId: request.id,
            text,
          });
      });
    }
    for (const item of services.store.pending<ChannelEvent>(
      "incoming",
      services.now(),
    )) {
      const event = item.payload;
      if (
        services.store.get(
          "retired-groups",
          imConversationKey(event.conversation),
        )
      ) {
        services.store.mark("incoming", item.id, "cancelled");
        continue;
      }
      try {
        if (
          event.conversation.kind === "direct" &&
          /^\/pair\s+[a-f0-9]{16}$/iu.test(event.text)
        ) {
          services.store.transaction(() => {
            const pending = services.store.requestPair(
              event.text.split(/\s+/u)[1]!,
              event.identity,
              event.conversation,
              services.now(),
            );
            let pairedDevice = pending?.deviceId;
            if (!pending) {
              pairedDevice = services.store.pair(
                event.text.split(/\s+/u)[1]!,
                event.identity,
                services.now(),
              );
              services.store.put(
                "direct-routes",
                imIdentityKey(event.identity),
                event.conversation,
              );
            }
            services.queueDelivery(`${item.id}:paired`, {
              conversation: event.conversation,
              text: imText(
                pairedDevice ? services.deviceLocale(pairedDevice) : undefined,
                pending ? "pairRequested" : "paired",
              ),
            });
            services.store.mark("incoming", item.id, "done");
          });
          continue;
        }
        services.store.transaction(() => {
          if (services.handlePausedGroup(event)) {
            services.store.mark("incoming", item.id, "done");
            return;
          }
          const nativeSpace =
            event.conversation.kind === "group"
              ? services.findSpace(event.conversation)
              : undefined;
          const owner = nativeSpace?.nativeGroup
            ? nativeSpace.participants[0]
            : undefined;
          if (
            owner &&
            (event.identity.channel !== owner.identity.channel ||
              event.identity.connectionId !== owner.identity.connectionId ||
              event.identity.tenantId !== owner.identity.tenantId ||
              event.identity.appId !== owner.identity.appId)
          ) {
            services.store.mark("incoming", item.id, "done");
            return;
          }
          if (
            nativeSpace &&
            services.store.get(
              "group-denied-senders",
              JSON.stringify([nativeSpace.id, imIdentityKey(event.identity)]),
            )
          ) {
            services.queueDelivery(`${item.id}:assignment-denied`, {
              conversation: event.conversation,
              text: imText(
                owner ? services.deviceLocale(owner.deviceId) : undefined,
                "memberDenied",
              ),
            });
            services.store.mark("incoming", item.id, "done");
            return;
          }
          const groupSender =
            owner &&
            imIdentityKey(owner.identity) !== imIdentityKey(event.identity);
          const binding = services.store.get<IdentityBinding>(
            "identities",
            imIdentityKey(owner?.identity ?? event.identity),
          );
          if (!binding) {
            if (event.conversation.kind === "direct")
              services.queueDelivery(`${item.id}:unpaired`, {
                conversation: event.conversation,
                text: imText(undefined, "pairRequired"),
              });
            services.store.mark("incoming", item.id, "done");
            return;
          }
          if (
            !services.store.get<{ revoked: boolean }>(
              "devices",
              binding.deviceId,
            ) ||
            services.store.get<{ revoked: boolean }>(
              "devices",
              binding.deviceId,
            )?.revoked
          )
            throw new Error(
              "This device has been revoked. Pair an active device first.",
            );
          if (event.conversation.kind === "direct")
            services.store.put(
              "direct-routes",
              imIdentityKey(event.identity),
              event.conversation,
            );
          else {
            const key = imConversationKey(event.conversation);
            const previous = services.store.get<{ identities?: ImIdentity[] }>(
              "observed-groups",
              key,
            );
            const identities = [
              ...(previous?.identities ?? []).filter(
                (i) => imIdentityKey(i) !== imIdentityKey(event.identity),
              ),
              event.identity,
            ].slice(-100);
            services.store.put("observed-groups", key, {
              ...previous,
              conversation: event.conversation,
              identities,
              lastSeenAt: services.now(),
            });
          }
          const space = services.findSpace(event.conversation);
          if (event.conversation.kind === "group" && !space) {
            services.queueDelivery(`${item.id}:group-setup`, {
              conversation: event.conversation,
              text: imText(
                services.deviceLocale(binding.deviceId),
                "groupDiscovered",
              ),
            });
            services.store.mark("incoming", item.id, "done");
            return;
          }
          if (
            event.conversation.kind === "group" &&
            space &&
            !space.nativeGroup &&
            !space.participants.some(
              (p) =>
                p.deviceId === binding.deviceId &&
                imIdentityKey(p.identity) === imIdentityKey(event.identity),
            )
          ) {
            services.queueDelivery(`${item.id}:group-denied`, {
              conversation: event.conversation,
              text: imText(
                services.deviceLocale(binding.deviceId),
                "memberNotAuthorized",
              ),
            });
            services.store.mark("incoming", item.id, "done");
            return;
          }
          if (
            space?.nativeGroup &&
            event.timestamp < space.nativeGroup.enabledAt
          ) {
            services.store.mark("incoming", item.id, "done");
            return;
          }
          if (
            groupSender &&
            event.text.trimStart().startsWith("/") &&
            !/^\/(?:new|stop|status|stopwait)(?:\s|$)/iu.test(event.text.trim())
          ) {
            services.queueDelivery(`${item.id}:owner-command`, {
              conversation: event.conversation,
              text: imText(
                services.deviceLocale(binding.deviceId),
                "ownerCommands",
              ),
            });
            services.store.mark("incoming", item.id, "done");
            return;
          }
          const conversation = {
            ...event.conversation,
            ...(space
              ? { spaceId: space.id, spaceRevision: space.revision }
              : {}),
          };
          if (services.routeTargetedCommand(event, space, item.id)) {
            services.store.mark("incoming", item.id, "done");
            return;
          }
          const reply = event.replyTo
            ? services.store.get<{ taskId?: string; deviceId: string }>(
                "message-map",
                `${event.identity.connectionId}:${event.replyTo}`,
              )
            : undefined;
          const linked =
            space && reply?.taskId
              ? services.store.get<ImReply>(
                  "thread-links",
                  `${reply.deviceId}:${reply.taskId}`,
                )
              : undefined;
          const parent = linked
            ? services.store.get<RemoteInvocationContext>(
                "invocations",
                linked.invocationId,
              )
            : undefined;
          const peerReply =
            parent &&
            parent.conversation.spaceId === space?.id &&
            services.isInvocationAuthorized(parent) &&
            reply?.deviceId !== binding.deviceId &&
            !event.text.startsWith("/") &&
            space?.participants.some((p) => p.deviceId === parent.deviceId);
          const request = remoteInvocationSchema.parse({
            version: 1,
            id: item.id,
            deviceId: peerReply ? parent.deviceId : binding.deviceId,
            locale: peerReply
              ? (parent.locale ?? services.deviceLocale(parent.deviceId))
              : services.deviceLocale(binding.deviceId),
            identity: peerReply
              ? parent.identity
              : (owner?.identity ?? event.identity),
            ...(peerReply || groupSender ? { originator: event.identity } : {}),
            conversation: peerReply ? parent.conversation : conversation,
            messageId: event.messageId,
            text: event.text,
            expiresAt: peerReply
              ? parent.expiresAt
              : services.now() + 30 * 60_000,
            attachments: peerReply ? [] : event.attachments,
            ...(parent?.collaboration &&
            (peerReply || reply?.deviceId === binding.deviceId)
              ? { collaboration: parent.collaboration }
              : {}),
            ...(reply?.taskId &&
            (reply.deviceId === binding.deviceId || peerReply)
              ? { taskId: reply.taskId }
              : {}),
          });
          services.store.put("invocations", request.id, request);
          services.store.enqueue(
            "device",
            request.id,
            request.deviceId,
            request,
          );
          if (
            (services.store.get<{ expiresAt: number }>(
              "device-leases",
              request.deviceId,
            )?.expiresAt ?? 0) <= services.now()
          )
            services.queueDelivery(`${item.id}:offline`, {
              conversation,
              invocationId: request.id,
              text: imText(request.locale, "offline", {
                minutes: Math.max(
                  1,
                  Math.ceil((request.expiresAt - services.now()) / 60000),
                ),
              }),
            });
          if (space && !event.text.startsWith("/"))
            services.broadcast(
              space,
              `${item.id}:shared`,
              `[${services.participantName(space, binding.deviceId)} · ${event.identity.channel}] ${event.text}`,
              conversation,
              request.id,
              request.taskId,
            );
          services.store.mark("incoming", item.id, "done");
        });
      } catch (error) {
        services.queueDelivery(`${item.id}:error`, {
          conversation: event.conversation,
          text:
            error instanceof Error
              ? error.message
              : "IM request could not be accepted.",
        });
        services.store.mark("incoming", item.id, "failed");
      }
    }
  }

  function routeTargetedCommand(
    event: ChannelEvent,
    _space: CollaborationSpace | undefined,
    eventId: string,
  ): boolean {
    if (!/^\/(?:agents|ask|space-confirm)(?:\s|$)/u.test(event.text))
      return false;
    services.queueDelivery(`${eventId}:manual`, {
      conversation: event.conversation,
      text: imText(
        _space?.nativeGroup
          ? services.deviceLocale(_space.nativeGroup.ownerDeviceId)
          : undefined,
        "manualOnly",
      ),
    });
    return true;
  }

  function handlePausedGroup(event: ChannelEvent): boolean {
    if (event.conversation.kind !== "group") return false;
    const group = services.store
      .list<CollaborationSpace>("native-groups")
      .find(
        (g) =>
          g.nativeGroup?.version === 1 &&
          !g.nativeGroup.enabled &&
          g.endpoints.some(
            (e) =>
              imConversationKey(e) === imConversationKey(event.conversation),
          ),
      );
    if (!group) return false;
    const owner = group.participants[0];
    if (
      !owner ||
      !["feishu", "lark"].includes(owner.identity.channel) ||
      event.identity.channel !== owner.identity.channel ||
      event.identity.connectionId !== owner.identity.connectionId ||
      event.identity.tenantId !== owner.identity.tenantId ||
      event.identity.appId !== owner.identity.appId ||
      event.bot ||
      !event.mentioned ||
      services.store.get<IdentityBinding>(
        "identities",
        imIdentityKey(owner.identity),
      )?.deviceId !== owner.deviceId ||
      services.store.get<{ revoked: boolean }>("devices", owner.deviceId)
        ?.revoked !== false ||
      services.store.get(
        "group-denied-senders",
        JSON.stringify([group.id, imIdentityKey(event.identity)]),
      )
    )
      return true;
    const native = group.nativeGroup!;
    const prior = services.store.get<{
      unavailable?: string;
      checkedAt: number;
    }>("native-group-info", group.id);
    let recovery =
      native.recovery ??
      (prior?.unavailable === "removed"
        ? { version: 1 as const, removedAt: prior.checkedAt }
        : undefined);
    if (
      !recovery ||
      !Number.isFinite(recovery.removedAt) ||
      event.timestamp <= recovery.removedAt ||
      event.timestamp < (recovery.rejoinedAt ?? 0) ||
      event.timestamp > services.now() + 60000
    )
      return true;
    // A fresh authenticated mention also recovers a missed added event or older state.
    if (!recovery.rejoinedAt) {
      recovery = { ...recovery, rejoinedAt: event.timestamp };
      services.store.put("native-groups", group.id, {
        ...group,
        revision: randomUUID(),
        nativeGroup: { ...native, recovery },
      });
      services.store.put("native-group-info", group.id, {
        checkedAt: services.now(),
        next: 0,
      });
    }
    services.queueDelivery(
      `group-rejoined:${group.id}:${recovery.rejoinedAt}`,
      {
        conversation: event.conversation,
        groupRecovery: { groupId: group.id, rejoinedAt: recovery.rejoinedAt! },
        text: imText(services.deviceLocale(owner.deviceId), "groupRejoined"),
      },
    );
    return true;
  }
  const handlers = {
    ingest,
    eventKey,
    processIncoming,
    routeTargetedCommand,
    handlePausedGroup,
  };
  return handlers;
}

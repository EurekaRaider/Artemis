import type { IdentityBinding } from "./router-types.js";
import type { Delivery } from "../runtime/routing-contracts.js";

import {
  channelEventSchema,
  imConversationKey,
  imIdentityKey,
  isImOwnerDirectRequest,
  type CollaborationSpace,
  type ImReply,
  type RemoteInvocationContext,
} from "@artemis/protocol";

import type { RouterDependencies } from "./router-dependencies.js";
export function createRouterSecurity(
  services: Pick<
    RouterDependencies,
    "store" | "securityAllowed" | "findSpace" | "now" | "isInvocationAuthorized"
  >,
) {
  function isInvocationAuthorized(
    request: RemoteInvocationContext,
    control = request.control === "cancel",
  ): boolean {
    if (
      !control &&
      !isImOwnerDirectRequest(request) &&
      (
        services.store.get<Array<NonNullable<Delivery["security"]>>>(
          "invocation-dependencies",
          request.id,
        ) ?? []
      ).some((s) => !services.securityAllowed(s))
    )
      return false;
    const device = services.store.get<{ revoked: boolean }>(
      "devices",
      request.deviceId,
    );
    if (
      !device ||
      device.revoked ||
      services.store.get<IdentityBinding>(
        "identities",
        imIdentityKey(request.identity),
      )?.deviceId !== request.deviceId
    )
      return false;
    if (request.conversation.kind === "direct")
      return isImOwnerDirectRequest(request);
    const space = services.findSpace(request.conversation);
    if (
      !space ||
      space.id !== request.conversation.spaceId ||
      (!control && space.revision !== request.conversation.spaceRevision) ||
      !space.participants.some(
        (p) =>
          p.deviceId === request.deviceId &&
          imIdentityKey(p.identity) === imIdentityKey(request.identity),
      )
    )
      return false;
    if (
      services.store.get(
        "group-denied-senders",
        JSON.stringify([
          space.id,
          imIdentityKey(request.originator ?? request.identity),
        ]),
      )
    )
      return false;
    if (request.originator && space.nativeGroup) {
      const row = services.store.db
        .prepare("SELECT payload FROM queue WHERE bucket='incoming' AND id=?")
        .get(request.id);
      const source = row
        ? channelEventSchema.safeParse(JSON.parse(String(row.payload)))
        : undefined;
      return (
        !!source?.success &&
        !source.data.bot &&
        source.data.mentioned &&
        source.data.timestamp >= space.nativeGroup.enabledAt &&
        source.data.messageId === request.messageId &&
        source.data.text === request.text &&
        (!request.text.trimStart().startsWith("/") ||
          /^\/(?:new|stop|status|stopwait)(?:\s|$)/iu.test(
            request.text.trim(),
          )) &&
        imIdentityKey(source.data.identity) ===
          imIdentityKey(request.originator) &&
        imConversationKey(source.data.conversation) ===
          imConversationKey(request.conversation) &&
        request.originator.channel === request.identity.channel &&
        request.originator.connectionId === request.identity.connectionId &&
        request.originator.tenantId === request.identity.tenantId &&
        request.originator.appId === request.identity.appId
      );
    }
    if (request.originator) {
      const originator = services.store.get<IdentityBinding>(
        "identities",
        imIdentityKey(request.originator),
      );
      if (
        !originator ||
        services.store.get<{ revoked: boolean }>("devices", originator.deviceId)
          ?.revoked ||
        !space.participants.some(
          (p) =>
            p.deviceId === originator.deviceId &&
            imIdentityKey(p.identity) === imIdentityKey(request.originator!),
        )
      )
        return false;
    }
    return true;
  }

  function securityAllowed(
    security: NonNullable<Delivery["security"]> | undefined,
  ): boolean {
    if (!security) return false;
    const state = services.store.get<{
      grants: Array<{
        projectId: string;
        revision: string;
        audience: string;
        expiresAt: number;
      }>;
    }>("device-security", security.deviceId);
    const lease = services.store.get<{ expiresAt: number }>(
      "device-leases",
      security.deviceId,
    );
    return (
      !!lease &&
      lease.expiresAt > services.now() &&
      !!state?.grants.some(
        (g) =>
          g.projectId === security.projectId &&
          g.revision === security.revision &&
          g.audience === security.audience &&
          g.expiresAt > services.now(),
      )
    );
  }

  function acceptSecurity(
    deviceId: string,
    invocationId: string,
    security: ImReply["security"],
  ): void {
    const direct = services.store.get<RemoteInvocationContext>(
      "invocations",
      invocationId,
    );
    if (
      direct?.deviceId === deviceId &&
      isImOwnerDirectRequest(direct) &&
      services.isInvocationAuthorized(direct)
    )
      return;
    if (!security || !services.securityAllowed({ ...security, deviceId }))
      throw new Error(
        "Shared operation requires a current data grant. Upgrade and confirm IM permissions.",
      );
    const invocation = services.store.get<RemoteInvocationContext>(
      "invocations",
      invocationId,
    );
    if (
      !invocation ||
      invocation.deviceId !== deviceId ||
      security.audience !==
        (invocation.conversation.kind === "direct"
          ? "owner"
          : `space:${invocation.conversation.spaceId}`)
    )
      throw new Error("Sharing audience does not match the invocation.");
    const old = services.store.get<NonNullable<Delivery["security"]>>(
      "invocation-security",
      invocationId,
    );
    if (
      old &&
      (old.revision !== security.revision ||
        old.projectId !== security.projectId ||
        old.audience !== security.audience)
    )
      throw new Error("An invocation cannot change its security scope.");
    services.store.put("invocation-security", invocationId, {
      ...security,
      deviceId,
    });
  }

  function canDeliver(delivery: Delivery): boolean {
    if (delivery.groupRecovery) {
      const group = services.store.get<CollaborationSpace>(
        "native-groups",
        delivery.groupRecovery.groupId,
      );
      if (
        !group?.nativeGroup ||
        group.nativeGroup.enabled ||
        group.nativeGroup.recovery?.rejoinedAt !==
          delivery.groupRecovery.rejoinedAt
      )
        return false;
    }
    // Also suppress presence frames persisted by older versions before restart.
    if (
      delivery.native &&
      ["presence-query", "presence"].includes(delivery.native.action)
    )
      return false;
    if (
      services.store.get(
        "retired-groups",
        imConversationKey(delivery.conversation),
      )
    )
      return false;
    if (
      delivery.native &&
      delivery.native.expiresAt <= services.now() &&
      [
        "hello",
        "probe",
        "proof",
        "presence-query",
        "presence",
        "delegate",
        "continue",
        "cancel",
        "note",
      ].includes(delivery.native.action)
    )
      return false;

    if (delivery.native?.action === "cancel") {
      const grant = services.store.get<{
        groupId: string;
        peer: string;
        expiresAt: number;
      }>("native-revocation-cancels", delivery.native.id);
      if (grant)
        return (
          grant.groupId === delivery.conversation.spaceId &&
          grant.peer === delivery.native.recipient &&
          grant.expiresAt > services.now() &&
          delivery.native.text === "" &&
          !services.store.get<{ unavailable?: string }>(
            "native-group-info",
            grant.groupId,
          )?.unavailable
        );
    }

    if (
      delivery.native &&
      !["hello", "probe", "proof"].includes(delivery.native.action)
    ) {
      const group = services.findSpace(delivery.conversation);
      // Only the exact, durable, system-authored denial may cross this gate.
      // Other rejected frames can contain task output and still need permission.
      const permissionRejection =
        delivery.native.action === "rejected" &&
        delivery.native.expiresAt > services.now() &&
        JSON.stringify(
          services.store.get<Delivery>(
            "native-permission-rejections",
            delivery.native.id,
          ),
        ) === JSON.stringify(delivery);
      if (
        !group ||
        (!group.nativeGroup?.allowedBots?.includes(delivery.native.recipient) &&
          !permissionRejection)
      )
        return false;
    }
    if (delivery.security && !services.securityAllowed(delivery.security))
      return false;
    if (delivery.invocationId) {
      const request = services.store.get<RemoteInvocationContext>(
        "invocations",
        delivery.invocationId,
      );
      if (!request || !services.isInvocationAuthorized(request)) return false;
      const stamp = services.store.get<NonNullable<Delivery["security"]>>(
        "invocation-security",
        request.id,
      );
      if (stamp && !services.securityAllowed(stamp)) return false;
      if (
        services.store.get("device-security", request.deviceId) &&
        !isImOwnerDirectRequest(request) &&
        delivery.taskId &&
        !delivery.security
      )
        return false;
    }
    if (delivery.conversation.spaceId) {
      const space = services.findSpace(delivery.conversation);
      if (
        !space ||
        space.id !== delivery.conversation.spaceId ||
        space.revision !== delivery.conversation.spaceRevision
      )
        return false;
    }
    return true;
  }

  function inheritSecurity(sourceId: string, targetId: string): void {
    const own = services.store.get<NonNullable<Delivery["security"]>>(
      "invocation-security",
      sourceId,
    );
    const inherited =
      services.store.get<Array<NonNullable<Delivery["security"]>>>(
        "invocation-dependencies",
        sourceId,
      ) ?? [];
    const dependencies = [...inherited, ...(own ? [own] : [])];
    if (dependencies.length)
      services.store.put("invocation-dependencies", targetId, dependencies);
  }
  const handlers = {
    isInvocationAuthorized,
    securityAllowed,
    acceptSecurity,
    canDeliver,
    inheritSecurity,
  };
  return handlers;
}

import { readBody, respond } from "./http-response.js";
import { type RetiredGroup } from "../groups/group-retirement.js";

import { imText } from "../i18n/im-localization.js";

import {
  IM_SECURITY_VERSION,
  imDeliverySecuritySchema,
  imReplySchema,
} from "@artemis/protocol";
import { randomBytes, createHash } from "node:crypto";

import { z } from "zod";
import {
  collaborationCommandSchema,
  imIdentityKey,
  imIdentitySchema,
  type ChannelEvent,
  type CollaborationSpace,
  type ImIdentity,
  type ImGroupRoster,
  type RemoteInvocationContext,
} from "@artemis/protocol";

import { type ChannelConnection } from "../channels/channels.js";
import type { GatewayDependencies } from "../runtime/gateway-dependencies.js";
import type { GatewayRequestContext } from "./request-context.js";
export function createGatewayDeviceRoutes(
  services: Pick<
    GatewayDependencies,
    "store" | "adapters" | "router" | "mediaKey" | "cacheAttachments"
  >,
) {
  return async function handleDevice({
    request,
    response,
    url,
    token,
    locale,
    parsedLocale,
    clientInvocation,
    identityStillBound,
  }: GatewayRequestContext): Promise<void> {
    const deviceId = request.headers["x-artemis-device"];
    if (
      typeof deviceId !== "string" ||
      !services.store.authenticate(deviceId, token)
    ) {
      respond(response, 401, { error: "Device authentication failed." });
      return;
    }
    const sessionId = request.headers["x-artemis-session"];
    if (typeof sessionId !== "string" || !/^[a-f0-9-]{36}$/iu.test(sessionId))
      throw new Error("Device session is required.");
    const lease = services.store.get<{ sessionId: string; expiresAt: number }>(
      "device-leases",
      deviceId,
    );
    if (
      lease &&
      lease.sessionId !== sessionId &&
      lease.expiresAt > Date.now()
    ) {
      respond(response, 409, {
        error:
          "Another Artemis process currently owns this device connection. Wait for its lease to expire or pause that connection.",
      });
      return;
    }
    if (url.pathname === "/v1/device/release" && request.method === "POST") {
      services.store.delete("device-leases", deviceId);
      respond(response, 200, { released: true });
      return;
    }
    if (
      request.headers["x-artemis-security-version"] !==
        String(IM_SECURITY_VERSION) &&
      services.store.get("device-security", deviceId)
    )
      services.store.put("device-security", deviceId, {
        version: IM_SECURITY_VERSION,
        grants: [],
      });
    const leaseUntil = Date.now() + 45000;
    if (parsedLocale.success)
      services.store.put("device-locales", deviceId, locale);
    services.store.put("device-leases", deviceId, {
      sessionId,
      expiresAt: leaseUntil,
    });
    response.setHeader("X-Artemis-Lease-Until", String(leaseUntil));
    if (
      [
        "/v1/device/inbox",
        "/v1/device/attachment",
        "/v1/device/poll",
        "/v1/device/collaborate",
        "/v1/device/reply",
        "/v1/device/native-deliveries",
        "/v1/device/native-command",
        "/v1/device/native-cooperation",
        "/v1/device/native-task-deleted",
        "/v1/device/artifacts",
        "/v1/device/group-context",
      ].includes(url.pathname) &&
      request.headers["x-artemis-security-version"] !==
        String(IM_SECURITY_VERSION)
    )
      throw new Error("Upgrade Artemis to use IM security version 2.");
    if (url.pathname === "/v1/device/status" && request.method === "GET") {
      respond(response, 200, {
        securityVersion: IM_SECURITY_VERSION,
        authorizationVersion: 1,
        removedConnections: services.store
          .list<{ id: string }>("removed-connections")
          .map((entry) => entry.id),
        identities: services.store
          .list<{ deviceId: string; identity: ImIdentity }>("identities")
          .filter((b) => b.deviceId === deviceId)
          .map((b) => b.identity),
        pairingRequests: services.store.pairingRequests(deviceId),
        connections: [...services.adapters.values()].map((a) => {
          const status = a.status(locale);
          const stored = services.store.get<{ sealed: string }>(
            "connections",
            status.id,
          );
          const config = stored
            ? services.store.unseal<ChannelConnection>(stored.sealed)
            : undefined;
          return {
            ...status,
            ...(config?.channel === "feishu" && config.transport !== "websocket"
              ? {
                  callbackPath: `/channels/feishu/${encodeURIComponent(config.id)}`,
                }
              : {}),
            configuration: config
              ? Object.fromEntries(
                  [
                    "id",
                    "name",
                    "tenantId",
                    "botId",
                    "appId",
                    "botOpenId",
                    "transport",
                    "domain",
                  ].flatMap((key) =>
                    key in config
                      ? [[key, config[key as keyof ChannelConnection]]]
                      : [],
                  ),
                )
              : {},
          };
        }),
        retiredGroups: services.store
          .list<RetiredGroup>("retired-groups")
          .filter((group) => group.deviceIds.includes(deviceId)),
        spaces: services.store
          .list<CollaborationSpace>("native-groups")
          .filter((s) => s.participants.some((p) => p.deviceId === deviceId))
          .map((s) => ({
            ...s,
            confirmed: !!services.router.findSpace(s.endpoints[0]!),
            roster: (() => {
              const roster = services.store.get<{ roster?: ImGroupRoster }>(
                "native-group-info",
                s.id,
              )?.roster;
              return (
                roster && {
                  ...roster,
                  members: roster.members.map((m) => ({
                    ...m,
                    ...(m.kind === "bot" && !m.self
                      ? {
                          botPresence: services.router.native.memberPresence(
                            s.id,
                            m.identity.userId,
                          ),
                          verifiedAt: services.router.native
                            .peers(s.id)
                            .find((peer) => peer.id === m.identity.userId)
                            ?.verifiedAt,
                          verificationPendingUntil:
                            services.router.native.pendingProbeUntil(
                              s.id,
                              m.identity.userId,
                            ),
                        }
                      : {}),
                    owner:
                      imIdentityKey(m.identity) ===
                      imIdentityKey(s.participants[0]!.identity),
                    canAssign:
                      (m.kind !== "bot" ||
                        !!s.nativeGroup?.allowedBots?.includes(
                          m.identity.userId,
                        )) &&
                      !services.store.get(
                        "group-denied-senders",
                        JSON.stringify([s.id, imIdentityKey(m.identity)]),
                      ),
                  })),
                }
              );
            })(),
            participants: s.participants.map((p) => {
              const device = services.store.get<{
                name: string;
                revoked: boolean;
              }>("devices", p.deviceId);
              const paired =
                services.store.get<{ deviceId: string }>(
                  "identities",
                  imIdentityKey(p.identity),
                )?.deviceId === p.deviceId;
              const online =
                (services.store.get<{ expiresAt: number }>(
                  "device-leases",
                  p.deviceId,
                )?.expiresAt ?? 0) > Date.now();
              return {
                ...p,
                deviceName: device?.name ?? "",
                state:
                  !device || device.revoked || !paired
                    ? "unavailable"
                    : online
                      ? "online"
                      : "offline",
              };
            }),
          })),
      });
      return;
    }
    if (url.pathname === "/v1/device/inbox" && request.method === "GET") {
      services.router.processIncoming();
      const requests = services.store
        .pending<RemoteInvocationContext>("device", Date.now(), deviceId)
        .filter((item) => {
          if (
            item.payload.expiresAt > Date.now() &&
            identityStillBound(item.payload)
          )
            return true;
          services.store.mark("device", item.id, "expired");
          services.router.queueDelivery(`expired:${item.id}`, {
            conversation: item.payload.conversation,
            locale: item.payload.locale ?? locale,
            text: imText(item.payload.locale ?? locale, "deliveryExpired"),
          });
          return false;
        })
        .map((item) => clientInvocation(item.payload));
      respond(response, 200, { requests });
      return;
    }
    if (url.pathname === "/v1/device/attachment" && request.method === "GET") {
      const invocation = services.store.get<RemoteInvocationContext>(
        "invocations",
        url.searchParams.get("invocationId") ?? "",
      );
      if (
        !invocation ||
        invocation.deviceId !== deviceId ||
        invocation.expiresAt <= Date.now() ||
        !identityStillBound(invocation)
      )
        throw new Error("Attachment is not authorized.");
      const adapter = services.adapters.get(invocation.identity.connectionId);
      if (!adapter) throw new Error("Channel is unavailable.");
      const channelEvent: ChannelEvent = {
        version: 1,
        messageId: invocation.messageId,
        identity: invocation.identity,
        conversation: invocation.conversation,
        text: invocation.text,
        timestamp: 0,
        mentioned: true,
        bot: false,
        attachments: invocation.attachments,
      };
      const index = Number(url.searchParams.get("index"));
      if (!Number.isInteger(index) || !channelEvent.attachments[index])
        throw new Error("Unknown attachment.");
      let cached = services.store.get<{ sealed: string; expiresAt: number }>(
        "media-cache",
        services.mediaKey(channelEvent, index),
      );
      if (!cached || cached.expiresAt <= Date.now()) {
        await services.cacheAttachments(channelEvent);
        cached = services.store.get(
          "media-cache",
          services.mediaKey(channelEvent, index),
        );
      }
      if (!cached)
        throw new Error("Attachment could not be preserved. Please resend it.");
      const stored = services.store.unseal<{
        data: string;
        mimeType: string;
        name: string;
      }>(cached.sealed);
      const attachment = {
        ...stored,
        data: Buffer.from(stored.data, "base64"),
      };
      response.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": attachment.data.length,
        "Cache-Control": "no-store",
        "X-Artemis-Mime": attachment.mimeType,
        "X-Artemis-Name": encodeURIComponent(attachment.name),
      });
      response.end(attachment.data);
      return;
    }
    if (url.pathname === "/v1/device/security" && request.method === "GET") {
      respond(
        response,
        200,
        services.store.get("device-security", deviceId) ?? { grants: [] },
      );
      return;
    }
    if (request.method !== "POST") throw new Error("Unknown device operation.");
    const body = JSON.parse(await readBody(request));
    if (url.pathname === "/v1/device/security" && request.method === "POST") {
      const policy = z
        .object({
          version: z.literal(IM_SECURITY_VERSION),
          grants: z
            .array(
              z
                .object({
                  projectId: z.string().min(1),
                  revision: z.string().min(1),
                  audience: z.string().min(1),
                  expiresAt: z.number().int().positive(),
                })
                .strict(),
            )
            .max(10100),
        })
        .strict()
        .parse(body);
      const retiredAudiences = new Set(
        services.store
          .list<RetiredGroup>("retired-groups")
          .flatMap((group) => group.groupIds.map((id) => `space:${id}`)),
      );
      policy.grants = policy.grants.filter(
        (grant) => !retiredAudiences.has(grant.audience),
      );
      services.store.put("device-security", deviceId, policy);
      respond(response, 200, { accepted: true });
      return;
    }
    if (
      url.pathname === "/v1/device/group-context" &&
      request.method === "POST"
    ) {
      const input = z
        .object({ spaceId: z.string().min(1).max(256) })
        .strict()
        .parse(body);
      respond(
        response,
        200,
        services.store.transaction(() =>
          clientInvocation(
            services.router.groupConversationContext(deviceId, input.spaceId),
          ),
        ),
      );
      return;
    }
    if (url.pathname === "/v1/device/artifacts") {
      const input = z
        .object({
          security: imDeliverySecuritySchema.optional(),
          invocationId: z.string().min(1),
          name: z
            .string()
            .min(1)
            .max(255)
            .regex(/^[^\\/\r\n]+$/u),
          data: z
            .string()
            .max(14000000)
            .regex(/^[A-Za-z0-9+/]*={0,2}$/u),
        })
        .strict()
        .parse(body);
      services.router.acceptSecurity(
        deviceId,
        input.invocationId,
        input.security,
      );
      const invocation = services.store.get<RemoteInvocationContext>(
        "invocations",
        input.invocationId,
      );
      if (
        !invocation ||
        invocation.deviceId !== deviceId ||
        invocation.expiresAt <= Date.now() ||
        !identityStillBound(invocation) ||
        !/^\/publish\s/u.test(invocation.text) ||
        invocation.originator
      )
        throw new Error(
          "Only an explicit owner publish command can upload an artifact.",
        );
      if (invocation.conversation.kind === "group") {
        const group = services.router.findSpace(invocation.conversation);
        if (
          !group?.nativeGroup ||
          group.nativeGroup.ownerDeviceId !== deviceId ||
          !services.adapters.get(invocation.conversation.connectionId)?.publish
        )
          throw new Error("Native file publication is unavailable.");
        const bytes = Buffer.from(input.data, "base64");
        if (!bytes.length || bytes.length > 10 * 1024 * 1024)
          throw new Error("File must be between 1 byte and 10 MiB.");
        const id = `${deviceId}:${input.invocationId}`;
        const hash = createHash("sha256").update(bytes).digest("hex");
        const old = services.store.get<{ hash: string; name: string }>(
          "native-files",
          id,
        );
        if (old && (old.hash !== hash || old.name !== input.name))
          throw new Error("Publication ID already used for a different file.");
        services.store.transaction(() => {
          if (!old)
            services.store.put("native-files", id, {
              id,
              hash,
              name: input.name,
              sealed: services.store.seal({
                name: input.name,
                data: input.data,
              }),
            });
          services.router.queueDelivery(`file:${id}`, {
            conversation: invocation.conversation,
            invocationId: invocation.id,
            text: input.name,
            fileId: id,
            replyId: `artifact:${invocation.id}`,
          });
        });
        respond(response, 200, {
          native: true,
          id,
          state: "queued",
          sha256: hash,
        });
        return;
      }
      const old = services.store.get<{
        id: string;
        token: string;
        expiresAt: number;
        sha256: string;
      }>("artifacts", input.invocationId);
      const data = Buffer.from(input.data, "base64");
      if (data.length > 10 * 1024 * 1024)
        throw new Error("Artifact exceeds 10 MiB.");
      if (old && old.sha256 !== createHash("sha256").update(data).digest("hex"))
        throw new Error(
          "Artifact invocation cannot be reused for different bytes.",
        );
      const artifact = old ?? {
        id: input.invocationId,
        invocationId: input.invocationId,
        token: randomBytes(24).toString("base64url"),
        name: input.name,
        data: input.data,
        expiresAt: Date.now() + 15 * 60000,
        sha256: createHash("sha256").update(data).digest("hex"),
        size: data.length,
      };
      services.store.put("artifacts", input.invocationId, artifact);
      respond(response, 200, {
        id: artifact.id,
        path: `/artifacts/${artifact.id}/${artifact.token}`,
        sha256: artifact.sha256,
        expiresAt: artifact.expiresAt,
      });
      return;
    }
    if (url.pathname === "/v1/device/pair") {
      const input = z
        .object({ requireConfirmation: z.boolean().optional() })
        .strict()
        .parse(body);
      respond(response, 200, {
        code: services.store.pairCode(
          deviceId,
          Date.now(),
          input.requireConfirmation,
        ),
        expiresIn: 300,
      });
      return;
    }
    if (
      url.pathname === "/v1/device/resolve-pairing" &&
      request.method === "POST"
    ) {
      const input = z
        .object({ requestId: z.string().uuid(), approve: z.boolean() })
        .strict()
        .parse(body);
      services.store.transaction(() => {
        const pending = services.store.resolvePairRequest(
          deviceId,
          input.requestId,
          input.approve,
        );
        services.router.queueDelivery(`pairing:${pending.id}:resolved`, {
          conversation: pending.conversation,
          locale,
          text: imText(locale, input.approve ? "paired" : "pairDenied"),
        });
      });
      respond(response, 200, { resolved: true });
      return;
    }
    if (url.pathname === "/v1/device/unpair") {
      const identity = imIdentitySchema.parse(body);
      const key = imIdentityKey(identity);
      if (
        services.store.get<{ deviceId: string }>("identities", key)
          ?.deviceId !== deviceId
      )
        throw new Error("Identity belongs to another device.");
      services.store.delete("identities", key);
      services.store.delete("direct-routes", key);
      respond(response, 200, { unpaired: true });
      return;
    }
    if (url.pathname === "/v1/device/ack") {
      const { id } = z
        .object({ id: z.string().min(1) })
        .strict()
        .parse(body);
      services.router.acknowledge(deviceId, id);
      respond(response, 200, { accepted: true });
      return;
    }
    if (url.pathname === "/v1/device/native-task-deleted") {
      const input = z
        .object({
          invocationId: z.string().min(1),
          threadId: z.string().min(1),
        })
        .strict()
        .parse(body);
      services.router.native.localTaskDeleted(
        deviceId,
        input.invocationId,
        input.threadId,
      );
      respond(response, 200, { ok: true });
      return;
    }
    if (url.pathname === "/v1/device/native-cooperation") {
      const input = z
        .object({
          groupId: z.string(),
          operation: z.enum(["state", "announce", "probe", "authorize"]),
          peer: z.string().optional(),
          peers: z.array(z.string()).max(50).optional(),
        })
        .strict()
        .parse(body);
      const group = services.store.get<CollaborationSpace>(
        "native-groups",
        input.groupId,
      );
      if (group?.nativeGroup?.ownerDeviceId !== deviceId)
        throw new Error("Group does not belong to this device.");
      if (input.operation === "announce" || input.operation === "probe")
        services.router.native.probe(
          group.id,
          input.operation === "probe" ? input.peer : undefined,
        );
      if (input.operation === "authorize")
        services.router.native.authorize(group.id, input.peers ?? []);
      respond(response, 200, {
        version: 1,
        peers: services.router.native.peers(group.id),
        tasks: services.router.native.tasks(group.id),
        history: services.store
          .list<{ groupId: string }>("native-history")
          .filter((e) => e.groupId === group.id),
      });
      return;
    }
    if (url.pathname === "/v1/device/native-command") {
      const input = z
        .object({
          id: z.string(),
          invocationId: z.string(),
          threadId: z.string(),
          command: collaborationCommandSchema,
          security: imDeliverySecuritySchema.optional(),
        })
        .strict()
        .parse(body);
      if (input.command.action !== "cancel")
        services.router.acceptSecurity(
          deviceId,
          input.invocationId,
          input.security,
        );
      const request = services.store.get<RemoteInvocationContext>(
        "invocations",
        input.invocationId,
      );
      if (!request || request.deviceId !== deviceId)
        throw new Error("Invocation owner mismatch.");
      respond(
        response,
        200,
        services.router.native.command(
          request,
          input.threadId,
          input.id,
          input.command,
        ),
      );
      return;
    }
    if (url.pathname === "/v1/device/native-deliveries") {
      const { groupId } = z
        .object({ groupId: z.string().min(1) })
        .strict()
        .parse(body);
      const group = services.store.get<CollaborationSpace>(
        "native-groups",
        groupId,
      );
      if (!group?.nativeGroup || group.nativeGroup.ownerDeviceId !== deviceId)
        throw new Error("Group does not belong to this device.");
      // Read-only history remains available after pause/revocation. Never use
      // client-supplied queue IDs or local connection IDs as ownership proof.
      const rows = services.store.db
        .prepare(
          "SELECT json_extract(payload,'$.invocationId') AS invocationId,json_extract(payload,'$.replyId') AS replyId,group_concat(state) AS states FROM queue WHERE bucket='outgoing' AND json_extract(payload,'$.conversation.spaceId')=? AND json_extract(payload,'$.replyId') IS NOT NULL GROUP BY invocationId,replyId ORDER BY min(rowid) DESC LIMIT 100",
        )
        .all(groupId);
      const messages = new Map<string, { id: string; states: string[] }>();
      for (const row of rows) {
        const delivery = {
          invocationId: String(row.invocationId),
          replyId: String(row.replyId),
        };
        const request = delivery.invocationId
          ? services.store.get<RemoteInvocationContext>(
              "invocations",
              delivery.invocationId,
            )
          : undefined;
        if (request?.deviceId !== deviceId || !delivery.replyId) continue;
        const message = messages.get(delivery.replyId) ?? {
          id: delivery.replyId,
          states: [],
        };
        message.states.push(...String(row.states).split(","));
        messages.set(message.id, message);
      }
      respond(response, 200, {
        version: 1,
        messages: [...messages.values()].map(({ id, states }) => ({
          id,
          state: states.includes("uncertain")
            ? "uncertain"
            : states.includes("revoked") || states.includes("cancelled")
              ? "revoked"
              : states.includes("failed")
                ? "failed"
                : states.every((state) => state === "done")
                  ? "platform-accepted"
                  : "submitted",
        })),
      });
      return;
    }
    if (url.pathname === "/v1/device/reply") {
      const reply = imReplySchema.parse(body);
      if (reply.taskId)
        services.router.acceptSecurity(
          deviceId,
          reply.invocationId,
          reply.security,
        );
      services.router.receiveReply(deviceId, reply);
      respond(response, 200, { accepted: true });
      return;
    }
    if (url.pathname === "/v1/device/collaborate") {
      const input = z
        .object({
          id: z.string().min(1).max(256),
          invocationId: z.string().min(1),
          threadId: z.string().min(1),
          desktopTurnId: z.string().min(1).max(256).optional(),
          command: collaborationCommandSchema,
          security: imDeliverySecuritySchema,
        })
        .strict()
        .parse(body);
      services.router.acceptSecurity(
        deviceId,
        input.invocationId,
        input.security,
      );
      const invocationId = input.desktopTurnId
        ? services.store.transaction(() =>
            services.router.desktopCollaborationContext(
              deviceId,
              input.invocationId,
              input.threadId,
              input.desktopTurnId!,
            ),
          )
        : input.invocationId;
      if (invocationId !== input.invocationId)
        services.router.acceptSecurity(deviceId, invocationId, input.security);
      const key = JSON.stringify([
        deviceId,
        invocationId,
        input.threadId,
        input.id,
      ]);
      const old = services.store.get<{ command: unknown; result: unknown }>(
        "collaboration-receipts",
        key,
      );
      if (old) {
        if (JSON.stringify(old.command) !== JSON.stringify(input.command))
          throw new Error(
            "Collaboration call ID cannot be reused for a different command.",
          );
        respond(response, 200, old.result);
        return;
      }
      if (
        services.store.get(
          "collaboration-receipts",
          JSON.stringify([deviceId, input.id]),
        )
      )
        throw new Error(
          "Legacy collaboration receipt has no conversation scope. Use a new tool call ID.",
        );
      const result = services.store.transaction(() => {
        const value = services.router.collaborate(
          deviceId,
          invocationId,
          input.threadId,
          input.command,
        );
        services.store.put("collaboration-receipts", key, {
          command: input.command,
          result: value,
        });
        return value;
      });
      respond(response, 200, result);
      return;
    }
    throw new Error("Unknown device operation.");
  };
}

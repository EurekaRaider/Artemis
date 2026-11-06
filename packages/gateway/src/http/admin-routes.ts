import { readBody, respond } from "./http-response.js";
import { retireKnownGroups } from "../groups/group-retirement.js";
import { authorizeNativeGroup } from "../authorization/native-authorization.js";
import { imText } from "../i18n/im-localization.js";
import { saveNativeGroup } from "../groups/native-groups.js";
import { IM_SECURITY_VERSION } from "@artemis/protocol";

import { z } from "zod";
import {
  imConversationKey,
  imIdentityKey,
  imIdentitySchema,
  type CollaborationSpace,
  type ImIdentity,
  type ImConversation,
  type ImGroupRoster,
} from "@artemis/protocol";
import { sameSecret } from "../store.js";
import { resolveSlackConnection } from "../channels/slack/slack.js";
import { resolveFeishuConnection } from "../channels/feishu/feishu-setup.js";
import type { FeishuTyping } from "../channels/feishu/feishu-typing.js";
import { type FeishuApprovalCard } from "../channels/feishu/feishu-approval.js";
import {
  channelConnectionSchema,
  type ChannelConnection,
} from "../channels/channels.js";
import type { GatewayDependencies } from "../runtime/gateway-dependencies.js";
import type { GatewayRequestContext } from "./request-context.js";
export function createGatewayAdminRoutes(
  services: Pick<
    GatewayDependencies,
    | "options"
    | "store"
    | "adapters"
    | "install"
    | "visibleGroups"
    | "presenceRefreshAt"
    | "metadataJob"
    | "refreshNativeGroupInfo"
    | "tick"
    | "presenceJob"
    | "router"
    | "refreshDiscoveredGroupNames"
  >,
) {
  return async function handleAdmin({
    request,
    response,
    url,
    token,
    locale,
    parsedLocale,
    clientInvocation,
    identityStillBound,
  }: GatewayRequestContext): Promise<void> {
    if (!sameSecret(token, services.options.adminToken)) {
      respond(response, 401, { error: "Invalid administrator credential." });
      return;
    }
    const body =
      request.method === "GET" ? {} : JSON.parse(await readBody(request));
    if (url.pathname === "/v1/admin/register" && request.method === "POST") {
      const input = z
        .object({ name: z.string().min(1).max(100) })
        .strict()
        .parse(body);
      const device = services.store.register(input.name);
      services.store.put("device-locales", device.id, locale);
      respond(response, 201, device);
      return;
    }
    if (url.pathname === "/v1/admin/remove-space" && request.method === "PUT") {
      const { id } = z
        .object({ id: z.string().min(1).max(256) })
        .strict()
        .parse(body);
      services.store.transaction(() => {
        services.store.delete("spaces", id);
        services.store.delete("space-confirmations", id);
        services.store.put("removed-spaces", id, { id });
      });
      respond(response, 200, { removed: true });
      return;
    }
    if (
      url.pathname === "/v1/admin/remove-connection" &&
      request.method === "PUT"
    ) {
      const { id } = z
        .object({ id: z.string().min(1).max(100) })
        .strict()
        .parse(body);
      if (!services.store.get("connections", id))
        throw new Error(imText(locale, "connectionMissing"));
      services.store.transaction(() => {
        for (const namespace of ["native-groups", "spaces"]) {
          for (const space of services.store.list<CollaborationSpace>(
            namespace,
          )) {
            if (
              !space.endpoints.some((endpoint) => endpoint.connectionId === id)
            )
              continue;
            services.store.delete(namespace, space.id);
            services.store.delete("space-confirmations", space.id);
            services.store.delete("native-group-info", space.id);
            services.store.put("removed-spaces", space.id, { id: space.id });
            services.store.db
              .prepare(
                "UPDATE queue SET state='cancelled' WHERE state IN ('pending','processing','sending') AND json_extract(payload,'$.conversation.spaceId')=?",
              )
              .run(space.id);
          }
        }
        for (const group of services.store.list<{
          conversation: ImConversation;
        }>("observed-groups")) {
          if (group.conversation.connectionId === id)
            services.store.delete(
              "observed-groups",
              imConversationKey(group.conversation),
            );
        }
        services.store.delete("connections", id);
        // Retain only the ID so queued/history routes can never target a replacement bot.
        services.store.put("removed-connections", id, { id });
        for (const { identity } of services.store.list<{
          identity: ImIdentity;
        }>("identities")) {
          if (identity.connectionId !== id) continue;
          const key = imIdentityKey(identity);
          services.store.delete("identities", key);
          services.store.delete("direct-routes", key);
        }
        for (const pending of services.store.list<{
          deviceId: string;
          identity: ImIdentity;
        }>("pairing-requests"))
          if (pending.identity.connectionId === id)
            services.store.delete("pairing-requests", pending.deviceId);
      });
      const adapter = services.adapters.get(id);
      services.adapters.delete(id);
      adapter?.stop();
      respond(response, 200, { removed: true });
      return;
    }
    if (url.pathname === "/v1/admin/connections" && request.method === "PUT") {
      const config =
        body?.channel === "slack"
          ? await resolveSlackConnection(body)
          : body?.channel === "feishu"
            ? channelConnectionSchema.parse(
                await resolveFeishuConnection(body, locale),
              )
            : channelConnectionSchema.parse(body);
      if (services.store.get("removed-connections", config.id))
        throw new Error(imText(locale, "connectionRemoved"));
      const previous = services.store.get<{ sealed: string }>(
        "connections",
        config.id,
      );
      if (previous) {
        const current = services.store.unseal<ChannelConnection>(
          previous.sealed,
        );
        const applicationId = (connection: ChannelConnection) =>
          connection.channel === "wecom" ? connection.botId : connection.appId;
        if (
          current.channel !== config.channel ||
          current.tenantId !== config.tenantId ||
          applicationId(current) !== applicationId(config) ||
          (current.channel === "feishu" &&
            config.channel === "feishu" &&
            (current.domain ?? "feishu") !== (config.domain ?? "feishu"))
        )
          throw new Error(imText(locale, "connectionIdentity"));
      }
      const conflicts = services.store
        .list<{ sealed: string }>("connections")
        .map((item) => services.store.unseal<ChannelConnection>(item.sealed))
        .some(
          (item) =>
            item.id !== config.id &&
            item.channel === config.channel &&
            (item.channel === "wecom" && config.channel === "wecom"
              ? item.botId === config.botId
              : item.channel !== "wecom" &&
                config.channel !== "wecom" &&
                item.appId === config.appId),
        );
      if (conflicts)
        throw new Error("This bot is already owned by another connection.");
      services.store.put("connections", config.id, {
        id: config.id,
        sealed: services.store.seal(config),
      });
      services.install(config);
      respond(response, 200, { saved: true });
      return;
    }
    if (
      url.pathname === "/v1/admin/spaces" ||
      url.pathname === "/v1/admin/remove-space-member"
    ) {
      respond(response, 410, {
        error: imText(locale, "manualOnly"),
      });
      return;
    }
    if (
      url.pathname === "/v1/admin/refresh-group-members" &&
      request.method === "PUT"
    ) {
      const { spaceId } = z
        .object({ spaceId: z.string() })
        .strict()
        .parse(body);
      const group = services.store.get<CollaborationSpace>(
        "native-groups",
        spaceId,
      );
      if (!group?.nativeGroup?.enabled) throw new Error("Group unavailable.");
      services.visibleGroups.set(group.id, Date.now() + 30000);
      services.presenceRefreshAt = 0;
      await services.metadataJob;
      services.metadataJob = services
        .refreshNativeGroupInfo(spaceId)
        .finally(() => {
          services.metadataJob = undefined;
        });
      await services.metadataJob;
      await services.tick();
      await services.presenceJob;
      respond(response, 200, { refreshed: true });
      return;
    }
    if (
      url.pathname === "/v1/admin/native-group-member" &&
      request.method === "PUT"
    ) {
      const input = z
        .object({
          spaceId: z.string(),
          identity: imIdentitySchema,
          allowed: z.boolean(),
        })
        .strict()
        .parse(body);
      const group = services.store.get<CollaborationSpace>(
        "native-groups",
        input.spaceId,
      );
      const roster = services.store.get<{ roster?: ImGroupRoster }>(
        "native-group-info",
        input.spaceId,
      )?.roster;
      const member = roster?.members.find(
        (m) => imIdentityKey(m.identity) === imIdentityKey(input.identity),
      );
      if (
        !group ||
        !member ||
        member.kind === "unknown" ||
        member.self ||
        imIdentityKey(group.participants[0]!.identity) ===
          imIdentityKey(input.identity)
      )
        throw new Error("Only other identified group members can be changed.");
      const key = JSON.stringify([group.id, imIdentityKey(input.identity)]);
      if (input.allowed) services.store.delete("group-denied-senders", key);
      else services.store.put("group-denied-senders", key, true);
      if (member.kind === "bot") {
        services.router.native.setMemberAssignment(
          group.id,
          member.identity.userId,
          input.allowed,
        );
        services.router.native.syncRoster(group.id);
      }
      respond(response, 200, { allowed: input.allowed });
      return;
    }
    if (
      url.pathname === "/v1/admin/native-authorization" &&
      request.method === "PUT"
    ) {
      respond(response, 200, authorizeNativeGroup(services.store, body));
      return;
    }
    if (url.pathname === "/v1/admin/native-group" && request.method === "PUT") {
      const group = saveNativeGroup(services.store, body);
      respond(response, 200, group);
      return;
    }
    if (
      url.pathname === "/v1/admin/refresh-groups" &&
      request.method === "PUT"
    ) {
      retireKnownGroups(services.store);
      await services.refreshDiscoveredGroupNames(true);
      respond(response, 200, { refreshed: true });
      return;
    }
    if (url.pathname === "/v1/admin/status" && request.method === "GET") {
      respond(response, 200, {
        connections: [...services.adapters.values()].map((a) =>
          a.status(locale),
        ),
        spaces: services.store
          .list<CollaborationSpace>("native-groups")
          .map((space) => ({
            ...space,
            confirmed: !!services.router.findSpace(space.endpoints[0]!),
          })),
        securityVersion: IM_SECURITY_VERSION,
        authorizationVersion: 1,
        identities: services.store.list("identities"),
        groups: services.store
          .list<{ conversation: ImConversation }>("observed-groups")
          .map((group) => {
            const stored = services.store.get<{ sealed: string }>(
              "connections",
              group.conversation.connectionId,
            );
            const config = stored
              ? services.store.unseal<ChannelConnection>(stored.sealed)
              : undefined;
            return {
              ...group,
              platform:
                config?.channel === "feishu"
                  ? config.domain === "lark"
                    ? "lark"
                    : "feishu"
                  : config?.channel,
            };
          }),
        devices: services.store
          .list<{ id: string; name: string; revoked: boolean }>("devices")
          .map(({ id, name, revoked }) => ({ id, name, revoked })),
        deliveries: services.store.db
          .prepare(
            "SELECT state,COUNT(*) AS count FROM queue WHERE bucket='outgoing' GROUP BY state",
          )
          .all(),
        ingress: services.store.db
          .prepare(
            "SELECT bucket,state,COUNT(*) AS count FROM queue WHERE bucket IN ('incoming','media','device') GROUP BY bucket,state",
          )
          .all(),
        interactionErrors: [
          ...services.store
            .list<FeishuTyping>("feishu-typing")
            .filter((item) => item.error)
            .map((item) => ({
              connectionId: item.connectionId,
              kind: "typing",
              error: imText(locale, "typingRetry"),
            })),
          ...services.store
            .list<FeishuApprovalCard>("approval-cards")
            .filter((item) => item.retryAt && !item.closed)
            .map((item) => ({
              connectionId: item.identity.connectionId,
              kind: "approval",
              error: imText(locale, "cardRetry"),
            })),
        ],
      });
      return;
    }
    if (url.pathname === "/v1/admin/revoke" && request.method === "POST") {
      const { deviceId } = z
        .object({ deviceId: z.string().min(1) })
        .strict()
        .parse(body);
      const device = services.store.get<Record<string, unknown>>(
        "devices",
        deviceId,
      );
      if (!device) throw new Error("Unknown device.");
      services.store.put("devices", deviceId, { ...device, revoked: true });
      respond(response, 200, { revoked: true });
      return;
    }
    throw new Error("Unknown administrator operation.");
  };
}

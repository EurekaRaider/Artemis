import { normalizeFeishuGroupEvent } from "./feishu-group-events.js";
import { saveNativeGroup, retireLegacySpaces } from "./native-groups.js";
import {
  IM_SECURITY_VERSION,
  imDeliverySecuritySchema,
  imReplySchema,
} from "@artemis/protocol";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { z } from "zod";
import {
  collaborationCommandSchema,
  imConversationKey,
  imIdentityKey,
  imIdentitySchema,
  type ChannelEvent,
  type CollaborationSpace,
  type ImIdentity,
  type ImConversation,
  type ImGroupRoster,
  type RemoteInvocationContext,
} from "@artemis/protocol";
import { GatewayStore, sameSecret, digest } from "./store.js";
import { GatewayRouter, type Delivery } from "./router.js";
import { resolveSlackConnection, SlackAdapter } from "./slack.js";
import { FeishuSocketAdapter } from "./feishu-socket.js";
import { resolveFeishuConnection } from "./feishu-setup.js";
import type { FeishuTyping } from "./feishu-typing.js";
import {
  normalizeFeishuApproval,
  type FeishuApprovalCard,
} from "./feishu-approval.js";
import {
  ChannelRateLimit,
  ChannelUnavailable,
  DeliveryUncertain,
  FeishuAdapter,
  WecomAdapter,
  channelConnectionSchema,
  normalizeFeishu,
  verifyFeishu,
  type ChannelAdapter,
  type ChannelConnection,
} from "./channels.js";

export interface GatewayOptions {
  databasePath: string;
  encryptionKey: string;
  adminToken: string;
  adapterFactory?: (
    config: ChannelConnection,
    receive: (event: ChannelEvent) => void,
  ) => ChannelAdapter;
}
async function readBody(request: IncomingMessage): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > (request.url === "/v1/device/artifacts" ? 14 : 2) * 1024 * 1024)
      throw new Error("Request exceeds 2 MiB.");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
function respond(response: ServerResponse, code: number, body: unknown): void {
  response.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

/** Single-instance, durable HTTP transport. Desktop polling only claims work after local persistence. */
export class ArtemisGateway {
  readonly store: GatewayStore;
  readonly router: GatewayRouter;
  readonly server = createServer((request, response) => {
    void this.handle(request, response).catch((error) => {
      if (!response.headersSent)
        respond(response, 400, {
          error: error instanceof Error ? error.message : "Invalid request.",
        });
      else response.destroy();
    });
  });
  private readonly adapters = new Map<string, ChannelAdapter>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private delivering = false;
  private mediaJobs = new Map<string, Promise<void>>();
  constructor(private readonly options: GatewayOptions) {
    if (options.adminToken.length < 32)
      throw new Error(
        "Gateway admin token must contain at least 32 characters.",
      );
    this.store = new GatewayStore(options.databasePath, options.encryptionKey);
    retireLegacySpaces(
      this.store,
      options.databasePath === ":memory:"
        ? undefined
        : `${options.databasePath}.pre-native-groups.sqlite`,
    );
    this.router = new GatewayRouter(this.store);
    this.server.requestTimeout = 35000;
    this.server.headersTimeout = 10000;
    for (const sealed of this.store.list<{ id: string; sealed: string }>(
      "connections",
    ))
      this.install(this.store.unseal<ChannelConnection>(sealed.sealed));
  }
  private receiveChannelEvent(event: ChannelEvent): void {
    if (this.store.get("removed-connections", event.identity.connectionId))
      return;
    this.router.native.observeBot(event);
    if (!this.router.ingest(event)) return;
    if (
      event.identity.channel === "wecom" &&
      event.conversation.kind === "group" &&
      !event.bot
    ) {
      const group = this.router.findSpace(event.conversation);
      const owner = group?.participants[0]?.identity;
      if (
        group &&
        owner?.channel === event.identity.channel &&
        owner.tenantId === event.identity.tenantId &&
        owner.appId === event.identity.appId &&
        event.timestamp >= group.nativeGroup!.enabledAt
      ) {
        const prior = this.store.get<{ roster?: ImGroupRoster }>(
          "native-group-info",
          group.id,
        );
        const members = (prior?.roster?.members ?? []).filter(
          (m) => imIdentityKey(m.identity) !== imIdentityKey(event.identity),
        );
        members.push({
          identity: event.identity,
          name: event.identity.userId,
          kind: "human",
        });
        this.store.put("native-group-info", group.id, {
          ...prior,
          roster: {
            members: members.slice(-10000),
            complete: false,
            error: "partial",
          },
          checkedAt: Date.now(),
        });
      }
    }
    if (
      event.attachments.length &&
      this.store.get("identities", imIdentityKey(event.identity))
    ) {
      this.store.enqueue(
        "media",
        digest(`${event.identity.connectionId}\0${event.messageId}`),
        event.identity.connectionId,
        event,
      );
      this.startMediaJobs();
    }
  }
  private receiveFeishuGroup(
    config: Extract<ChannelConnection, { channel: "feishu" }>,
    value: unknown,
  ): void {
    if (this.store.get("removed-connections", config.id)) return;
    const event = normalizeFeishuGroupEvent(config, value);
    if (!event) return;
    this.store.transaction(() => {
      this.invalidateGroupRoster(config.id, event.chatId);
      if (!event.unavailable) return;
      for (const group of this.store.list<CollaborationSpace>(
        "native-groups",
      )) {
        if (
          !group.nativeGroup?.enabled ||
          event.timestamp < group.nativeGroup.enabledAt ||
          !group.endpoints.some(
            (e) => e.connectionId === config.id && e.id === event.chatId,
          )
        )
          continue;
        this.store.put("native-groups", group.id, {
          ...group,
          revision: randomUUID(),
          nativeGroup: { ...group.nativeGroup, enabled: false },
        });
        this.store.put("native-group-info", group.id, {
          unavailable: event.unavailable,
          checkedAt: Date.now(),
          next: Date.now() + 60000,
        });
        this.store.delete("space-confirmations", group.id);
      }
    });
  }
  private receiveFeishuCard(connectionId: string, value: unknown): boolean {
    const raw = value as {
      event?: { action?: { value?: { artemisApprovalToken?: string } } };
    };
    const key = `${connectionId}:${raw?.event?.action?.value?.artemisApprovalToken ?? ""}`;
    const card = this.store.get<FeishuApprovalCard>("approval-cards", key);
    if (
      !card ||
      card.identity.connectionId !== connectionId ||
      !this.router.canDeliver({
        conversation: card.conversation,
        invocationId: card.invocationId,
        text: "",
      })
    )
      return false;
    const event = normalizeFeishuApproval(value, card);
    if (!event) return false;
    this.store.transaction(() => {
      this.router.ingest(event);
      this.store.put("approval-cards", key, { ...card, consumed: true });
    });
    return true;
  }
  private startMediaJobs(): void {
    for (const item of this.store.pending<ChannelEvent>("media")) {
      if (this.mediaJobs.size >= 4) break;
      if (this.mediaJobs.has(item.id)) continue;
      const operation = this.cacheAttachments(item.payload)
        .then(() => {
          this.store.mark("media", item.id, "done");
        })
        .catch(() => {
          this.store.mark(
            "media",
            item.id,
            item.attempts >= 5 ? "failed" : "pending",
            Date.now() + 5000,
          );
        })
        .finally(() => {
          this.mediaJobs.delete(item.id);
        });
      this.mediaJobs.set(item.id, operation);
    }
  }
  private mediaKey(event: ChannelEvent, index: number): string {
    return JSON.stringify([
      event.identity.connectionId,
      event.messageId,
      index,
    ]);
  }
  private async cacheAttachments(event: ChannelEvent): Promise<void> {
    const adapter = this.adapters.get(event.identity.connectionId);
    if (!adapter) throw new Error("Channel is unavailable.");
    let size = 0;
    for (let index = 0; index < event.attachments.length; index++) {
      const key = this.mediaKey(event, index);
      if (this.store.get("media-cache", key)) continue;
      const media = await adapter.attachment(event, index);
      size += media.data.length;
      if (size > 20 * 1024 * 1024)
        throw new Error("Attachments exceed 20 MiB.");
      this.store.put("media-cache", key, {
        sealed: this.store.seal({
          data: media.data.toString("base64"),
          mimeType: media.mimeType,
          name: media.name,
        }),
        expiresAt: Date.now() + 86400000,
      });
    }
  }
  private install(config: ChannelConnection): void {
    this.adapters.get(config.id)?.stop();
    const receive = (event: ChannelEvent) => {
      this.receiveChannelEvent(event);
    };
    const adapter =
      this.options.adapterFactory?.(config, receive) ??
      (config.channel === "wecom"
        ? new WecomAdapter(config, receive)
        : config.channel === "slack"
          ? new SlackAdapter(config, receive, (channel) =>
              this.invalidateGroupRoster(config.id, channel),
            )
          : config.transport === "websocket"
            ? new FeishuSocketAdapter(
                config,
                receive,
                undefined,
                (value) => {
                  return this.receiveFeishuCard(config.id, value);
                },
                (value) => this.receiveFeishuGroup(config, value),
                (tenantId) => this.persistTenantId(config.id, tenantId),
              )
            : new FeishuAdapter(config));
    this.adapters.set(config.id, adapter);
    adapter.start();
  }
  /** Pin a websocket-adopted tenant key into the sealed connection config. */
  private persistTenantId(id: string, tenantId: string): void {
    const entry = this.store.get<{ sealed: string }>("connections", id);
    if (!entry) return;
    const current = this.store.unseal<ChannelConnection>(entry.sealed);
    if (current.tenantId === tenantId) return;
    this.store.put("connections", id, {
      id,
      sealed: this.store.seal({ ...current, tenantId }),
    });
  }
  async listen(port = 8787, host = "127.0.0.1"): Promise<number> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port, host, () => {
        this.server.off("error", reject);
        resolve();
      });
    });
    this.timer = setInterval(() => {
      void this.tick();
    }, 1000);
    const address = this.server.address();
    if (!address || typeof address === "string")
      throw new Error("Gateway failed to listen.");
    return address.port;
  }
  async close(): Promise<void> {
    clearInterval(this.timer);
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    while (this.delivering)
      await new Promise((resolve) => setTimeout(resolve, 10));
    await this.updateTyping(true);
    for (const adapter of this.adapters.values()) adapter.stop();
    await Promise.allSettled(this.mediaJobs.values());
    this.store.close();
  }
  private identityStillBound(request: RemoteInvocationContext): boolean {
    return this.router.isInvocationAuthorized(request);
  }
  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const url = new URL(request.url ?? "/", "http://gateway.local");
    if (url.pathname.startsWith("/artifacts/") && request.method === "GET") {
      const [, , id, capability] = url.pathname.split("/");
      const artifact = this.store.get<{
        name: string;
        data: string;
        token: string;
        expiresAt: number;
        invocationId: string;
      }>("artifacts", id ?? "");
      const invocation = artifact
        ? this.store.get<RemoteInvocationContext>(
            "invocations",
            artifact.invocationId,
          )
        : undefined;
      if (
        !artifact ||
        artifact.expiresAt <= Date.now() ||
        !sameSecret(capability ?? "", artifact.token) ||
        !invocation ||
        !this.identityStillBound(invocation) ||
        !this.router.securityAllowed(
          this.store.get("invocation-security", invocation.id),
        )
      ) {
        respond(response, 404, {
          error: "Artifact is unavailable or expired.",
        });
        return;
      }
      const data = Buffer.from(artifact.data, "base64");
      response.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(artifact.name)}`,
        "Content-Length": data.length,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      });
      response.end(data);
      return;
    }
    if (request.headers.origin)
      throw new Error("Browser-origin requests are not accepted.");
    if (url.pathname === "/health" && request.method === "GET") {
      respond(response, 200, {
        ok: true,
        version: 1,
        securityVersion: IM_SECURITY_VERSION,
      });
      return;
    }
    if (
      url.pathname.startsWith("/channels/feishu/") &&
      request.method === "POST"
    ) {
      const id = url.pathname.slice("/channels/feishu/".length);
      const entry = this.store.get<{ sealed: string }>("connections", id);
      if (!entry) throw new Error("Unknown channel.");
      const config = channelConnectionSchema.parse(
        this.store.unseal(entry.sealed),
      );
      if (
        config.channel !== "feishu" ||
        !config.enabled ||
        config.transport === "websocket"
      )
        throw new Error("Channel is disabled.");
      const event = verifyFeishu(
        config,
        await readBody(request),
        request.headers,
      );
      if (event.type === "url_verification") {
        respond(response, 200, { challenge: event.challenge });
        return;
      }
      if (event.header?.event_type === "card.action.trigger") {
        const accepted = this.receiveFeishuCard(config.id, event);
        respond(response, 200, {
          toast: {
            type: accepted ? "success" : "error",
            content: accepted
              ? "已提交，请在任务中查看处理结果。"
              : "确认无效、已处理或已过期，请在本人单聊或桌面处理。",
          },
        });
        return;
      }
      this.receiveFeishuGroup(config, event);
      const normalized = normalizeFeishu(config, event);
      if (normalized) this.receiveChannelEvent(normalized);
      // ingest commits before acknowledging the platform.
      respond(response, 200, { code: 0 });
      return;
    }
    const token = request.headers.authorization?.replace(/^Bearer /u, "") ?? "";
    if (url.pathname.startsWith("/v1/admin/")) {
      if (!sameSecret(token, this.options.adminToken)) {
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
        respond(response, 201, this.store.register(input.name));
        return;
      }
      if (
        url.pathname === "/v1/admin/remove-space" &&
        request.method === "PUT"
      ) {
        const { id } = z
          .object({ id: z.string().min(1).max(256) })
          .strict()
          .parse(body);
        this.store.transaction(() => {
          this.store.delete("spaces", id);
          this.store.delete("space-confirmations", id);
          this.store.put("removed-spaces", id, { id });
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
        if (!this.store.get("connections", id))
          throw new Error(
            "机器人连接不存在。 / Bot connection does not exist.",
          );
        this.store.transaction(() => {
          for (const namespace of ["native-groups", "spaces"]) {
            for (const space of this.store.list<CollaborationSpace>(
              namespace,
            )) {
              if (
                !space.endpoints.some(
                  (endpoint) => endpoint.connectionId === id,
                )
              )
                continue;
              this.store.delete(namespace, space.id);
              this.store.delete("space-confirmations", space.id);
              this.store.delete("native-group-info", space.id);
              this.store.put("removed-spaces", space.id, { id: space.id });
              this.store.db
                .prepare(
                  "UPDATE queue SET state='cancelled' WHERE state IN ('pending','processing','sending') AND json_extract(payload,'$.conversation.spaceId')=?",
                )
                .run(space.id);
            }
          }
          for (const group of this.store.list<{ conversation: ImConversation }>(
            "observed-groups",
          )) {
            if (group.conversation.connectionId === id)
              this.store.delete(
                "observed-groups",
                imConversationKey(group.conversation),
              );
          }
          this.store.delete("connections", id);
          // Retain only the ID so queued/history routes can never target a replacement bot.
          this.store.put("removed-connections", id, { id });
          for (const { identity } of this.store.list<{ identity: ImIdentity }>(
            "identities",
          )) {
            if (identity.connectionId !== id) continue;
            const key = imIdentityKey(identity);
            this.store.delete("identities", key);
            this.store.delete("direct-routes", key);
          }
          for (const pending of this.store.list<{
            deviceId: string;
            identity: ImIdentity;
          }>("pairing-requests"))
            if (pending.identity.connectionId === id)
              this.store.delete("pairing-requests", pending.deviceId);
        });
        const adapter = this.adapters.get(id);
        this.adapters.delete(id);
        adapter?.stop();
        respond(response, 200, { removed: true });
        return;
      }
      if (
        url.pathname === "/v1/admin/connections" &&
        request.method === "PUT"
      ) {
        const config =
          body?.channel === "slack"
            ? await resolveSlackConnection(body)
            : body?.channel === "feishu"
              ? channelConnectionSchema.parse(
                  await resolveFeishuConnection(body),
                )
              : channelConnectionSchema.parse(body);
        if (this.store.get("removed-connections", config.id))
          throw new Error(
            "此连接 ID 已移除，请使用新的连接 ID。 / This connection ID was removed. Use a new connection ID.",
          );
        const previous = this.store.get<{ sealed: string }>(
          "connections",
          config.id,
        );
        if (previous) {
          const current = this.store.unseal<ChannelConnection>(previous.sealed);
          const applicationId = (connection: ChannelConnection) =>
            connection.channel === "wecom"
              ? connection.botId
              : connection.appId;
          if (
            current.channel !== config.channel ||
            current.tenantId !== config.tenantId ||
            applicationId(current) !== applicationId(config) ||
            (current.channel === "feishu" &&
              config.channel === "feishu" &&
              (current.domain ?? "feishu") !== (config.domain ?? "feishu"))
          )
            throw new Error(
              "连接 ID 已绑定到指定平台、企业和机器人。更换机器人请使用新的连接 ID，避免历史消息被送到另一个账号。",
            );
        }
        const conflicts = this.store
          .list<{ sealed: string }>("connections")
          .map((item) => this.store.unseal<ChannelConnection>(item.sealed))
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
        this.store.put("connections", config.id, {
          id: config.id,
          sealed: this.store.seal(config),
        });
        this.install(config);
        respond(response, 200, { saved: true });
        return;
      }
      if (
        url.pathname === "/v1/admin/spaces" ||
        url.pathname === "/v1/admin/remove-space-member"
      ) {
        respond(response, 410, {
          error: "跨 IM 协作空间已退役。请在本机启用原生 IM 群。",
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
        const group = this.store.get<CollaborationSpace>(
          "native-groups",
          spaceId,
        );
        if (!group?.nativeGroup?.enabled) throw new Error("Group unavailable.");
        this.invalidateGroupRoster(
          group.endpoints[0]!.connectionId,
          group.endpoints[0]!.id,
        );
        await this.tick();
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
        const group = this.store.get<CollaborationSpace>(
          "native-groups",
          input.spaceId,
        );
        const roster = this.store.get<{ roster?: ImGroupRoster }>(
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
          throw new Error(
            "Only other identified group members can be changed.",
          );
        const key = JSON.stringify([group.id, imIdentityKey(input.identity)]);
        if (input.allowed) this.store.delete("group-denied-senders", key);
        else this.store.put("group-denied-senders", key, true);
        if (member.kind === "bot") {
          this.router.native.setMemberAssignment(
            group.id,
            member.identity.userId,
            input.allowed,
          );
          this.router.native.syncRoster(group.id);
        }
        respond(response, 200, { allowed: input.allowed });
        return;
      }
      if (
        url.pathname === "/v1/admin/native-group" &&
        request.method === "PUT"
      ) {
        const group = saveNativeGroup(this.store, body);
        respond(response, 200, group);
        return;
      }
      if (
        url.pathname === "/v1/admin/refresh-groups" &&
        request.method === "PUT"
      ) {
        await this.refreshDiscoveredGroupNames(true);
        respond(response, 200, { refreshed: true });
        return;
      }
      if (url.pathname === "/v1/admin/status" && request.method === "GET") {
        respond(response, 200, {
          connections: [...this.adapters.values()].map((a) => a.status()),
          spaces: this.store
            .list<CollaborationSpace>("native-groups")
            .map((space) => ({
              ...space,
              confirmed: !!this.router.findSpace(space.endpoints[0]!),
            })),
          securityVersion: IM_SECURITY_VERSION,
          identities: this.store.list("identities"),
          groups: this.store
            .list<{ conversation: ImConversation }>("observed-groups")
            .map((group) => {
              const stored = this.store.get<{ sealed: string }>(
                "connections",
                group.conversation.connectionId,
              );
              const config = stored
                ? this.store.unseal<ChannelConnection>(stored.sealed)
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
          devices: this.store
            .list<{ id: string; name: string; revoked: boolean }>("devices")
            .map(({ id, name, revoked }) => ({ id, name, revoked })),
          deliveries: this.store.db
            .prepare(
              "SELECT state,COUNT(*) AS count FROM queue WHERE bucket='outgoing' GROUP BY state",
            )
            .all(),
          ingress: this.store.db
            .prepare(
              "SELECT bucket,state,COUNT(*) AS count FROM queue WHERE bucket IN ('incoming','media','device') GROUP BY bucket,state",
            )
            .all(),
          interactionErrors: [
            ...this.store
              .list<FeishuTyping>("feishu-typing")
              .filter((item) => item.error)
              .map((item) => ({
                connectionId: item.connectionId,
                kind: "typing",
                error: item.error,
              })),
            ...this.store
              .list<FeishuApprovalCard>("approval-cards")
              .filter((item) => item.retryAt && !item.closed)
              .map((item) => ({
                connectionId: item.identity.connectionId,
                kind: "approval",
                error: "审批卡片更新待重试，请检查消息更新权限和网络。",
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
        const device = this.store.get<Record<string, unknown>>(
          "devices",
          deviceId,
        );
        if (!device) throw new Error("Unknown device.");
        this.store.put("devices", deviceId, { ...device, revoked: true });
        respond(response, 200, { revoked: true });
        return;
      }
      throw new Error("Unknown administrator operation.");
    }
    const deviceId = request.headers["x-artemis-device"];
    if (
      typeof deviceId !== "string" ||
      !this.store.authenticate(deviceId, token)
    ) {
      respond(response, 401, { error: "Device authentication failed." });
      return;
    }
    const sessionId = request.headers["x-artemis-session"];
    if (typeof sessionId !== "string" || !/^[a-f0-9-]{36}$/iu.test(sessionId))
      throw new Error("Device session is required.");
    const lease = this.store.get<{ sessionId: string; expiresAt: number }>(
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
      this.store.delete("device-leases", deviceId);
      respond(response, 200, { released: true });
      return;
    }
    if (
      request.headers["x-artemis-security-version"] !==
        String(IM_SECURITY_VERSION) &&
      this.store.get("device-security", deviceId)
    )
      this.store.put("device-security", deviceId, {
        version: IM_SECURITY_VERSION,
        grants: [],
      });
    const leaseUntil = Date.now() + 45000;
    this.store.put("device-leases", deviceId, {
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
        removedConnections: this.store
          .list<{ id: string }>("removed-connections")
          .map((entry) => entry.id),
        identities: this.store
          .list<{ deviceId: string; identity: ImIdentity }>("identities")
          .filter((b) => b.deviceId === deviceId)
          .map((b) => b.identity),
        pairingRequests: this.store.pairingRequests(deviceId),
        connections: [...this.adapters.values()].map((a) => {
          const status = a.status();
          const stored = this.store.get<{ sealed: string }>(
            "connections",
            status.id,
          );
          const config = stored
            ? this.store.unseal<ChannelConnection>(stored.sealed)
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
        spaces: this.store
          .list<CollaborationSpace>("native-groups")
          .filter((s) => s.participants.some((p) => p.deviceId === deviceId))
          .map((s) => ({
            ...s,
            confirmed: !!this.router.findSpace(s.endpoints[0]!),
            roster: (() => {
              const roster = this.store.get<{ roster?: ImGroupRoster }>(
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
                          verifiedAt: this.router.native
                            .peers(s.id)
                            .find((peer) => peer.id === m.identity.userId)
                            ?.verifiedAt,
                          verificationPendingUntil:
                            this.router.native.pendingProbeUntil(
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
                      !this.store.get(
                        "group-denied-senders",
                        JSON.stringify([s.id, imIdentityKey(m.identity)]),
                      ),
                  })),
                }
              );
            })(),
            participants: s.participants.map((p) => {
              const device = this.store.get<{ name: string; revoked: boolean }>(
                "devices",
                p.deviceId,
              );
              const paired =
                this.store.get<{ deviceId: string }>(
                  "identities",
                  imIdentityKey(p.identity),
                )?.deviceId === p.deviceId;
              const online =
                (this.store.get<{ expiresAt: number }>(
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
      this.router.processIncoming();
      const requests = this.store
        .pending<RemoteInvocationContext>("device", Date.now(), deviceId)
        .filter((item) => {
          if (
            item.payload.expiresAt > Date.now() &&
            this.identityStillBound(item.payload)
          )
            return true;
          this.store.mark("device", item.id, "expired");
          this.router.queueDelivery(`expired:${item.id}`, {
            conversation: item.payload.conversation,
            text: "任务已过期或授权已撤销，未向桌面执行器投递。",
          });
          return false;
        })
        .map((item) => item.payload);
      respond(response, 200, { requests });
      return;
    }
    if (url.pathname === "/v1/device/attachment" && request.method === "GET") {
      const invocation = this.store.get<RemoteInvocationContext>(
        "invocations",
        url.searchParams.get("invocationId") ?? "",
      );
      if (
        !invocation ||
        invocation.deviceId !== deviceId ||
        invocation.expiresAt <= Date.now() ||
        !this.identityStillBound(invocation)
      )
        throw new Error("Attachment is not authorized.");
      const adapter = this.adapters.get(invocation.identity.connectionId);
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
      let cached = this.store.get<{ sealed: string; expiresAt: number }>(
        "media-cache",
        this.mediaKey(channelEvent, index),
      );
      if (!cached || cached.expiresAt <= Date.now()) {
        await this.cacheAttachments(channelEvent);
        cached = this.store.get(
          "media-cache",
          this.mediaKey(channelEvent, index),
        );
      }
      if (!cached)
        throw new Error("Attachment could not be preserved. Please resend it.");
      const stored = this.store.unseal<{
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
      this.store.put("device-security", deviceId, policy);
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
        this.store.transaction(() =>
          this.router.groupConversationContext(deviceId, input.spaceId),
        ),
      );
      return;
    }
    if (url.pathname === "/v1/device/artifacts") {
      const input = z
        .object({
          security: imDeliverySecuritySchema,
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
      this.router.acceptSecurity(deviceId, input.invocationId, input.security);
      const invocation = this.store.get<RemoteInvocationContext>(
        "invocations",
        input.invocationId,
      );
      if (
        !invocation ||
        invocation.deviceId !== deviceId ||
        invocation.expiresAt <= Date.now() ||
        !this.identityStillBound(invocation) ||
        !/^\/publish\s/u.test(invocation.text) ||
        invocation.originator
      )
        throw new Error(
          "Only an explicit owner publish command can upload an artifact.",
        );
      if (invocation.conversation.kind === "group") {
        const group = this.router.findSpace(invocation.conversation);
        if (
          !group?.nativeGroup ||
          group.nativeGroup.ownerDeviceId !== deviceId ||
          !this.adapters.get(invocation.conversation.connectionId)?.publish
        )
          throw new Error("Native file publication is unavailable.");
        const bytes = Buffer.from(input.data, "base64");
        if (!bytes.length || bytes.length > 10 * 1024 * 1024)
          throw new Error("File must be between 1 byte and 10 MiB.");
        const id = `${deviceId}:${input.invocationId}`;
        const hash = createHash("sha256").update(bytes).digest("hex");
        const old = this.store.get<{ hash: string; name: string }>(
          "native-files",
          id,
        );
        if (old && (old.hash !== hash || old.name !== input.name))
          throw new Error("Publication ID already used for a different file.");
        this.store.transaction(() => {
          if (!old)
            this.store.put("native-files", id, {
              id,
              hash,
              name: input.name,
              sealed: this.store.seal({ name: input.name, data: input.data }),
            });
          this.router.queueDelivery(`file:${id}`, {
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
      const old = this.store.get<{
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
      this.store.put("artifacts", input.invocationId, artifact);
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
        code: this.store.pairCode(
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
      this.store.transaction(() => {
        const pending = this.store.resolvePairRequest(
          deviceId,
          input.requestId,
          input.approve,
        );
        this.router.queueDelivery(`pairing:${pending.id}:resolved`, {
          conversation: pending.conversation,
          text: input.approve
            ? "配对成功。发送 /projects 选择项目，/help 查看操作。"
            : "配对请求已拒绝。如需重新配对，请在 Artemis 生成新的配对码。",
        });
      });
      respond(response, 200, { resolved: true });
      return;
    }
    if (url.pathname === "/v1/device/unpair") {
      const identity = imIdentitySchema.parse(body);
      const key = imIdentityKey(identity);
      if (
        this.store.get<{ deviceId: string }>("identities", key)?.deviceId !==
        deviceId
      )
        throw new Error("Identity belongs to another device.");
      this.store.delete("identities", key);
      this.store.delete("direct-routes", key);
      respond(response, 200, { unpaired: true });
      return;
    }
    if (url.pathname === "/v1/device/ack") {
      const { id } = z
        .object({ id: z.string().min(1) })
        .strict()
        .parse(body);
      this.router.acknowledge(deviceId, id);
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
      this.router.native.localTaskDeleted(
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
      const group = this.store.get<CollaborationSpace>(
        "native-groups",
        input.groupId,
      );
      if (group?.nativeGroup?.ownerDeviceId !== deviceId)
        throw new Error("Group does not belong to this device.");
      if (input.operation === "announce" || input.operation === "probe")
        this.router.native.probe(
          group.id,
          input.operation === "probe" ? input.peer : undefined,
        );
      if (input.operation === "authorize")
        this.router.native.authorize(group.id, input.peers ?? []);
      respond(response, 200, {
        version: 1,
        peers: this.router.native.peers(group.id),
        tasks: this.router.native.tasks(group.id),
        history: this.store
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
          security: imDeliverySecuritySchema,
        })
        .strict()
        .parse(body);
      this.router.acceptSecurity(deviceId, input.invocationId, input.security);
      const request = this.store.get<RemoteInvocationContext>(
        "invocations",
        input.invocationId,
      );
      if (!request || request.deviceId !== deviceId)
        throw new Error("Invocation owner mismatch.");
      respond(
        response,
        200,
        this.router.native.command(
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
      const group = this.store.get<CollaborationSpace>(
        "native-groups",
        groupId,
      );
      if (!group?.nativeGroup || group.nativeGroup.ownerDeviceId !== deviceId)
        throw new Error("Group does not belong to this device.");
      // Read-only history remains available after pause/revocation. Never use
      // client-supplied queue IDs or local connection IDs as ownership proof.
      const rows = this.store.db
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
          ? this.store.get<RemoteInvocationContext>(
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
        this.router.acceptSecurity(
          deviceId,
          reply.invocationId,
          reply.security,
        );
      this.router.receiveReply(deviceId, reply);
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
      this.router.acceptSecurity(deviceId, input.invocationId, input.security);
      const invocationId = input.desktopTurnId
        ? this.store.transaction(() =>
            this.router.desktopCollaborationContext(
              deviceId,
              input.invocationId,
              input.threadId,
              input.desktopTurnId!,
            ),
          )
        : input.invocationId;
      if (invocationId !== input.invocationId)
        this.router.acceptSecurity(deviceId, invocationId, input.security);
      const key = JSON.stringify([
        deviceId,
        invocationId,
        input.threadId,
        input.id,
      ]);
      const old = this.store.get<{ command: unknown; result: unknown }>(
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
        this.store.get(
          "collaboration-receipts",
          JSON.stringify([deviceId, input.id]),
        )
      )
        throw new Error(
          "Legacy collaboration receipt has no conversation scope. Use a new tool call ID.",
        );
      const result = this.store.transaction(() => {
        const value = this.router.collaborate(
          deviceId,
          invocationId,
          input.threadId,
          input.command,
        );
        this.store.put("collaboration-receipts", key, {
          command: input.command,
          result: value,
        });
        return value;
      });
      respond(response, 200, result);
      return;
    }
    throw new Error("Unknown device operation.");
  }
  async tick(): Promise<void> {
    if (this.delivering) return;
    this.delivering = true;
    try {
      this.router.native.tick();
      await this.refreshNativeGroupInfo();
      await this.refreshDiscoveredGroupNames();
      this.router.processIncoming();
      // Keep publication receipts, but discard encrypted upload bodies once
      // there is no permitted automatic send left (including restart uncertainty).
      for (const file of this.store.list<{ id: string; sealed?: string }>(
        "native-files",
      )) {
        if (!file.sealed) continue;
        const pending = this.store.db
          .prepare(
            "SELECT 1 FROM queue WHERE bucket='outgoing' AND json_extract(payload,'$.fileId')=? AND state IN ('pending','sending') LIMIT 1",
          )
          .get(file.id);
        if (!pending) {
          const { sealed: _sealed, ...receipt } = file;
          this.store.put("native-files", file.id, receipt);
        }
      }
      this.startMediaJobs();
      await this.updateTyping();
      await this.closeApprovalCards();
      this.store.db
        .prepare(
          "DELETE FROM state WHERE namespace IN ('media-cache','artifacts') AND json_extract(value,'$.expiresAt')<=?",
        )
        .run(Date.now());
      this.store.db
        .prepare(
          "DELETE FROM state WHERE namespace='approval-results' AND json_extract(value,'$.expiresAt')<?",
        )
        .run(Date.now() - 7 * 86400000);
      const ready = [...this.adapters.entries()]
        .filter(([, adapter]) => adapter.status().state === "connected")
        .flatMap(([id]) => this.store.outgoing<Delivery>(id));
      for (const item of ready) {
        if (!this.router.canDeliver(item.payload)) {
          this.store.mark("outgoing", item.id, "revoked");
          continue;
        }
        const adapter = this.adapters.get(item.recipient);
        if (!adapter || adapter.status().state !== "connected") continue;
        const route = imConversationKey(item.payload.conversation);
        const throttle = this.store.get<{ next: number }>("throttle", route);
        if (throttle && throttle.next > Date.now()) continue;
        this.store.mark("outgoing", item.id, "sending");
        try {
          const cardKey = item.payload.cardKey
            ? JSON.stringify([
                item.payload.cardKey,
                route,
                item.payload.conversation.spaceRevision ?? "",
              ])
            : undefined;
          const card = cardKey
            ? this.store.get<{
                messageId: string;
                createdAt: number;
                cardId?: string;
                sequence?: number;
                streaming?: boolean;
              }>("status-cards", cardKey)
            : undefined;
          let messageId: string | undefined;
          const approval = item.payload.approval;
          if (item.payload.native) {
            if (!adapter.sendNative)
              throw new Error(
                "Native bot messaging is unavailable on this connection.",
              );
            messageId = await adapter.sendNative(
              item.payload.conversation,
              item.payload.text,
              item.id,
              item.payload.native.recipient,
            );
          } else if (item.payload.fileId) {
            const file = this.store.get<{ sealed?: string }>(
              "native-files",
              item.payload.fileId,
            );
            if (!file?.sealed || !adapter.publish)
              throw new Error("Native file is unavailable.");
            const content = this.store.unseal<{ name: string; data: string }>(
              file.sealed,
            );
            messageId = await adapter.publish(
              item.payload.conversation,
              { name: content.name, data: Buffer.from(content.data, "base64") },
              item.id,
              () => {
                if (!this.router.canDeliver(item.payload))
                  throw new Error(
                    "File publication authorization was revoked.",
                  );
              },
            );
          } else if (
            approval &&
            adapter.approvalCard &&
            item.payload.invocationId
          ) {
            const request = this.store.get<RemoteInvocationContext>(
              "invocations",
              item.payload.invocationId,
            )!;
            const approvalKey = `${item.recipient}:${approval.token}`;
            const issued = this.store.get<FeishuApprovalCard>(
              "approval-cards",
              approvalKey,
            );
            if (
              !approval.resolved &&
              this.store.get("approval-results", approvalKey)
            ) {
              this.store.mark("outgoing", item.id, "done");
              continue;
            }
            if (approval.resolved || approval.expiresAt <= Date.now()) {
              // A terminal update has no buttons. Persist its closed state before
              // attempting the patch, so callbacks cannot race a slow platform API.
              if (issued) {
                // The router has already invalidated callbacks at receipt time.
                if (!issued.approval.resolved)
                  this.store.put("approval-cards", approvalKey, {
                    ...issued,
                    approval,
                    consumed: true,
                    closed: false,
                  });
              } else {
                messageId = await adapter.send(
                  item.payload.conversation,
                  item.payload.text,
                  `${item.id}:text`,
                );
              }
            } else if (!issued) {
              let interactive = false;
              try {
                messageId = await adapter.approvalCard(
                  item.payload.conversation,
                  item.payload.text,
                  item.id,
                  approval,
                );
                interactive = true;
              } catch (error) {
                if (
                  error instanceof ChannelRateLimit ||
                  error instanceof ChannelUnavailable ||
                  error instanceof DeliveryUncertain
                )
                  throw error;
                messageId = await adapter.send(
                  item.payload.conversation,
                  `按钮卡片不可用，请使用下方文字指令。\n${item.payload.text}`,
                  `${item.id}:text`,
                );
              }
              // Keep persistence outside the confirmed-card-rejection fallback.
              // A storage failure after a successful send must not send again.
              if (interactive && messageId)
                this.store.put("approval-cards", approvalKey, {
                  approval,
                  identity: request.identity,
                  conversation: item.payload.conversation,
                  invocationId: request.id,
                  messageId,
                } satisfies FeishuApprovalCard);
            }
          } else if (cardKey && item.payload.stream && adapter.streamCard) {
            const current =
              card && card.createdAt > Date.now() - 13 * 86400000
                ? card
                : undefined;
            let streamed:
              | {
                  messageId: string;
                  createdAt: number;
                  cardId?: string;
                  sequence?: number;
                  streaming?: boolean;
                }
              | undefined;
            try {
              streamed = await adapter.streamCard(
                item.payload.conversation,
                item.payload.text,
                item.id,
                current,
              );
            } catch (error) {
              if (
                error instanceof ChannelRateLimit ||
                error instanceof ChannelUnavailable ||
                error instanceof DeliveryUncertain
              )
                throw error;
              // A confirmed streaming rejection (missing CardKit permission,
              // unsupported card) degrades to the shared status card path.
            }
            if (streamed) {
              this.store.put("status-cards", cardKey, streamed);
              messageId = streamed.messageId;
            } else if (adapter.statusCard) {
              try {
                messageId = await adapter.statusCard(
                  item.payload.conversation,
                  item.payload.text,
                  item.id,
                  current?.messageId,
                );
                this.store.put("status-cards", cardKey, {
                  messageId,
                  createdAt: current?.createdAt ?? Date.now(),
                });
              } catch (error) {
                if (
                  error instanceof ChannelRateLimit ||
                  error instanceof ChannelUnavailable ||
                  error instanceof DeliveryUncertain
                )
                  throw error;
                messageId = await adapter.send(
                  item.payload.conversation,
                  item.payload.text,
                  `${item.id}:text`,
                );
              }
            }
          } else if (cardKey && adapter.statusCard) {
            try {
              const current =
                card && card.createdAt > Date.now() - 13 * 86400000
                  ? card
                  : undefined;
              messageId = await adapter.statusCard(
                item.payload.conversation,
                item.payload.text,
                item.id,
                current?.messageId,
              );
              this.store.put("status-cards", cardKey, {
                messageId,
                createdAt: current?.createdAt ?? Date.now(),
              });
            } catch (error) {
              if (
                error instanceof ChannelRateLimit ||
                error instanceof ChannelUnavailable ||
                error instanceof DeliveryUncertain
              )
                throw error;
              // A confirmed card rejection can fall back to text; an uncertain send must never be replayed.
              messageId = await adapter.send(
                item.payload.conversation,
                item.payload.text,
                `${item.id}:text`,
              );
            }
          } else
            messageId = await adapter.send(
              item.payload.conversation,
              item.payload.text,
              item.id,
              item.payload.mentionUserId,
            );
          this.store.transaction(() => {
            this.store.mark("outgoing", item.id, "done");
            this.store.put("throttle", route, { next: Date.now() + 4000 });
            if (messageId && item.payload.invocationId) {
              const request = this.store.get<RemoteInvocationContext>(
                "invocations",
                item.payload.invocationId,
              );
              if (request)
                this.store.put(
                  "message-map",
                  `${item.recipient}:${messageId}`,
                  { deviceId: request.deviceId, taskId: item.payload.taskId },
                );
            }
          });
        } catch (error) {
          const retry =
            error instanceof ChannelRateLimit ||
            error instanceof ChannelUnavailable;
          this.store.mark(
            "outgoing",
            item.id,
            !this.router.canDeliver(item.payload)
              ? "revoked"
              : retry && item.attempts < 100
                ? "pending"
                : error instanceof DeliveryUncertain
                  ? "uncertain"
                  : "failed",
            Date.now() +
              (error instanceof ChannelRateLimit
                ? Math.max(1, error.seconds) * 1000
                : Math.min(300000, 5000 * 2 ** Math.min(item.attempts, 6))),
          );
        }
      }
    } finally {
      this.delivering = false;
    }
  }
  private groupNameRefresh: Promise<void> | undefined;
  private refreshDiscoveredGroupNames(force = false): Promise<void> {
    if (this.groupNameRefresh)
      return force
        ? this.groupNameRefresh.then(() =>
            this.refreshDiscoveredGroupNames(true),
          )
        : this.groupNameRefresh;
    const pending = this.queryDiscoveredGroupNames(force).finally(() => {
      this.groupNameRefresh = undefined;
    });
    this.groupNameRefresh = pending;
    return pending;
  }
  private async queryDiscoveredGroupNames(force: boolean): Promise<void> {
    type Observed = {
      conversation: ImConversation;
      identities: ImIdentity[];
      lastSeenAt: number;
      name?: string;
      nameNextCheck?: number;
      nameError?: string;
      nameCheckedAt?: number;
    };
    const candidates = this.store
      .list<Observed>("observed-groups")
      .filter((group) => {
        const adapter = this.adapters.get(group.conversation.connectionId);
        const due =
          force && group.nameError !== "rate-limited"
            ? (group.nameCheckedAt ?? 0) + 5000 <= Date.now()
            : (group.nameNextCheck ?? 0) <= Date.now();
        return (
          !!adapter?.groupInfo && adapter.status().state === "connected" && due
        );
      })
      .slice(0, force ? 3 : 1);
    await Promise.all(
      candidates.map(async (group) => {
        const adapter = this.adapters.get(group.conversation.connectionId)!;
        const key = imConversationKey(group.conversation);
        this.store.put("observed-groups", key, {
          ...group,
          nameNextCheck: Date.now() + 60000,
          nameCheckedAt: Date.now(),
        });
        try {
          const info = await adapter.groupInfo!(group.conversation);
          const current = this.store.get<Observed>("observed-groups", key);
          if (
            current &&
            this.adapters.get(group.conversation.connectionId) === adapter
          ) {
            this.store.put("observed-groups", key, {
              ...current,
              ...(info.name?.trim() ? { name: info.name.trim() } : {}),
              nameError: info.name
                ? undefined
                : (info.nameError ?? info.unavailable ?? "lookup-failed"),
              nameNextCheck: Date.now() + 60000,
            });
          }
        } catch (error) {
          const current = this.store.get<Observed>("observed-groups", key);
          if (current)
            this.store.put("observed-groups", key, {
              ...current,
              nameError:
                error instanceof ChannelRateLimit
                  ? "rate-limited"
                  : "lookup-failed",
              nameNextCheck:
                Date.now() +
                (error instanceof ChannelRateLimit
                  ? Math.max(60, error.seconds) * 1000
                  : 60000),
            });
        }
      }),
    );
  }
  private invalidateGroupRoster(connectionId: string, channel: string): void {
    for (const group of this.store.list<CollaborationSpace>("native-groups")) {
      if (
        !group.nativeGroup?.enabled ||
        !group.endpoints.some(
          (e) => e.connectionId === connectionId && e.id === channel,
        )
      )
        continue;
      const prior = this.store.get<{ next: number; checkedAt?: number }>(
        "native-group-info",
        group.id,
      );
      // Coalesce event bursts and panel opens without bypassing provider backoff.
      if (prior && prior.next > Date.now() + 60000) continue;
      this.store.put("native-group-info", group.id, {
        ...prior,
        next: Math.max(Date.now(), (prior?.checkedAt ?? 0) + 10000),
      });
    }
  }
  private async refreshNativeGroupInfo(): Promise<void> {
    for (const group of this.store.list<CollaborationSpace>("native-groups")) {
      const endpoint = group.endpoints[0];
      const adapter = endpoint && this.adapters.get(endpoint.connectionId);
      if (
        !group.nativeGroup?.enabled ||
        !adapter?.groupInfo ||
        adapter.status().state !== "connected"
      )
        continue;
      const prior = this.store.get<{ next: number; roster?: ImGroupRoster }>(
        "native-group-info",
        group.id,
      );
      if (prior && prior.next > Date.now()) continue;
      this.store.put("native-group-info", group.id, {
        ...prior,
        next: Date.now() + 60000,
      });
      try {
        const [info, roster] = await Promise.all([
          adapter.groupInfo(endpoint!),
          adapter.groupMembers?.(endpoint!),
        ]);
        // Feishu's member endpoint excludes bots. Keep only bot identities
        // learned from authenticated events; they remain untrusted for dispatch.
        if (roster && endpoint && adapter instanceof FeishuAdapter) {
          const observed = this.store.get<{ roster?: ImGroupRoster }>(
            "native-group-info",
            group.id,
          )?.roster;
          const ids = new Set(roster.members.map((m) => m.identity.userId));
          for (const member of observed?.members ?? []) {
            if (
              member.kind === "bot" &&
              !ids.has(member.identity.userId) &&
              roster.members.length < 10000
            ) {
              roster.members.push(member);
              ids.add(member.identity.userId);
            }
          }
        }
        // Do not commit a late lookup over an authorization edit or a removed adapter.
        const current = this.store.get<CollaborationSpace>(
          "native-groups",
          group.id,
        );
        if (
          !current ||
          current.revision !== group.revision ||
          this.adapters.get(endpoint!.connectionId) !== adapter
        )
          return;
        this.store.transaction(() => {
          this.store.put("native-group-info", group.id, {
            ...info,
            ...(roster ? { roster } : {}),
            checkedAt: Date.now(),
            next: Date.now() + 60000,
          });
          this.store.put("native-groups", group.id, {
            ...current,
            ...(info.name ? { name: info.name } : {}),
            ...(info.unavailable
              ? {
                  revision: randomUUID(),
                  nativeGroup: { ...current.nativeGroup, enabled: false },
                }
              : {}),
          });
          if (info.unavailable)
            this.store.delete("space-confirmations", group.id);
        });
        if (!info.unavailable) this.router.native.syncRoster(group.id);
      } catch (error) {
        this.store.put("native-group-info", group.id, {
          ...(prior?.roster
            ? {
                roster: {
                  ...prior.roster,
                  complete: false,
                  error: "unavailable",
                },
              }
            : {}),
          next:
            Date.now() +
            (error instanceof ChannelRateLimit
              ? Math.max(60, error.seconds) * 1000
              : 60000),
        });
      }
      // Bounded work per tick; no full-list burst against a platform API.
      return;
    }
  }
  private async closeApprovalCards(): Promise<void> {
    for (const card of this.store.list<FeishuApprovalCard>("approval-cards")) {
      const key = `${card.identity.connectionId}:${card.approval.token}`;
      if (card.approval.expiresAt < Date.now() - 7 * 86400000) {
        this.store.delete("approval-cards", key);
        continue;
      }
      const revoked = !this.router.canDeliver({
        conversation: card.conversation,
        invocationId: card.invocationId,
        text: "",
      });
      const expired = card.approval.expiresAt <= Date.now();
      if (
        (!card.consumed && !expired && !revoked) ||
        card.closed ||
        (card.retryAt ?? 0) > Date.now()
      )
        continue;
      const adapter = this.adapters.get(card.identity.connectionId);
      if (!adapter?.statusCard || adapter.status().state !== "connected")
        continue;
      const text = revoked
        ? "授权已撤销，请在桌面查看。"
        : card.approval.resolved === "approved"
          ? "已批准一次。"
          : card.approval.resolved === "denied"
            ? "已拒绝。"
            : expired
              ? "审批已过期，请在桌面查看。"
              : "已提交，等待桌面确认。";
      try {
        await adapter.statusCard(
          card.conversation,
          text,
          `${key}:closed`,
          card.messageId,
        );
        const current = this.store.get<FeishuApprovalCard>(
          "approval-cards",
          key,
        );
        if (!current) continue;
        this.store.put("approval-cards", key, {
          ...current,
          consumed: true,
          closed: current.approval.resolved === card.approval.resolved,
          retryAt: undefined,
        });
      } catch {
        // Patching a known message is idempotent. Failed updates remain pending;
        // identity, expiry and desktop one-shot checks already deny reuse.
        this.store.put("approval-cards", key, {
          ...(this.store.get<FeishuApprovalCard>("approval-cards", key) ??
            card),
          retryAt: Date.now() + 30000,
        });
      }
    }
  }
  private async updateTyping(stopping = false): Promise<void> {
    for (const activity of this.store.list<FeishuTyping>("feishu-typing")) {
      const key = `${activity.connectionId}:${activity.messageId}`;
      const adapter = this.adapters.get(activity.connectionId);
      if (!adapter?.typing) {
        this.store.delete("feishu-typing", key);
        continue;
      }
      const active =
        !stopping &&
        activity.active &&
        activity.expiresAt > Date.now() &&
        adapter.status().state !== "disabled" &&
        this.router.canDeliver({ ...activity, text: "" });
      if (active && activity.reactionId) continue;
      if (!stopping && (activity.retryAt ?? 0) > Date.now()) continue;
      try {
        const reactionId = await adapter.typing(
          activity.messageId,
          active,
          activity.reactionId,
        );
        const current = this.store.get<FeishuTyping>("feishu-typing", key);
        if (active || current?.active !== activity.active)
          this.store.put("feishu-typing", key, {
            ...(current ?? activity),
            reactionId,
            error: undefined,
            retryAt: undefined,
          });
        else this.store.delete("feishu-typing", key);
      } catch {
        this.store.put("feishu-typing", key, {
          ...(this.store.get<FeishuTyping>("feishu-typing", key) ?? activity),
          ...(stopping ? { active: false } : {}),
          retryAt: Date.now() + 30000,
          error: "Typing 更新失败，请检查消息表情权限和网络。",
        });
      }
    }
  }
}

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
  imConversationSchema,
  imIdentityKey,
  imIdentitySchema,
  type ChannelEvent,
  type CollaborationSpace,
  type ImIdentity,
  type RemoteInvocationContext,
} from "@artemis/protocol";
import { GatewayStore, sameSecret, digest } from "./store.js";
import { GatewayRouter, type Delivery } from "./router.js";
import { resolveSlackConnection, SlackAdapter } from "./slack.js";
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

const spaceSchema = z
  .object({
    id: z.string().regex(/^[\w-]{1,100}$/u),
    name: z.string().min(1).max(100),
    endpoints: z.array(imConversationSchema).min(1).max(8),
    participants: z
      .array(
        z
          .object({
            deviceId: z.string().min(1),
            identity: imIdentitySchema,
            name: z.string().min(1).max(100),
          })
          .strict(),
      )
      .min(1)
      .max(50),
    administrators: z.array(imIdentitySchema).min(1).max(50),
  })
  .strict();
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
    this.router = new GatewayRouter(this.store);
    this.server.requestTimeout = 35000;
    this.server.headersTimeout = 10000;
    for (const sealed of this.store.list<{ id: string; sealed: string }>(
      "connections",
    ))
      this.install(this.store.unseal<ChannelConnection>(sealed.sealed));
  }
  private receiveChannelEvent(event: ChannelEvent): void {
    if (!this.router.ingest(event)) return;
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
          ? new SlackAdapter(config, receive)
          : new FeishuAdapter(config));
    this.adapters.set(config.id, adapter);
    adapter.start();
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
    for (const adapter of this.adapters.values()) adapter.stop();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    while (this.delivering)
      await new Promise((resolve) => setTimeout(resolve, 10));
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
        !this.identityStillBound(invocation)
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
      respond(response, 200, { ok: true, version: 1 });
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
      if (config.channel !== "feishu" || !config.enabled)
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
        url.pathname === "/v1/admin/connections" &&
        request.method === "PUT"
      ) {
        const config =
          body?.channel === "slack"
            ? await resolveSlackConnection(body)
            : channelConnectionSchema.parse(body);
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
            applicationId(current) !== applicationId(config)
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
      if (url.pathname === "/v1/admin/spaces" && request.method === "PUT") {
        const config = spaceSchema.parse(body);
        if (
          new Set(config.endpoints.map(imConversationKey)).size !==
            config.endpoints.length ||
          config.endpoints.some(
            (e) => e.kind !== "group" || !this.adapters.has(e.connectionId),
          )
        )
          throw new Error(
            "Space endpoints must be unique configured group channels.",
          );
        if (
          this.store
            .list<CollaborationSpace>("spaces")
            .some(
              (s) =>
                s.id !== config.id &&
                s.endpoints.some((e) =>
                  config.endpoints.some(
                    (c) => imConversationKey(c) === imConversationKey(e),
                  ),
                ),
            )
        )
          throw new Error("A group can belong to only one space.");
        if (
          config.endpoints.some(
            (e) =>
              !config.administrators.some(
                (a) => a.connectionId === e.connectionId,
              ),
          )
        )
          throw new Error(
            "Each endpoint needs an explicitly designated group administrator.",
          );
        for (const participant of config.participants) {
          if (
            this.store.get<{ deviceId: string }>(
              "identities",
              imIdentityKey(participant.identity),
            )?.deviceId !== participant.deviceId
          )
            throw new Error(
              "Pair every participant before configuring a space.",
            );
        }
        this.store.transaction(() => {
          this.store.put("spaces", config.id, {
            ...config,
            revision: randomUUID(),
          });
          this.store.put("space-confirmations", config.id, []);
        });
        respond(response, 200, {
          saved: true,
          instruction: `Each designated administrator must @ the bot in their group and send /space-confirm ${config.id}. Changes invalidate all prior confirmations.`,
        });
        return;
      }
      if (url.pathname === "/v1/admin/status" && request.method === "GET") {
        respond(response, 200, {
          connections: [...this.adapters.values()].map((a) => a.status()),
          spaces: this.store.list("spaces"),
          identities: this.store.list("identities"),
          groups: this.store.list("observed-groups"),
          devices: this.store
            .list<{ id: string; name: string; revoked: boolean }>("devices")
            .map(({ id, name, revoked }) => ({ id, name, revoked })),
          deliveries: this.store.db
            .prepare(
              "SELECT state,COUNT(*) AS count FROM queue WHERE bucket='outgoing' GROUP BY state",
            )
            .all(),
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
    const leaseUntil = Date.now() + 45000;
    this.store.put("device-leases", deviceId, {
      sessionId,
      expiresAt: leaseUntil,
    });
    response.setHeader("X-Artemis-Lease-Until", String(leaseUntil));
    if (url.pathname === "/v1/device/status" && request.method === "GET") {
      respond(response, 200, {
        identities: this.store
          .list<{ deviceId: string; identity: ImIdentity }>("identities")
          .filter((b) => b.deviceId === deviceId)
          .map((b) => b.identity),
        connections: [...this.adapters.values()].map((a) => a.status()),
        spaces: this.store
          .list<CollaborationSpace>("spaces")
          .filter((s) => s.participants.some((p) => p.deviceId === deviceId))
          .map((s) => ({
            ...s,
            confirmed: !!this.router.findSpace(s.endpoints[0]!),
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
    if (url.pathname === "/v1/device/artifacts") {
      const input = z
        .object({
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
      const old = this.store.get<{
        id: string;
        token: string;
        expiresAt: number;
        sha256: string;
      }>("artifacts", input.invocationId);
      const data = Buffer.from(input.data, "base64");
      if (data.length > 10 * 1024 * 1024)
        throw new Error("Artifact exceeds 10 MiB.");
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
      respond(response, 200, {
        code: this.store.pairCode(deviceId),
        expiresIn: 300,
      });
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
    if (url.pathname === "/v1/device/reply") {
      this.router.receiveReply(deviceId, body);
      respond(response, 200, { accepted: true });
      return;
    }
    if (url.pathname === "/v1/device/collaborate") {
      const input = z
        .object({
          id: z.string().min(1).max(256),
          invocationId: z.string().min(1),
          threadId: z.string().min(1),
          command: collaborationCommandSchema,
        })
        .strict()
        .parse(body);
      const key = JSON.stringify([deviceId, input.id]);
      const old = this.store.get("collaboration-receipts", key);
      if (old) {
        respond(response, 200, old);
        return;
      }
      const result = this.store.transaction(() => {
        const value = this.router.collaborate(
          deviceId,
          input.invocationId,
          input.threadId,
          input.command,
        );
        this.store.put("collaboration-receipts", key, value);
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
      this.router.processIncoming();
      this.startMediaJobs();
      this.store.db
        .prepare(
          "DELETE FROM state WHERE namespace IN ('media-cache','artifacts') AND json_extract(value,'$.expiresAt')<=?",
        )
        .run(Date.now());
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
            ? this.store.get<{ messageId: string; createdAt: number }>(
                "status-cards",
                cardKey,
              )
            : undefined;
          let messageId: string | undefined;
          if (cardKey && adapter.statusCard) {
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
            retry && item.attempts < 100
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
}

import { decodeNativeEnvelope } from "./native-protocol.js";
import { formatSlackMarkdown } from "./slack-format.js";
import { createHash } from "node:crypto";
import WebSocket from "ws";
import {
  channelEventSchema,
  type ChannelEvent,
  type ImConversation,
  type ImGroupRoster,
} from "@artemis/protocol";
import {
  boundedResponse,
  channelConnectionSchema,
  ChannelRateLimit,
  ChannelUnavailable,
  DeliveryUncertain,
  validateMentionUserId,
  type ChannelAdapter,
  type ChannelConnection,
  type ChannelStatus,
} from "./channels.js";

type SlackConnection = Extract<ChannelConnection, { channel: "slack" }>;
const setupSchema = channelConnectionSchema.options[2]
  .partial({ tenantId: true, appId: true, botUserId: true })
  .extend({
    id: channelConnectionSchema.options[2].shape.id.default("slack"),
    name: channelConnectionSchema.options[2].shape.name.default("Slack"),
  });
const record = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const string = (value: unknown): string =>
  typeof value === "string" ? value : "";
const commands =
  "pair|help|projects|project|new|tasks|continue|status|stop|approve|answer|publish|unsubscribe|space-confirm|agents|ask";
const commandInput = new RegExp(`^(${commands})(?=\\s|$)`, "u");
const commandOutput = new RegExp(
  `(^|[\\s\x60（(：:])/(?:${commands})(?=\\s|$|[\x60。，：:])`,
  "gu",
);

class SlackApiError extends Error {
  constructor(readonly code: string) {
    super(`Slack: ${code}. Check the app permissions and tokens.`);
  }
}
async function slackApi(
  method: string,
  token: string,
  body: Record<string, unknown> = {},
  delivery = false,
  signal?: AbortSignal,
): Promise<Record<string, any>> {
  signal?.throwIfAborted();
  const uncertain = () =>
    delivery
      ? new DeliveryUncertain("Slack delivery could not be confirmed.")
      : new ChannelUnavailable("Slack is temporarily unavailable.");
  let response: Response;
  try {
    const readOnly =
      method === "bots.info" ||
      method === "files.info" ||
      method === "conversations.info" ||
      method === "conversations.members" ||
      method === "users.info" ||
      method === "users.getPresence";
    const query = readOnly
      ? `?${new URLSearchParams(Object.entries(body).map(([key, value]) => [key, String(value)]))}`
      : "";
    response = await fetch(`https://slack.com/api/${method}${query}`, {
      method: readOnly ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      ...(readOnly ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
    });
  } catch {
    throw uncertain();
  }
  if (response.status === 429)
    throw new ChannelRateLimit(
      Number(response.headers.get("retry-after")) || 30,
    );
  if (response.status >= 500) throw uncertain();
  let result: Record<string, any>;
  try {
    result = record(await response.json());
  } catch {
    throw uncertain();
  }
  if (result.error === "ratelimited") throw new ChannelRateLimit(30);
  if (
    [
      "internal_error",
      "fatal_error",
      "request_timeout",
      "service_unavailable",
    ].includes(result.error)
  )
    throw uncertain();
  if (!response.ok || result.ok !== true) {
    const code = /^[a-z_]{1,80}$/u.test(string(result.error))
      ? result.error
      : "invalid_response";
    throw new SlackApiError(code);
  }
  return result;
}

/** Workspace, application and bot IDs come from Slack, never from an unverified form. */
export async function resolveSlackConnection(
  input: unknown,
  signal?: AbortSignal,
): Promise<SlackConnection> {
  const setup = setupSchema.parse(input);
  const auth = await slackApi("auth.test", setup.botToken, {}, false, signal);
  if (!string(auth.team_id) || !string(auth.user_id) || !string(auth.bot_id))
    throw new Error("Slack requires a workspace bot token.");
  const info = record(
    (
      await slackApi(
        "bots.info",
        setup.botToken,
        { bot: auth.bot_id },
        false,
        signal,
      )
    ).bot,
  );
  if (!string(info.app_id) || info.user_id !== auth.user_id || info.deleted)
    throw new Error("Slack bot identity could not be verified.");
  const identity = {
    tenantId: auth.team_id as string,
    appId: info.app_id as string,
    botUserId: auth.user_id as string,
  };
  for (const field of ["tenantId", "appId", "botUserId"] as const)
    if (setup[field] && setup[field] !== identity[field])
      throw new Error("Slack token identity does not match this connection.");
  return { ...setup, ...identity };
}

export function normalizeSlack(
  config: SlackConnection,
  value: unknown,
): ChannelEvent | undefined {
  const payload = record(value),
    event = record(payload.event);
  if (
    payload.type !== "event_callback" ||
    payload.team_id !== config.tenantId ||
    payload.api_app_id !== config.appId
  )
    return undefined;
  if (
    !string(event.user) ||
    ((event.bot_id || event.bot_profile) &&
      !string(event.text).includes("ARTEMIS-IM/1:")) ||
    event.user === config.botUserId ||
    (event.subtype && !["file_share", "bot_message"].includes(event.subtype))
  )
    return undefined;
  const direct = event.type === "message" && event.channel_type === "im";
  const mention = `<@${config.botUserId}>`;
  const rawText = string(event.text).trim();
  const addressee = /^<@([^>]+)>/u.exec(rawText)?.[1];
  // A leading mention addresses the request; later mentions are task subjects.
  if (
    !direct &&
    !event.bot_id &&
    !event.bot_profile &&
    addressee &&
    addressee !== config.botUserId
  )
    return undefined;
  if (
    !direct &&
    !(event.type === "app_mention" && string(event.text).includes(mention)) &&
    !(
      event.type === "message" &&
      event.bot_id &&
      string(event.text).includes("ARTEMIS-IM/1:")
    )
  )
    return undefined;
  let text = (
    rawText.startsWith(mention) ? rawText.slice(mention.length) : rawText
  )
    .trim()
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
  // Slash commands are intercepted by the Slack composer. Accept ordinary message commands instead.
  text = text.replace(commandInput, "/$1");
  const attachments = (Array.isArray(event.files) ? event.files : []).map(
    (value: unknown) => {
      const file = record(value);
      return {
        resourceId: string(file.id),
        name: string(file.name) || "attachment",
        kind: string(file.mimetype).startsWith("image/") ? "image" : "file",
      };
    },
  );
  if (!text && !attachments.length) return undefined;
  const result = channelEventSchema.safeParse({
    version: 1,
    messageId: payload.event_id,
    identity: {
      channel: "slack",
      connectionId: config.id,
      tenantId: config.tenantId,
      appId: config.appId,
      userId: event.user,
    },
    conversation: {
      connectionId: config.id,
      kind: direct ? "direct" : "group",
      id: event.channel,
    },
    text,
    timestamp: Math.floor(Number(event.ts) * 1000),
    mentioned: true,
    bot: !!event.bot_id,
    ...(string(event.thread_ts) ? { replyTo: event.thread_ts } : {}),
    attachments,
  });
  return result.success ? result.data : undefined;
}

export class SlackAdapter implements ChannelAdapter {
  private readonly heartbeatThreads = new Map<string, string>();
  private socket: WebSocket | undefined;
  private controller: AbortController | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private helloTimeout: ReturnType<typeof setTimeout> | undefined;
  private state: ChannelStatus["state"] = "disabled";
  private error: string | undefined;
  private retrySeconds = 5;
  private readonly memberProfiles = new Map<
    string,
    {
      name: string;
      kind: "human" | "bot" | "unknown";
      expiresAt: number;
    }
  >();
  private readonly memberPresence = new Map<
    string,
    { presence: "active" | "away" | "unknown"; presenceCheckedAt: number }
  >();
  private presenceRetryAt = 0;
  private async getMemberPresence(user: string, signal: AbortSignal) {
    const cached = this.memberPresence.get(user);
    if (cached && Date.now() - cached.presenceCheckedAt < 60000) return cached;
    const result: {
      presence: "active" | "away" | "unknown";
      presenceCheckedAt: number;
    } = { presence: "unknown", presenceCheckedAt: Date.now() };
    if (Date.now() < this.presenceRetryAt || signal.aborted) return result;
    try {
      const response = await slackApi(
        "users.getPresence",
        this.config.botToken,
        { user },
        false,
        signal,
      );
      if (response.presence === "active" || response.presence === "away")
        result.presence = response.presence;
    } catch (cause) {
      // Presence failure must not discard the roster or imply an offline user.
      this.presenceRetryAt =
        Date.now() +
        (cause instanceof ChannelRateLimit ? Math.max(60, cause.seconds) : 60) *
          1000;
    }
    if (this.memberPresence.size >= 10000)
      this.memberPresence.delete(this.memberPresence.keys().next().value!);
    this.memberPresence.set(user, result);
    return result;
  }
  constructor(
    readonly config: SlackConnection,
    private readonly receive: (event: ChannelEvent) => void,
    private readonly rosterChanged?: (channel: string) => void,
  ) {}
  status(): ChannelStatus {
    return {
      id: this.config.id,
      name: this.config.name,
      channel: "slack",
      state: this.state,
      ...(this.error ? { error: this.error } : {}),
    };
  }
  start(): void {
    if (!this.config.enabled || this.controller) return;
    this.controller = new AbortController();
    void this.connect(this.controller.signal);
  }
  stop(): void {
    this.controller?.abort();
    this.controller = undefined;
    clearTimeout(this.timer);
    clearInterval(this.heartbeat);
    clearTimeout(this.helloTimeout);
    this.state = "disabled";
    this.error = undefined;
    this.socket?.terminate();
    this.socket = undefined;
  }
  private retry(signal: AbortSignal, seconds = this.retrySeconds): void {
    if (signal.aborted) return;
    clearTimeout(this.timer);
    this.retrySeconds = Math.min(this.retrySeconds * 2, 60);
    this.timer = setTimeout(() => void this.connect(signal), seconds * 1000);
  }
  private async connect(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    this.state = "connecting";
    try {
      await resolveSlackConnection(this.config, signal);
      const result = await slackApi(
        "apps.connections.open",
        this.config.appToken,
        {},
        false,
        signal,
      );
      signal.throwIfAborted();
      const url = new URL(string(result.url));
      if (
        url.protocol !== "wss:" ||
        !url.hostname.endsWith(".slack.com") ||
        url.username ||
        url.password
      )
        throw new Error("Slack returned an invalid Socket Mode URL.");
      const socket = new WebSocket(url, {
        maxPayload: 2 * 1024 * 1024,
        handshakeTimeout: 15000,
      });
      this.socket = socket;
      let accepted = false,
        alive = true,
        wrongApp = false;
      this.helloTimeout = setTimeout(() => socket.terminate(), 20000);
      socket.on("pong", () => {
        alive = true;
      });
      socket.on("message", (raw) => {
        if (signal.aborted || wrongApp) return;
        try {
          const message = record(JSON.parse(raw.toString()));
          if (message.type === "hello") {
            clearTimeout(this.helloTimeout);
            if (record(message.connection_info).app_id !== this.config.appId) {
              wrongApp = true;
              this.state = "error";
              this.error =
                "Slack app token and bot token belong to different apps.";
              socket.terminate();
              return;
            }
            accepted = true;
            this.state = "connected";
            this.error = undefined;
            this.retrySeconds = 5;
            clearInterval(this.heartbeat);
            this.heartbeat = setInterval(() => {
              if (!alive) {
                socket.terminate();
                return;
              }
              alive = false;
              if (socket.readyState === WebSocket.OPEN) socket.ping();
            }, 30000);
            return;
          }
          if (message.type === "disconnect") {
            socket.close();
            return;
          }
          if (!accepted || !string(message.envelope_id)) return;
          const event =
            message.type === "events_api"
              ? normalizeSlack(this.config, message.payload)
              : undefined;
          const payload = record(message.payload);
          const membership = record(payload.event);
          if (
            message.type === "events_api" &&
            payload.type === "event_callback" &&
            payload.team_id === this.config.tenantId &&
            payload.api_app_id === this.config.appId &&
            ["member_joined_channel", "member_left_channel"].includes(
              string(membership.type),
            ) &&
            string(membership.channel)
          )
            this.rosterChanged?.(string(membership.channel));
          if (event) this.receive(event);
          // The receiver persists first; a storage failure leaves the envelope unacknowledged for Slack's retry.
          socket.send(JSON.stringify({ envelope_id: message.envelope_id }));
        } catch {
          this.state = "error";
          this.error = "Slack event could not be saved. Reconnecting.";
          socket.close();
        }
      });
      socket.on("error", () => {
        if (!signal.aborted) {
          this.state = "error";
          this.error = "Slack Socket Mode connection failed.";
        }
      });
      socket.on("close", () => {
        clearInterval(this.heartbeat);
        clearTimeout(this.helloTimeout);
        if (signal.aborted || wrongApp) return;
        this.state = "error";
        this.error ??= "Slack disconnected. Reconnecting automatically.";
        this.retry(signal);
      });
    } catch (error) {
      if (signal.aborted) return;
      this.state = "error";
      this.error =
        error instanceof ChannelRateLimit
          ? "Slack rate limit reached. Retrying automatically."
          : error instanceof Error &&
              !error.message.includes(this.config.appToken) &&
              !error.message.includes(this.config.botToken)
            ? error.message
            : "Slack connection failed. Check the app tokens.";
      this.retry(
        signal,
        error instanceof ChannelRateLimit ? error.seconds : this.retrySeconds,
      );
    }
  }
  async sendNative(
    conversation: ImConversation,
    text: string,
    key: string,
    recipient: string,
  ) {
    if (!/^[a-zA-Z0-9_-]+$/u.test(recipient) && recipient !== "*")
      throw new Error("Invalid native bot identity.");
    const frame = decodeNativeEnvelope(text);
    if (!frame || frame.recipient !== recipient)
      throw new Error("Invalid native collaboration message.");
    const labels = {
      hello: "协作机器人已就绪",
      probe: "正在验证协作连接",
      proof: "协作连接已验证",
      delegate: "委派任务",
      continue: "继续任务",
      accepted: "已接收任务",
      note: "补充任务说明",
      progress: "任务进展",
      heartbeat: "任务仍在执行",
      completed: "任务已完成",
      failed: "任务未完成",
      rejected: "任务未接收",
      cancel: "请求取消任务",
      cancelled: "任务已取消",
    };
    const mention = recipient === "*" ? "" : `<@${recipient}> · `;
    const heartbeatKey = `${conversation.id}:${frame.task}`;
    const result = await slackApi(
      "chat.postMessage",
      this.config.botToken,
      {
        channel: conversation.id,
        ...(frame.action === "heartbeat" &&
        this.heartbeatThreads.has(heartbeatKey)
          ? { thread_ts: this.heartbeatThreads.get(heartbeatKey) }
          : {}),
        // Keep the v1 wire text for existing receivers. Slack renders blocks in
        // the channel; text remains its notification/accessibility fallback.
        text: `${recipient === "*" ? "" : `<@${recipient}> `}${text}`,
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: `${mention}${labels[frame.action]}` },
          },
          ...(frame.text.trim()
            ? [
                {
                  type: "section",
                  text: {
                    type: "plain_text",
                    text:
                      Array.from(frame.text).slice(0, 2400).join("") +
                      (Array.from(frame.text).length > 2400 ? "…" : ""),
                    emoji: false,
                  },
                },
              ]
            : []),
        ],
        mrkdwn: true,
        parse: "none",
        unfurl_links: false,
        unfurl_media: false,
        client_msg_id: createHash("sha256")
          .update(key)
          .digest("hex")
          .slice(0, 32)
          .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/u, "$1-$2-$3-$4-$5"),
      },
      true,
    );
    if (!string(result.ts))
      throw new DeliveryUncertain("Slack did not return a message ID.");
    if (
      frame.action === "heartbeat" &&
      !this.heartbeatThreads.has(heartbeatKey)
    )
      this.heartbeatThreads.set(heartbeatKey, string(result.ts));
    if (["completed", "failed", "cancelled", "rejected"].includes(frame.action))
      this.heartbeatThreads.delete(heartbeatKey);
    return string(result.ts);
  }
  async publish(
    conversation: ImConversation,
    file: { name: string; data: Buffer },
    _key: string,
    authorize: () => void,
  ): Promise<undefined> {
    authorize();
    const ticket = await slackApi(
      "files.getUploadURLExternal",
      this.config.botToken,
      { filename: file.name, length: file.data.length },
    );
    const url = new URL(string(ticket.upload_url));
    if (
      url.protocol !== "https:" ||
      url.hostname !== "files.slack.com" ||
      url.port ||
      url.username ||
      url.password ||
      !string(ticket.file_id)
    )
      throw new Error("Slack returned an invalid upload destination.");
    authorize();
    const response = await fetch(url, {
      method: "POST",
      body: new Uint8Array(file.data),
      headers: { "Content-Type": "application/octet-stream" },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    }).catch(() => {
      throw new ChannelUnavailable("Slack file upload is unavailable.");
    });
    if (response.status === 429)
      throw new ChannelRateLimit(
        Number(response.headers.get("retry-after")) || 60,
      );
    if (!response.ok) throw new Error("Slack file upload was rejected.");
    authorize();
    await slackApi(
      "files.completeUploadExternal",
      this.config.botToken,
      {
        files: [{ id: ticket.file_id, title: file.name }],
        channel_id: conversation.id,
      },
      true,
    );
    // The file ID is not a message timestamp and must not enter message-map.
    return undefined;
  }
  async groupMembers(conversation: ImConversation): Promise<ImGroupRoster> {
    const ids = new Set<string>();
    let error: ImGroupRoster["error"];
    let cursor = "";
    const signal = AbortSignal.timeout(10000);
    const classify = (cause: unknown): NonNullable<ImGroupRoster["error"]> =>
      cause instanceof SlackApiError && cause.code === "missing_scope"
        ? "missing-scope"
        : cause instanceof ChannelRateLimit
          ? "rate-limited"
          : "unavailable";
    try {
      for (let page = 0; page < 50; page++) {
        const result = await slackApi(
          "conversations.members",
          this.config.botToken,
          {
            channel: conversation.id,
            limit: 200,
            ...(cursor ? { cursor } : {}),
          },
          false,
          signal,
        );
        if (
          !Array.isArray(result.members) ||
          result.members.some((id: unknown) => typeof id !== "string" || !id)
        )
          throw new ChannelUnavailable("Invalid group membership response.");
        for (const id of result.members) {
          if (ids.size < 10000) ids.add(id);
        }
        const next = string(
          record(result.response_metadata).next_cursor,
        ).trim();
        if (!next) {
          cursor = "";
          break;
        }
        if (next === cursor) {
          error = "partial";
          break;
        }
        cursor = next;
      }
      if (cursor) error = "partial";
    } catch (cause) {
      error = classify(cause);
    }
    const members: ImGroupRoster["members"] = [];
    const userIds = [...ids];
    for (let offset = 0; offset < userIds.length; offset += 8) {
      const batch = await Promise.all(
        userIds.slice(offset, offset + 8).map(async (userId) => {
          let profile = this.memberProfiles.get(userId);
          if ((!profile || profile.expiresAt <= Date.now()) && !error) {
            try {
              const result = await slackApi(
                "users.info",
                this.config.botToken,
                { user: userId },
                false,
                signal,
              );
              const user = record(result.user),
                details = record(user.profile);
              if (user.id !== userId)
                throw new ChannelUnavailable("Member identity mismatch.");
              profile = {
                name: (
                  string(details.display_name).trim() ||
                  string(details.real_name).trim() ||
                  string(user.real_name).trim() ||
                  string(user.name).trim() ||
                  userId
                ).slice(0, 200),
                kind:
                  user.is_bot === true || user.is_app_user === true
                    ? "bot"
                    : user.is_bot === false
                      ? "human"
                      : "unknown",
                expiresAt: Date.now() + 3600000,
              };
              if (this.memberProfiles.size >= 10000)
                this.memberProfiles.delete(
                  this.memberProfiles.keys().next().value!,
                );
              this.memberProfiles.set(userId, profile);
            } catch (cause) {
              error = classify(cause);
            }
          }
          return {
            identity: {
              channel: "slack" as const,
              connectionId: this.config.id,
              tenantId: this.config.tenantId,
              appId: this.config.appId,
              userId,
            },
            ...(await this.getMemberPresence(userId, signal)),
            name: profile?.name ?? userId,
            kind:
              userId === this.config.botUserId
                ? ("bot" as const)
                : (profile?.kind ?? ("unknown" as const)),
            ...(userId === this.config.botUserId ? { self: true } : {}),
          };
        }),
      );
      members.push(...batch);
    }
    return { members, complete: !error, ...(error ? { error } : {}) };
  }
  async groupInfo(conversation: ImConversation) {
    try {
      const result = await slackApi(
        "conversations.info",
        this.config.botToken,
        { channel: conversation.id },
      );
      const channel = record(result.channel);
      if (channel.id !== conversation.id)
        throw new ChannelUnavailable("Group identity was not returned.");
      return {
        ...(string(channel.name)
          ? { name: string(channel.name).slice(0, 100) }
          : {}),
        ...(channel.is_archived === true
          ? { unavailable: "archived" as const }
          : channel.is_member === false
            ? { unavailable: "removed" as const }
            : {}),
      };
    } catch (error) {
      if (error instanceof SlackApiError && error.code === "missing_scope")
        return { nameError: "missing-scope" as const };
      if (
        error instanceof SlackApiError &&
        ["channel_not_found", "access_denied", "not_in_channel"].includes(
          error.code,
        )
      )
        return { unavailable: "access-denied" as const };
      throw error;
    }
  }
  async send(
    conversation: ImConversation,
    text: string,
    key: string,
    mentionUserId?: string,
  ): Promise<string> {
    return this.message(conversation, text, key, undefined, mentionUserId);
  }
  async statusCard(
    conversation: ImConversation,
    text: string,
    key: string,
    messageId?: string,
  ): Promise<string> {
    return this.message(conversation, text, key, messageId);
  }
  private async message(
    conversation: ImConversation,
    text: string,
    key: string,
    messageId?: string,
    mentionUserId?: string,
  ): Promise<string> {
    const bytes = createHash("sha256").update(key).digest().subarray(0, 16);
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = bytes.toString("hex");
    const clientMessageId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    const result = await slackApi(
      messageId ? "chat.update" : "chat.postMessage",
      this.config.botToken,
      {
        channel: conversation.id,
        text:
          (mentionUserId && conversation.kind === "group"
            ? `<@${validateMentionUserId(mentionUserId)}>\n`
            : "") +
          formatSlackMarkdown(text, (value) =>
            value.replace(commandOutput, (match) => match.replace("/", "")),
          ),
        mrkdwn: true,
        parse: "none",
        link_names: false,
        unfurl_links: false,
        unfurl_media: false,
        ...(messageId ? { ts: messageId } : { client_msg_id: clientMessageId }),
      },
      true,
    );
    if (!string(result.ts))
      throw new DeliveryUncertain("Slack did not confirm the message ID.");
    return result.ts;
  }
  async attachment(event: ChannelEvent, index: number) {
    const item = event.attachments[index];
    if (!item) throw new Error("Attachment does not exist.");
    const file = record(
      (
        await slackApi("files.info", this.config.botToken, {
          file: item.resourceId,
        })
      ).file,
    );
    const url = new URL(
      string(file.url_private_download) || string(file.url_private),
    );
    if (
      url.protocol !== "https:" ||
      url.hostname !== "files.slack.com" ||
      url.username ||
      url.password
    )
      throw new Error("Untrusted Slack attachment origin.");
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.config.botToken}` },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    return {
      data: await boundedResponse(response),
      mimeType:
        response.headers.get("content-type")?.split(";")[0] ??
        "application/octet-stream",
      name: item.name,
    };
  }
}

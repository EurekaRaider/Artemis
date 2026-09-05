import { createHash } from "node:crypto";
import WebSocket from "ws";
import {
  channelEventSchema,
  type ChannelEvent,
  type ImConversation,
} from "@artemis/protocol";
import {
  boundedResponse,
  channelConnectionSchema,
  ChannelRateLimit,
  ChannelUnavailable,
  DeliveryUncertain,
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
  "pair|help|projects|project|new|tasks|continue|status|stop|approve|answer|publish|unsubscribe|space-confirm";
const commandInput = new RegExp(`^(${commands})(?=\\s|$)`, "u");
const commandOutput = new RegExp(
  `(^|[\\s\x60（(：:])/(?:${commands})(?=\\s|$|[\x60。，：:])`,
  "gu",
);

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
    const readOnly = method === "bots.info" || method === "files.info";
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
    throw new Error(`Slack: ${code}. Check the app permissions and tokens.`);
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
    event.bot_id ||
    event.bot_profile ||
    event.user === config.botUserId ||
    (event.subtype && event.subtype !== "file_share")
  )
    return undefined;
  const direct = event.type === "message" && event.channel_type === "im";
  const mention = `<@${config.botUserId}>`;
  if (
    !direct &&
    !(event.type === "app_mention" && string(event.text).includes(mention))
  )
    return undefined;
  let text = string(event.text)
    .replaceAll(mention, "")
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
    bot: false,
    ...(string(event.thread_ts) ? { replyTo: event.thread_ts } : {}),
    attachments,
  });
  return result.success ? result.data : undefined;
}

export class SlackAdapter implements ChannelAdapter {
  private socket: WebSocket | undefined;
  private controller: AbortController | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private helloTimeout: ReturnType<typeof setTimeout> | undefined;
  private state: ChannelStatus["state"] = "disabled";
  private error: string | undefined;
  private retrySeconds = 5;
  constructor(
    readonly config: SlackConnection,
    private readonly receive: (event: ChannelEvent) => void,
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
  async send(
    conversation: ImConversation,
    text: string,
    key: string,
  ): Promise<string> {
    return this.message(conversation, text, key);
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
        text: text
          .replace(commandOutput, (value) => value.replace("/", ""))
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;"),
        mrkdwn: false,
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

import { createDecipheriv, createHash, randomUUID } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import WebSocket from "ws";
import { z } from "zod";
import {
  channelEventSchema,
  type ChannelEvent,
  type ImConversation,
} from "@artemis/protocol";
import { sameSecret } from "./store.js";

const base = {
  id: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9_-]+$/),
  name: z.string().min(1).max(100),
  tenantId: z.string().min(1).max(256),
  enabled: z.boolean(),
};
export const channelConnectionSchema = z.discriminatedUnion("channel", [
  z
    .object({
      ...base,
      channel: z.literal("wecom"),
      botId: z.string().min(1),
      secret: z.string().min(1),
    })
    .strict(),
  z
    .object({
      ...base,
      channel: z.literal("feishu"),
      appId: z.string().min(1),
      botOpenId: z.string().min(1),
      appSecret: z.string().min(1),
      verificationToken: z.string().min(1),
      encryptKey: z.string().min(1),
    })
    .strict(),
  z
    .object({
      ...base,
      channel: z.literal("slack"),
      appId: z.string().min(1),
      botUserId: z.string().min(1),
      botToken: z.string().startsWith("xoxb-").max(1024),
      appToken: z.string().startsWith("xapp-").max(1024),
    })
    .strict(),
]);
export type ChannelConnection = z.infer<typeof channelConnectionSchema>;
export interface ChannelStatus {
  id: string;
  name: string;
  channel: ChannelConnection["channel"];
  state: "disabled" | "connecting" | "connected" | "error";
  error?: string;
}
export interface ChannelAdapter {
  status(): ChannelStatus;
  start(): void;
  stop(): void;
  send(
    conversation: ImConversation,
    text: string,
    idempotencyKey: string,
  ): Promise<string | undefined>;
  /** Optional capability: replace a shared task-status card without generating another notification. */
  statusCard?(
    conversation: ImConversation,
    text: string,
    idempotencyKey: string,
    messageId?: string,
  ): Promise<string>;
  attachment(
    event: ChannelEvent,
    index: number,
  ): Promise<{ data: Buffer; mimeType: string; name: string }>;
}
export class ChannelRateLimit extends Error {
  constructor(readonly seconds: number) {
    super("Channel rate limit reached.");
  }
}
export class ChannelUnavailable extends Error {}
export class DeliveryUncertain extends Error {}

function record(value: unknown): Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}
function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function parseObject(value: string): Record<string, any> {
  try {
    return record(JSON.parse(value));
  } catch {
    return {};
  }
}
export function splitImText(value: string, maxBytes = 3500): string[] {
  const parts: string[] = [];
  let part = "";
  let bytes = 0;
  for (const char of value) {
    const size = Buffer.byteLength(char);
    if (bytes + size > maxBytes) {
      parts.push(part);
      part = "";
      bytes = 0;
    }
    part += char;
    bytes += size;
  }
  if (part) parts.push(part);
  return parts;
}

/** Some WeCom file callbacks omit a filename. Recover supported document types before desktop parsing. */
export function wecomAttachmentName(
  name: string,
  data: Buffer,
  disposition: string | null,
): string {
  if (name !== "attachment") return name;
  const encoded = /filename\*=UTF-8''([^;]+)/iu.exec(disposition ?? "")?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      /* Fall through to a plain filename or document signature. */
    }
  }
  const plain = /filename="([^"]+)"/iu.exec(disposition ?? "")?.[1];
  if (plain) return plain;
  if (data.subarray(0, 5).toString() === "%PDF-") return "attachment.pdf";
  if (data.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4]))) {
    for (const [entry, extension] of [
      ["word/document.xml", "docx"],
      ["xl/workbook.xml", "xlsx"],
      ["ppt/presentation.xml", "pptx"],
    ])
      if (data.includes(Buffer.from(entry!))) return `attachment.${extension}`;
  }
  return name; // The desktop still validates UTF-8 text or rejects unsupported binary data.
}

export function normalizeWecom(
  connection: Extract<ChannelConnection, { channel: "wecom" }>,
  value: unknown,
): ChannelEvent | undefined {
  const raw = record(value),
    body = record(raw.body),
    from = record(body.from);
  if (raw.cmd !== "aibot_msg_callback" && raw.cmd !== "aibot_event_callback")
    return undefined;
  if (body.aibotid !== connection.botId || !string(from.userid))
    return undefined;
  let text = string(record(body.text).content);
  const attachments: ChannelEvent["attachments"] = [];
  const add = (kind: "image" | "file", input: unknown) => {
    const item = record(input);
    if (string(item.url))
      attachments.push({
        kind,
        name:
          string(item.filename) ||
          (kind === "image" ? "image.png" : "attachment"),
        resourceId: string(body.msgid),
        url: string(item.url),
        ...(string(item.aeskey) ? { decryptionKey: string(item.aeskey) } : {}),
      });
  };
  if (body.msgtype === "image") add("image", body.image);
  if (body.msgtype === "file") add("file", body.file);
  if (body.msgtype === "mixed")
    for (const item of Array.isArray(record(body.mixed).msg_item)
      ? body.mixed.msg_item
      : []) {
      if (item.msgtype === "text")
        text += `\n${string(record(item.text).content)}`;
      if (item.msgtype === "image") add("image", item.image);
    }
  if (body.msgtype === "event") {
    const event = record(body.event);
    if (event.eventtype !== "template_card_event") return undefined;
    text = string(event.event_key);
  }
  if (!text && !attachments.length) return undefined;
  const result = channelEventSchema.safeParse({
    version: 1,
    messageId: string(body.msgid),
    identity: {
      channel: "wecom",
      connectionId: connection.id,
      tenantId: connection.tenantId,
      appId: connection.botId,
      userId: from.userid,
    },
    conversation: {
      connectionId: connection.id,
      id: body.chattype === "group" ? string(body.chatid) : from.userid,
      kind: body.chattype === "group" ? "group" : "direct",
    },
    text: text.replace(/^@\S+\s*/u, "").trim(),
    timestamp: Date.now(),
    mentioned: true,
    bot: false,
    attachments,
  });
  return result.success ? result.data : undefined;
}

export function verifyFeishu(
  connection: Extract<ChannelConnection, { channel: "feishu" }>,
  raw: string,
  headers: IncomingHttpHeaders,
  now = Date.now(),
): Record<string, any> {
  const timestamp = string(headers["x-lark-request-timestamp"]),
    nonce = string(headers["x-lark-request-nonce"]),
    signature = string(headers["x-lark-signature"]);
  let data = parseObject(raw);
  if (typeof data.encrypt === "string") {
    const encrypted = Buffer.from(data.encrypt, "base64");
    const key = createHash("sha256").update(connection.encryptKey).digest();
    const decipher = createDecipheriv(
      "aes-256-cbc",
      key,
      encrypted.subarray(0, 16),
    );
    data = parseObject(
      Buffer.concat([
        decipher.update(encrypted.subarray(16)),
        decipher.final(),
      ]).toString("utf8"),
    );
  }
  const token = string(data.token) || string(record(data.header).token);
  if (!sameSecret(token, connection.verificationToken))
    throw new Error("Invalid Feishu verification token.");
  // URL verification has no user action; authenticated event delivery additionally requires its raw-body signature.
  if (data.type === "url_verification" && string(data.challenge)) return data;
  if (
    !/^\d+$/u.test(timestamp) ||
    Math.abs(now - Number(timestamp) * 1000) > 300000 ||
    !nonce ||
    !signature
  )
    throw new Error("Missing or expired Feishu signature.");
  const expected = createHash("sha256")
    .update(timestamp + nonce + connection.encryptKey + raw)
    .digest("hex");
  if (!sameSecret(expected, signature.toLowerCase()))
    throw new Error("Invalid Feishu signature.");
  if (
    record(data.header).app_id !== connection.appId ||
    record(data.header).tenant_key !== connection.tenantId
  )
    throw new Error("Feishu app or tenant does not match this connection.");
  return data;
}
export function normalizeFeishu(
  connection: Extract<ChannelConnection, { channel: "feishu" }>,
  value: unknown,
): ChannelEvent | undefined {
  const data = record(value),
    header = record(data.header),
    event = record(data.event),
    message = record(event.message),
    sender = record(event.sender),
    content = parseObject(string(message.content));
  let text = string(content.text),
    messageId = string(message.message_id),
    userId = string(record(sender.sender_id).open_id),
    chatId = string(message.chat_id);
  let mentioned =
    Array.isArray(message.mentions) &&
    message.mentions.some(
      (item: any) => item.id?.open_id === connection.botOpenId,
    );
  if (header.event_type === "card.action.trigger") {
    text = string(record(record(event.action).value).command);
    messageId = string(header.event_id);
    userId = string(record(event.operator).open_id);
    chatId = string(record(event.context).open_chat_id);
    mentioned = true;
  } else if (header.event_type !== "im.message.receive_v1") return undefined;
  for (const mention of Array.isArray(message.mentions) ? message.mentions : [])
    text = text.replaceAll(string(mention.key), "");
  const attachments: ChannelEvent["attachments"] = [];
  if (message.message_type === "image" && string(content.image_key))
    attachments.push({
      kind: "image",
      name: "image.png",
      resourceId: content.image_key,
    });
  if (message.message_type === "file" && string(content.file_key))
    attachments.push({
      kind: "file",
      name: string(content.file_name) || "attachment",
      resourceId: content.file_key,
    });
  const result = channelEventSchema.safeParse({
    version: 1,
    messageId,
    identity: {
      channel: "feishu",
      connectionId: connection.id,
      tenantId: connection.tenantId,
      appId: connection.appId,
      userId,
    },
    conversation: {
      connectionId: connection.id,
      id: chatId,
      kind: message.chat_type === "p2p" ? "direct" : "group",
    },
    text: text.trim(),
    timestamp: Number(message.create_time) || Date.now(),
    mentioned,
    bot: sender.sender_type === "bot",
    ...(string(message.parent_id) ? { replyTo: message.parent_id } : {}),
    attachments,
  });
  return result.success ? result.data : undefined;
}

export async function boundedResponse(response: Response): Promise<Buffer> {
  if (!response.ok)
    throw new Error(`Attachment download failed (${response.status}).`);
  if (Number(response.headers.get("content-length")) > 10 * 1024 * 1024)
    throw new Error("Attachment exceeds 10 MiB.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty attachment response.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 10 * 1024 * 1024)
        throw new Error("Attachment exceeds 10 MiB.");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}

export class FeishuAdapter implements ChannelAdapter {
  private token = "";
  private tokenExpires = 0;
  private error: string | undefined;
  private refresh: ReturnType<typeof setInterval> | undefined;
  private stopped = true;
  constructor(
    readonly config: Extract<ChannelConnection, { channel: "feishu" }>,
  ) {}
  start(): void {
    if (!this.config.enabled) return;
    this.stopped = false;
    const check = () => {
      void this.accessToken()
        .then(() => {
          this.error = undefined;
        })
        .catch(() => {
          this.error =
            "Feishu authentication failed. Check app credentials and tenant access.";
        });
    };
    check();
    this.refresh = setInterval(check, 60000);
  }
  stop(): void {
    this.stopped = true;
    clearInterval(this.refresh);
  }
  status(): ChannelStatus {
    return {
      id: this.config.id,
      name: this.config.name,
      channel: "feishu",
      state: this.stopped
        ? "disabled"
        : this.error
          ? "error"
          : this.tokenExpires > Date.now()
            ? "connected"
            : "connecting",
      ...(this.error ? { error: this.error } : {}),
    };
  }
  private async accessToken(): Promise<string> {
    if (this.token && this.tokenExpires > Date.now()) return this.token;
    const response = await fetch(
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app_id: this.config.appId,
          app_secret: this.config.appSecret,
        }),
        signal: AbortSignal.timeout(10000),
      },
    ).catch(() => {
      throw new ChannelUnavailable(
        "Feishu authentication is temporarily unavailable.",
      );
    });
    const body = record(
      await response.json().catch(() => {
        throw new ChannelUnavailable(
          "Feishu authentication response was incomplete.",
        );
      }),
    );
    if (!response.ok || body.code !== 0 || !string(body.tenant_access_token))
      throw new ChannelUnavailable("Feishu authentication failed.");
    this.token = body.tenant_access_token;
    this.tokenExpires =
      Date.now() + Math.max(0, (Number(body.expire) - 60) * 1000);
    return this.token;
  }
  async send(
    conversation: ImConversation,
    text: string,
    key: string,
  ): Promise<string> {
    return this.message(conversation, { text }, "text", key);
  }
  async statusCard(
    conversation: ImConversation,
    text: string,
    key: string,
    messageId?: string,
  ): Promise<string> {
    return this.message(
      conversation,
      {
        config: { wide_screen_mode: true, update_multi: true },
        header: {
          template: "blue",
          title: { tag: "plain_text", content: "Artemis 任务状态" },
        },
        elements: [{ tag: "div", text: { tag: "plain_text", content: text } }],
      },
      "interactive",
      key,
      messageId,
    );
  }
  private async message(
    conversation: ImConversation,
    content: unknown,
    type: "text" | "interactive",
    key: string,
    messageId?: string,
  ): Promise<string> {
    const token = await this.accessToken();
    let response: Response;
    try {
      response = await fetch(
        messageId
          ? `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(messageId)}`
          : "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id",
        {
          method: messageId ? "PATCH" : "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            content: JSON.stringify(content),
            ...(messageId
              ? {}
              : {
                  receive_id: conversation.id,
                  msg_type: type,
                  uuid: createHash("sha256")
                    .update(key)
                    .digest("hex")
                    .slice(0, 32),
                }),
          }),
          signal: AbortSignal.timeout(15000),
        },
      );
    } catch {
      throw new DeliveryUncertain("Feishu delivery could not be confirmed.");
    }
    if (response.status === 429)
      throw new ChannelRateLimit(
        Number(response.headers.get("retry-after")) || 30,
      );
    if (response.status >= 500)
      throw new DeliveryUncertain(
        "Feishu server failed before confirming delivery.",
      );
    let body: Record<string, any>;
    try {
      body = record(await response.json());
    } catch {
      throw new DeliveryUncertain("Feishu delivery response was incomplete.");
    }
    if (body.code === 230020 || body.code === 99991400)
      throw new ChannelRateLimit(30);
    if (body.code !== 0)
      throw new Error(`Feishu rejected the message (${Number(body.code)}).`);
    const result = messageId || string(record(body.data).message_id);
    if (!result)
      throw new DeliveryUncertain("Feishu did not confirm the message ID.");
    return result;
  }
  async attachment(event: ChannelEvent, index: number) {
    const item = event.attachments[index];
    if (!item) throw new Error("Attachment does not exist.");
    const response = await fetch(
      `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(event.messageId)}/resources/${encodeURIComponent(item.resourceId)}?type=${item.kind}`,
      {
        headers: { Authorization: `Bearer ${await this.accessToken()}` },
        signal: AbortSignal.timeout(30000),
        redirect: "error",
      },
    );
    return {
      data: await boundedResponse(response),
      mimeType:
        response.headers.get("content-type")?.split(";")[0] ??
        "application/octet-stream",
      name: item.name,
    };
  }
}

export class WecomAdapter implements ChannelAdapter {
  private socket: WebSocket | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private stopped = true;
  private connected = false;
  private error: string | undefined;
  private pending = new Map<
    string,
    {
      resolve(): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(
    readonly config: Extract<ChannelConnection, { channel: "wecom" }>,
    private readonly receive: (event: ChannelEvent) => void,
  ) {}
  status(): ChannelStatus {
    return {
      id: this.config.id,
      name: this.config.name,
      channel: "wecom",
      state: this.error
        ? "error"
        : this.stopped
          ? "disabled"
          : this.connected
            ? "connected"
            : "connecting",
      ...(this.error ? { error: this.error } : {}),
    };
  }
  start(): void {
    if (!this.config.enabled) return;
    this.stopped = false;
    this.connect();
  }
  stop(): void {
    this.stopped = true;
    this.connected = false;
    clearTimeout(this.timer);
    clearInterval(this.heartbeat);
    this.socket?.close();
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(
        new DeliveryUncertain("WeCom connection closed before confirmation."),
      );
    }
    this.pending.clear();
  }
  private connect(): void {
    if (this.stopped) return;
    const socket = new WebSocket("wss://openws.work.weixin.qq.com", {
      maxPayload: 2 * 1024 * 1024,
      handshakeTimeout: 10000,
    });
    this.socket = socket;
    socket.on("open", () => {
      void this.command("aibot_subscribe", {
        bot_id: this.config.botId,
        secret: this.config.secret,
      })
        .then(() => {
          this.connected = true;
          this.error = undefined;
          this.heartbeat = setInterval(() => {
            void this.command("ping", {}).catch(() => socket.close());
          }, 30000);
        })
        .catch(() => {
          this.error = "WeCom authentication failed.";
          socket.close();
        });
    });
    socket.on("message", (data) => {
      try {
        const raw = record(JSON.parse(data.toString()));
        const requestId = string(record(raw.headers).req_id);
        const waiter = this.pending.get(requestId);
        if (waiter && raw.errcode !== undefined) {
          clearTimeout(waiter.timer);
          this.pending.delete(requestId);
          if (raw.errcode === 0) waiter.resolve();
          else
            waiter.reject(
              raw.errcode === 45009
                ? new ChannelRateLimit(30)
                : new Error(`WeCom rejected request (${Number(raw.errcode)}).`),
            );
          return;
        }
        if (record(record(raw.body).event).eventtype === "disconnected_event") {
          this.error =
            "Another process owns this bot connection. Stop the competing connection before reconnecting.";
          this.stop();
          return;
        }
        const event = normalizeWecom(this.config, raw);
        if (event) this.receive(event);
      } catch {
        this.error = "Invalid WeCom event.";
      }
    });
    socket.on("error", () => {
      this.error = "WeCom connection failed.";
    });
    socket.on("close", () => {
      this.connected = false;
      clearInterval(this.heartbeat);
      for (const item of this.pending.values()) {
        clearTimeout(item.timer);
        item.reject(
          new DeliveryUncertain("WeCom connection closed before confirmation."),
        );
      }
      this.pending.clear();
      if (!this.stopped) this.timer = setTimeout(() => this.connect(), 5000);
    });
  }
  private command(
    cmd: string,
    body: unknown,
    id: string = randomUUID(),
  ): Promise<void> {
    if (this.socket?.readyState !== WebSocket.OPEN)
      return Promise.reject(new ChannelUnavailable("WeCom is offline."));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new DeliveryUncertain("WeCom response timed out."));
      }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket!.send(JSON.stringify({ cmd, headers: { req_id: id }, body }));
    });
  }
  async send(
    conversation: ImConversation,
    text: string,
    key: string,
  ): Promise<undefined> {
    if (!this.connected) throw new ChannelUnavailable("WeCom is offline.");
    await this.command(
      "aibot_send_msg",
      {
        chatid: conversation.id,
        chat_type: conversation.kind === "direct" ? 1 : 2,
        msgtype: "markdown",
        markdown: { content: text },
      },
      createHash("sha256").update(key).digest("hex").slice(0, 32),
    );
    return undefined;
  }
  async attachment(event: ChannelEvent, index: number) {
    const item = event.attachments[index];
    if (!item?.url) throw new Error("Attachment does not exist.");
    const url = new URL(item.url);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !["qq.com", "qpic.cn", "weixin.qq.com"].some(
        (domain) =>
          url.hostname === domain || url.hostname.endsWith(`.${domain}`),
      )
    )
      throw new Error("Untrusted WeCom attachment origin.");
    const response = await fetch(url, {
      signal: AbortSignal.timeout(30000),
      redirect: "error",
    });
    let data = await boundedResponse(response);
    if (item.decryptionKey) {
      const key = Buffer.from(item.decryptionKey, "base64");
      if (key.length !== 32) throw new Error("Invalid attachment key.");
      const decipher = createDecipheriv(
        "aes-256-cbc",
        key,
        key.subarray(0, 16),
      );
      decipher.setAutoPadding(false);
      data = Buffer.concat([decipher.update(data), decipher.final()]);
      const padding = data.at(-1) ?? 0;
      if (
        padding < 1 ||
        padding > 32 ||
        !data.subarray(-padding).every((byte) => byte === padding)
      )
        throw new Error("Invalid attachment padding.");
      data = data.subarray(0, -padding);
    }
    return {
      data,
      mimeType:
        item.kind === "image" ? "image/png" : "application/octet-stream",
      name: wecomAttachmentName(
        item.name,
        data,
        response.headers.get("content-disposition"),
      ),
    };
  }
}

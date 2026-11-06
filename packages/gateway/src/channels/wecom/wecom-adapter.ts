import { createDecipheriv, createHash, randomUUID } from "node:crypto";
import WebSocket from "ws";
import type { ChannelEvent, ImConversation } from "@artemis/protocol";
import type { ChannelConnection } from "../channel-connection.js";
import type { ChannelStatus, ChannelAdapter } from "../channel-contracts.js";
import {
  DeliveryUncertain,
  ChannelRateLimit,
  ChannelUnavailable,
} from "../channel-errors.js";
import {
  record,
  string,
  validateMentionUserId,
  boundedResponse,
} from "../channel-values.js";
import { normalizeWecom, wecomAttachmentName } from "./wecom-events.js";
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
      resolve(body: Record<string, any>): void;
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
          if (raw.errcode === 0) waiter.resolve(record(raw.body));
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
  ): Promise<Record<string, any>> {
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
  async publish(
    conversation: ImConversation,
    file: { name: string; data: Buffer },
    key: string,
    authorize: () => void,
  ): Promise<undefined> {
    const chunkSize = 512 * 1024;
    authorize();
    const initial = await this.command("aibot_upload_media_init", {
      type: "file",
      filename: file.name,
      total_size: file.data.length,
      total_chunks: Math.ceil(file.data.length / chunkSize),
      md5: createHash("md5").update(file.data).digest("hex"),
    });
    const uploadId = string(initial.upload_id);
    if (!uploadId) throw new Error("WeCom did not return an upload ID.");
    for (let offset = 0; offset < file.data.length; offset += chunkSize) {
      authorize();
      await this.command("aibot_upload_media_chunk", {
        upload_id: uploadId,
        chunk_index: offset / chunkSize,
        base64_data: file.data
          .subarray(offset, offset + chunkSize)
          .toString("base64"),
      });
    }
    authorize();
    const result = await this.command("aibot_upload_media_finish", {
      upload_id: uploadId,
    });
    const mediaId = string(result.media_id);
    if (!mediaId) throw new Error("WeCom did not return a file ID.");
    authorize();
    await this.command(
      "aibot_send_msg",
      { chatid: conversation.id, msgtype: "file", file: { media_id: mediaId } },
      key,
    );
    return undefined;
  }
  async send(
    conversation: ImConversation,
    text: string,
    key: string,
    mentionUserId?: string,
  ): Promise<undefined> {
    if (!this.connected) throw new ChannelUnavailable("WeCom is offline.");
    const mention =
      mentionUserId && conversation.kind === "group"
        ? `<@${validateMentionUserId(mentionUserId)}>\n`
        : "";
    await this.command(
      "aibot_send_msg",
      {
        chatid: conversation.id,
        chat_type: conversation.kind === "direct" ? 1 : 2,
        msgtype: "markdown",
        markdown: { content: mention + text },
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

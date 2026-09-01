// 飞书适配器（证据 E12/E13/E20-E24）
//
// SDK 形状已按 @larksuiteoapi/node-sdk@1.73.0 实际读取核实（2026-09-01）：
// - LarkChannel 高层封装：connect() 内含 bot/v3/info 身份校验 + WSClient
//   （autoReconnect 默认开、SDK 托管 token 生命周期）→ 替代 ggcode 手写
//   fetchTokenWithRetry/tokenRefreshLoop（E12/E23 由 SDK 吸收）
// - LarkChannel 内置安全管线：消息去重 + 锁 + 队列 + bot mention 剥离
//   （stripBotMentions: true）→ manager 侧 dedup 仍保留作第二道防线（E14）
// - outbound.textChunkLimit=28000：SDK 按 markdown 边界切；字节安全由
//   splitMessageBytes（E13，#757 教训）在包内独立保障并被单测覆盖
// - cardAction 事件：SDK normalizeCardAction 归一化（context/open_message_id
//   双形态兼容），value 原样透传 → {appr, decision}（对齐 [G] "choice" 键位）
// - outbound.retry {maxAttempts:2}：429/限流重试由 SDK 托管（E22）
//
// 与 ggcode feishu_adapter.go 的结构对应关系见
// docs/im-support/artemis-im-implementation-plan.md §2.7。

import { Buffer } from "node:buffer";

import * as lark from "@larksuiteoapi/node-sdk";

import type {
  AdapterContext,
  ApprovalCallbackSource,
  IMAdapter,
  InteractiveSender,
  TypingIndicator,
} from "../adapter.js";
import { splitMessageBytes } from "../split.js";
import type {
  ChannelBinding,
  InboundMessage,
  OutboundEvent,
} from "../types.js";

export const FEISHU_MAX_TEXT_BYTES = 28000;

export interface FeishuAdapterOptions {
  appId: string;
  appSecret: string;
  /** "feishu"（默认）| "lark"（海外版，API base 换 open.larksuite.com） */
  domain?: "feishu" | "lark";
  /** 依赖注入缝：测试可注入假 LarkChannel，不触网 */
  channelFactory?: (opts: Record<string, unknown>) => FeishuChannelLike;
}

/** LarkChannel 的最小结构子类型（只声明本适配器用到的方法/事件）。 */
export interface FeishuChannelLike {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  on(handlers: {
    message?: (msg: LarkNormalizedMessage) => void | Promise<void>;
    cardAction?: (evt: LarkCardActionEvent) => void | Promise<void>;
    reject?: (evt: { messageId: string; chatId: string; reason: string }) => void;
    error?: (err: Error) => void;
  }): unknown;
  send(to: string, input: unknown, opts?: unknown): Promise<{ messageId: string }>;
  updateCard(messageId: string, card: object): Promise<void>;
  addReaction(messageId: string, emojiType: string): Promise<string>;
  downloadResource(fileKey: string, type: string): Promise<Buffer>;
  botIdentity?: { openId: string; name: string };
}

export interface LarkNormalizedMessage {
  messageId: string;
  chatId: string;
  chatType: string;
  senderId: string;
  senderName?: string;
  content: string;
  rawContentType: string;
  resources: { type: string; fileKey: string; fileName?: string }[];
  threadId?: string;
}

export interface LarkCardActionEvent {
  messageId: string;
  chatId: string;
  operator: { openId: string; userId?: string; name?: string };
  action: { value: unknown; tag: string };
}

function defaultChannelFactory(opts: Record<string, unknown>): FeishuChannelLike {
  return new lark.LarkChannel(
    opts as unknown as ConstructorParameters<typeof lark.LarkChannel>[0],
  ) as unknown as FeishuChannelLike;
}

export class FeishuAdapter
  implements IMAdapter, TypingIndicator, InteractiveSender, ApprovalCallbackSource
{
  readonly name: string;
  readonly platform = "feishu" as const;

  private readonly opts: FeishuAdapterOptions;
  private readonly channelFactory: (opts: Record<string, unknown>) => FeishuChannelLike;
  private channel: FeishuChannelLike | null = null;
  private approvalCallback:
    | ((event: { approvalId: string; approved: boolean; messageId: string }) => void)
    | null = null;
  /** Typing reaction 去重（证据 E24 / [G] reactionAck）：同一条消息只加一次 */
  private readonly typingReacted = new Set<string>();
  private stopped = false;

  constructor(name: string, opts: FeishuAdapterOptions) {
    if (!opts.appId?.trim()) throw new Error(`Feishu app_id is required for adapter "${name}"`);
    if (!opts.appSecret?.trim()) throw new Error(`Feishu app_secret is required for adapter "${name}"`);
    this.name = name;
    this.opts = opts;
    this.channelFactory = opts.channelFactory ?? defaultChannelFactory;
  }

  async start(ctx: AdapterContext, onInbound: (msg: InboundMessage) => void): Promise<void> {
    this.stopped = false;
    const domain =
      this.opts.domain === "lark" ? lark.Domain.Lark : lark.Domain.Feishu;
    const channel = this.channelFactory({
      appId: this.opts.appId,
      appSecret: this.opts.appSecret,
      domain,
      outbound: {
        // E13/#757：SDK 按字符+markdown 边界切；字节安全由 splitMessageBytes 兜底
        textChunkLimit: FEISHU_MAX_TEXT_BYTES,
        retry: { maxAttempts: 2 }, // E22：429 重试 ≤2 次
      },
    });
    this.channel = channel;

    channel.on({
      message: (msg) => {
        console.warn(
          `[im:${this.name}] inbound msg=${msg.messageId} type=${msg.rawContentType} chat=${msg.chatId} sender=${msg.senderId}`,
        );
        void this.handleMessage(msg, onInbound);
      },
      cardAction: (evt) => this.handleCardAction(evt),
      reject: (evt) => {
        console.warn(
          `[im:${this.name}] message rejected by SDK policy: ${evt.reason} chat=${evt.chatId}`,
        );
      },
      error: (err) => {
        console.warn(`[im:${this.name}] channel error: ${err.message}`);
      },
    });

    ctx.signal.addEventListener("abort", () => {
      void this.stop();
    });

    // connect() 内部：bot/v3/info 身份校验 + WSClient 首连握手；SDK 托管重连
    await channel.connect();
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    const channel = this.channel;
    this.channel = null;
    if (channel) await channel.disconnect();
  }

  private async handleMessage(
    msg: LarkNormalizedMessage,
    onInbound: (msg: InboundMessage) => void,
  ): Promise<void> {
    const attachments: InboundMessage["attachments"] = [];
    // 图片附件（E7/[G] processImageAttachment）：image_key → 下载 → base64
    for (const res of msg.resources) {
      if (res.type !== "image") continue;
      try {
        const data = await this.channel!.downloadResource(res.fileKey, "image");
        if (data.length > 0) {
          attachments.push({
            kind: "image",
            mime: sniffImageMime(data),
            dataBase64: data.toString("base64"),
          });
        }
      } catch {
        // 单张图片下载失败不阻断整条消息（对齐 [G] debug.Log + continue）
      }
    }

    const text = (msg.content ?? "").trim();
    if (text === "" && attachments.length === 0) return;

    onInbound({
      envelope: {
        adapter: this.name,
        platform: "feishu",
        channelId: msg.chatId,
        senderId: msg.senderId,
        senderName: msg.senderName ?? "",
        messageId: msg.messageId,
        ...(msg.threadId ? { threadId: msg.threadId } : {}),
        receivedAt: new Date().toISOString(),
      },
      text,
      attachments,
    });
  }

  /** 卡片回调（审批按钮）。value 结构 {appr, decision}，对齐 [G] "choice" 键位。 */
  private handleCardAction(evt: LarkCardActionEvent): void {
    const value = evt.action?.value;
    if (!value || typeof value !== "object") return;
    const { appr, decision } = value as { appr?: unknown; decision?: unknown };
    if (typeof appr !== "string" || appr === "") return;
    if (decision !== "y" && decision !== "n") return;
    this.approvalCallback?.({
      approvalId: appr,
      approved: decision === "y",
      messageId: evt.messageId,
    });
  }

  onApprovalCallback(
    cb: (event: { approvalId: string; approved: boolean; messageId: string }) => void,
  ): void {
    this.approvalCallback = cb;
  }

  async send(binding: ChannelBinding, event: OutboundEvent): Promise<void> {
    const channel = this.channel;
    if (!channel) throw new Error(`Feishu bot "${this.name}" is not online`);

    switch (event.kind) {
      case "text":
      case "status":
      case "tool_detail":
      case "tool_summary": {
        const text = outboundText(event);
        if (!text) return;
        // E13：包内字节安全分片兜底（SDK 的 textChunkLimit 按字符切）
        for (const chunk of splitMessageBytes(text, FEISHU_MAX_TEXT_BYTES)) {
          // 首选 markdown 渲染（SDK 内置 card 2.0 转换；失败时 SDK 降级 text）
          await channel.send(binding.channelId, { markdown: chunk });
        }
        return;
      }
      case "approval_request":
        await this.sendApprovalButtons(binding, event);
        return;
      case "approval_resolved": {
        // 由 im-service 在拿到 platformMsgId 后走 updateCardForResolution；
        // 无卡片上下文时降级为文本通知
        const label = event.approved ? "✅ 已批准" : "❌ 已拒绝";
        const by = event.respondedBy ? `（由 ${event.respondedBy} 操作）` : "";
        await channel.send(binding.channelId, { text: `${label}${by}` });
        return;
      }
    }
  }

  /** InteractiveSender：Card 2.0 + column_set 按钮组（[G] SendInteractive 结构移植） */
  async sendApprovalButtons(
    binding: ChannelBinding,
    event: Extract<OutboundEvent, { kind: "approval_request" }>,
  ): Promise<string> {
    const channel = this.channel;
    if (!channel) throw new Error(`Feishu bot "${this.name}" is not online`);
    const card = buildApprovalCard(event);
    const result = await channel.send(binding.channelId, { card });
    return result.messageId;
  }

  /** 审批终态回写原卡片（按钮移除）。由 im-service 以 platformMsgId 调用。 */
  async updateCardForResolution(
    platformMsgId: string,
    event: Extract<OutboundEvent, { kind: "approval_resolved" }>,
  ): Promise<void> {
    const channel = this.channel;
    if (!channel) return;
    const label = event.approved ? "✅ 已批准" : "❌ 已拒绝";
    const by = event.respondedBy ? `（由 ${event.respondedBy} 操作）` : "";
    await channel.updateCard(platformMsgId, {
      schema: "2.0",
      config: { wide_screen_mode: true },
      body: { elements: [{ tag: "markdown", content: `${label}${by}` }] },
    });
  }

  /** TypingIndicator（证据 E24）：给用户最新消息加 Typing 表情，同一条只加一次 */
  async triggerTyping(binding: ChannelBinding): Promise<void> {
    const channel = this.channel;
    const msgId = binding.lastInboundMessageId;
    if (!channel || !msgId || this.typingReacted.has(msgId)) return;
    try {
      await channel.addReaction(msgId, "Typing");
      this.typingReacted.add(msgId);
    } catch {
      // 表情失败不阻断 turn（对齐 [G] debug.Log + return nil）
    }
  }
}

function outboundText(
  event: Extract<
    OutboundEvent,
    { kind: "text" | "status" | "tool_detail" | "tool_summary" }
  >,
): string {
  switch (event.kind) {
    case "text":
      return event.text.trim();
    case "status":
      return event.status.trim();
    case "tool_detail":
      return `[${event.toolName}] ${event.detail}`.trim();
    case "tool_summary":
      return `共执行 ${event.total} 个工具${event.failures > 0 ? `，${event.failures} 个失败` : ""}`;
  }
}

/** Card 2.0 审批卡片：markdown 正文 + 同意/拒绝按钮（[G] SendInteractive 结构移植） */
export function buildApprovalCard(
  event: Extract<OutboundEvent, { kind: "approval_request" }>,
): object {
  const button = (label: string, type: string, decision: "y" | "n") => ({
    tag: "column",
    elements: [
      {
        tag: "button",
        text: { tag: "plain_text", content: label },
        type,
        behaviors: [
          { type: "callback", value: { appr: event.approvalId, decision } },
        ],
      },
    ],
  });
  return {
    schema: "2.0",
    config: { wide_screen_mode: true },
    body: {
      elements: [
        {
          tag: "markdown",
          content: `**审批请求** [${event.risk}]\n\n工具：\`${event.toolName}\`\n\n${event.summary}`,
        },
        {
          tag: "column_set",
          flex_mode: "bisect",
          columns: [
            button("同意", "primary", "y"),
            button("拒绝", "danger", "n"),
          ],
        },
      ],
    },
  };
}

/** 图片 MIME 嗅探（对齐 [G] processImageAttachment 的 image.Decode 嗅探） */
export function sniffImageMime(data: Buffer): string {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return "image/png";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff)
    return "image/jpeg";
  if (data.length >= 6 && data.subarray(0, 6).toString("ascii") === "GIF87a") return "image/gif";
  if (data.length >= 6 && data.subarray(0, 6).toString("ascii") === "GIF89a") return "image/gif";
  if (data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP")
    return "image/webp";
  return "image/jpeg"; // 飞书图片默认 jpeg
}

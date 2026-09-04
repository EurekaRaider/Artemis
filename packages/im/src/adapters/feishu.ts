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
  TypingClearer,
  TypingIndicator,
} from "../adapter.js";
import { splitMessageBytes } from "../split.js";
import { decodeDataImageUrl, extractMediaFromText } from "../media.js";
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
  /** 只移除机器人自己加的指定表情（内部查自己的 reaction_id），无则返回 false */
  removeReactionByEmoji(messageId: string, emojiType: string): Promise<boolean>;
  downloadResource(fileKey: string, type: string): Promise<Buffer>;
  /**
   * 下载「消息内资源」：GET im/v1/messages/{message_id}/resources/{file_key}?type=image。
   * D16 真机缺陷：downloadResource 走的 im/v1/images/{image_key} 仅能下载机器人
   * 自己上传的图片，用户发送的图片必须带 message_id 走本接口。官方 SDK
   * LarkChannel 未内置该方法，由 defaultChannelFactory 基于 rawClient 补齐；
   * 测试可注入假实现（缺省时回退 downloadResource）。
   */
  downloadMessageResource?(messageId: string, fileKey: string, type: string): Promise<Buffer>;
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

/** rawClient 中本适配器用到的最小结构子类型（不依赖 SDK 内部类型细节） */
interface RawMessageResourceClient {
  im: {
    v1: {
      messageResource: {
        get(payload: {
          path: { message_id: string; file_key: string };
          params: { type: string };
        }): Promise<{ getReadableStream: () => AsyncIterable<unknown> }>;
      };
    };
  };
}

function defaultChannelFactory(opts: Record<string, unknown>): FeishuChannelLike {
  const channel = new lark.LarkChannel(
    opts as unknown as ConstructorParameters<typeof lark.LarkChannel>[0],
  ) as unknown as FeishuChannelLike & { rawClient?: RawMessageResourceClient };
  // D16：补齐用户图片下载路径（官方 SDK 未内置，rawClient 为构造器公开属性）
  if (channel.rawClient?.im?.v1?.messageResource) {
    channel.downloadMessageResource = async (messageId, fileKey, type) => {
      const r = await channel.rawClient!.im.v1.messageResource.get({
        path: { message_id: messageId, file_key: fileKey },
        params: { type },
      });
      const chunks: Buffer[] = [];
      for await (const chunk of r.getReadableStream()) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
      }
      return Buffer.concat(chunks);
    };
  }
  return channel;
}

export class FeishuAdapter
  implements
    IMAdapter,
    TypingIndicator,
    TypingClearer,
    InteractiveSender,
    ApprovalCallbackSource
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
    // SDK 归一化会把 image_key 以 markdown 占位符 ![image](key) 留在 content 里；
    // 该占位符对模型无意义且会原样显示在桌面线程，必须按下载结果清洗。
    let text = (msg.content ?? "").trim();
    for (const res of msg.resources ?? []) {
      if (res.type !== "image") continue;
      try {
        // D16：用户发送的图片必须走「消息内资源」接口（带 message_id）；
        // downloadResource（im/v1/images/{image_key}）仅适用于机器人自己上传的图片。
        const data = this.channel!.downloadMessageResource
          ? await this.channel!.downloadMessageResource(msg.messageId, res.fileKey, "image")
          : await this.channel!.downloadResource(res.fileKey, "image");
        if (data.length > 0) {
          attachments.push({
            kind: "image",
            mime: sniffImageMime(data),
            dataBase64: data.toString("base64"),
          });
          // 图片在会话气泡内联展示（task.source.added → readTaskSourceImage），
          // 文本不再留 [图片] 标记——纯图片消息文本为空串（协议允许空文本+附件，
          // 模型侧由 main 兜底 "Inspect the attached files."）
          text = replaceImagePlaceholder(text, res.fileKey, "");
        } else {
          // 空响应与失败同权处理：占位符不得原样泄漏进 prompt / 线程 UI
          console.warn(`[im:${this.name}] image download empty (${res.fileKey})`);
          text = replaceImagePlaceholder(text, res.fileKey, "[图片下载失败]");
        }
      } catch (error) {
        // 单张图片下载失败不阻断整条消息，但必须可见（对齐 [G] debug.Log +
        // continue；静默吞错曾导致权限类失败在生产不可诊断）
        console.warn(
          `[im:${this.name}] image download failed (${res.fileKey}): ${describeRequestError(error)}`,
        );
        text = replaceImagePlaceholder(text, res.fileKey, "[图片下载失败]");
      }
    }

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
      case "tool_detail": {
        const raw = outboundText(event);
        if (!raw) return;
        // 出站富媒体（对齐 ggcode ExtractImagesFromText）：从要发出的文本里
        // 提取图片/视频引用，剩余文本分片发送；SDK toBuffer 负责 URL 下载 /
        // 本地路径读取（含 SSRF + 大小防护）
        const { media, text } = extractMediaFromText(raw);
        for (const item of media) {
          if (item.kind === "video") {
            await channel.send(binding.channelId, { video: { source: item.source } });
          } else if (item.source.startsWith("data:image/")) {
            const buf = decodeDataImageUrl(item.source);
            if (buf) await channel.send(binding.channelId, { image: { source: buf } });
            // 解码失败则静默丢弃该图片（文本已被清洗，无法恢复）
          } else {
            await channel.send(binding.channelId, { image: { source: item.source } });
          }
        }
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

  /** TypingIndicator（证据 E24 / [G] TriggerTyping）：给用户最新消息加 Typing
   *  表情作为"正在处理"的可视线索（飞书无原生 typing 指示），同一条只加一次。
   *  失败必须可见：缺 im:message.reaction:write 权限时接口 403，静默吞错会让
   *  该缺陷在生产不可诊断（D9 同款教训）。 */
  async triggerTyping(binding: ChannelBinding): Promise<void> {
    const channel = this.channel;
    const msgId = binding.lastInboundMessageId;
    if (!channel || !msgId || this.typingReacted.has(msgId)) return;
    // 先打标再请求：入站受理与 turn.started 兜底会在毫秒级并发触发同一消息，
    // await 后打标挡不住第二个在途请求（真机 231015 repeated request）。
    // 失败不回滚打标：typing 是 best-effort，避免每条消息反复刷失败日志。
    this.typingReacted.add(msgId);
    try {
      await channel.addReaction(msgId, "Typing");
    } catch (error) {
      console.warn(
        `[im:${this.name}] typing reaction failed (${msgId}): ${describeRequestError(error)}`,
      );
    }
  }

  /** TypingClearer：turn 终态（回复送达）移除 Typing 表情。
   *  removeReactionByEmoji 只删机器人自己加的那条；失败记日志不抛错
   *  （删不掉只是表情残留，不影响消息流）。 */
  async clearTyping(binding: ChannelBinding): Promise<void> {
    const channel = this.channel;
    const msgId = binding.lastInboundMessageId;
    if (!channel || !msgId) return;
    try {
      await channel.removeReactionByEmoji(msgId, "Typing");
    } catch (error) {
      console.warn(
        `[im:${this.name}] typing reaction remove failed (${msgId}): ${describeRequestError(error)}`,
      );
    }
  }
}

function outboundText(
  event: Extract<OutboundEvent, { kind: "text" | "status" | "tool_detail" }>,
): string {
  switch (event.kind) {
    case "text":
      return event.text.trim();
    case "status":
      return event.status.trim();
    case "tool_detail":
      return `[${event.toolName}] ${event.detail}`.trim();
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

/** 提取 axios/飞书错误的可诊断信息：HTTP 状态 + 响应体片段（流式响应体则标注跳过） */
function describeRequestError(error: unknown): string {
  const err = error as {
    message?: string;
    response?: { status?: number; data?: unknown };
  };
  const base = err?.message ?? String(error);
  const status = err?.response?.status;
  const data = err?.response?.data;
  let body = "";
  if (typeof data === "string") {
    body = data.slice(0, 300);
  } else if (
    data &&
    typeof data === "object" &&
    !Buffer.isBuffer(data) &&
    typeof (data as { pipe?: unknown }).pipe !== "function"
  ) {
    try {
      body = JSON.stringify(data).slice(0, 300);
    } catch {
      // 忽略序列化失败
    }
  }
  return `${base}${status !== undefined ? ` (HTTP ${status})` : ""}${body ? ` body=${body}` : ""}`;
}

/** 把 SDK 归一化出的 ![image](fileKey) 占位符替换为可读标记（无占位符则原样返回） */
function replaceImagePlaceholder(text: string, fileKey: string, label: string): string {
  const placeholder = `![image](${fileKey})`;
  if (!text.includes(placeholder)) return text;
  return text
    .split(placeholder)
    .join(label)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

// 适配器接口族（证据：plan §2.3，对齐 ggcode internal/im/types.go 的
// Sink + 可选接口渐进增强策略；不实现可选接口则自动降级纯文本）

import type { ChannelBinding, InboundMessage, OutboundEvent, Platform } from "./types.js";

export interface AdapterContext {
  signal: AbortSignal;
}

export interface IMAdapter {
  readonly name: string;
  readonly platform: Platform;
  start(ctx: AdapterContext, onInbound: (msg: InboundMessage) => void): Promise<void>;
  send(binding: ChannelBinding, event: OutboundEvent): Promise<void>;
  stop(): Promise<void>;
}

// 可选增强接口（typeof 守卫探测）：
export interface TypingIndicator {
  triggerTyping(binding: ChannelBinding): Promise<void>;
}

/** Typing 表情清理：turn 终态（回复送达）移除 Typing reaction。
 *  未实现则表情留存（ggcode 即如此）；实现方应只删机器人自己加的那条。 */
export interface TypingClearer {
  clearTyping(binding: ChannelBinding): Promise<void>;
}

export interface InteractiveSender {
  sendApprovalButtons(
    binding: ChannelBinding,
    event: Extract<OutboundEvent, { kind: "approval_request" }>,
  ): Promise<string /* platformMsgId */>;
}

export interface ApprovalCallbackSource {
  onApprovalCallback(
    cb: (event: { approvalId: string; approved: boolean; messageId: string }) => void,
  ): void;
}

export function isTypingIndicator(adapter: IMAdapter): adapter is IMAdapter & TypingIndicator {
  return typeof (adapter as Partial<TypingIndicator>).triggerTyping === "function";
}

export function isTypingClearer(adapter: IMAdapter): adapter is IMAdapter & TypingClearer {
  return typeof (adapter as Partial<TypingClearer>).clearTyping === "function";
}

export function isInteractiveSender(adapter: IMAdapter): adapter is IMAdapter & InteractiveSender {
  return typeof (adapter as Partial<InteractiveSender>).sendApprovalButtons === "function";
}

export function isApprovalCallbackSource(
  adapter: IMAdapter,
): adapter is IMAdapter & ApprovalCallbackSource {
  return typeof (adapter as Partial<ApprovalCallbackSource>).onApprovalCallback === "function";
}

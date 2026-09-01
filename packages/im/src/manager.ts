// IMManager（证据：plan §2.4；证据 E14/E15/E18 的实现载体）
// 深模块：绑定表、配对挑战、消息去重、审批路由全部藏在小接口后面。

import { isApprovalCallbackSource, type IMAdapter } from "./adapter.js";
import type { BindingStore } from "./bindings.js";
import { SeenMessages } from "./dedup.js";
import {
  PairingStateMachine,
  type PairingChallenge,
} from "./pairing.js";
import { routeInboundText } from "./route.js";
import type {
  AdapterState,
  ChannelBinding,
  InboundMessage,
  OutputMode,
  OutboundEvent,
} from "./types.js";

export interface PendingApproval {
  approvalId: string;
  adapter: string;
  channelId: string;
  toolName: string;
  summary: string;
  risk: string;
}

export interface InboundResult {
  handled: "paired_binding" | "pairing_flow" | "approval" | "slash" | "message" | "dropped";
  replyText?: string;
}

export interface IMStatusSnapshot {
  adapters: AdapterState[];
  bindings: ChannelBinding[];
  pendingApprovalCount: number;
  pairingChallenge: PairingChallenge | null;
  pairingAwaiting: { adapter: string; channelId: string; senderName: string } | null;
}

export interface IMManagerDeps {
  bindings: BindingStore;
  now?: () => Date;
  generatePairingCode?: () => string;
  /** 新配对挑战创建（→ main 弹配对 UI） */
  onPairingRequested?: (challenge: PairingChallenge) => void;
  /** 码匹配后等待桌面确认（→ main 配对卡更新为"待确认"） */
  onPairingAwaitingApproval?: (info: { adapter: string; channelId: string; senderName: string }) => void;
  /** 有绑定且通过守卫的入站消息（→ im-service 提交 turn） */
  onInboundAccepted?: (msg: InboundMessage, binding: ChannelBinding) => void;
  /** IM 侧审批决议（→ im-service broker.resolve） */
  onApprovalResolved?: (approvalId: string, approved: boolean, respondedBy: string) => void;
  /** slash 命令结果回复等需要直接发回频道的场景 */
  onReply?: (binding: ChannelBinding, event: OutboundEvent) => void;
}

const SINGLE_ACTIVE_BINDING_REFUSAL =
  "当前已绑定到另一个频道，请先在设置中解绑后再试。";

export class IMManager {
  private readonly bindings: BindingStore;
  private readonly now: () => number;
  private readonly deps: IMManagerDeps;
  private readonly adapters = new Map<string, IMAdapter>();
  private readonly adapterStates = new Map<string, AdapterState>();
  private readonly mutedAdapters = new Set<string>();
  private readonly seen = new SeenMessages({ now: () => this.now() });
  private readonly pairing: PairingStateMachine;
  private readonly pendingApprovals = new Map<string, PendingApproval>();

  constructor(deps: IMManagerDeps) {
    this.deps = deps;
    this.bindings = deps.bindings;
    this.now = () => (deps.now ? deps.now().getTime() : Date.now());
    this.pairing = new PairingStateMachine({
      now: () => this.now(),
      ...(deps.generatePairingCode ? { generateCode: deps.generatePairingCode } : {}),
      onChallenge: (c) => deps.onPairingRequested?.(c),
      onAwaitingApproval: (_challenge, senderName) =>
        deps.onPairingAwaitingApproval?.({
          adapter: _challenge.adapter,
          channelId: _challenge.channelId,
          senderName,
        }),
    });
  }

  registerAdapter(adapter: IMAdapter): void {
    this.adapters.set(adapter.name, adapter);
    if (isApprovalCallbackSource(adapter)) {
      adapter.onApprovalCallback((event) => {
        this.resolveApproval(event.approvalId, event.approved, `callback:${event.messageId}`);
      });
    }
  }

  async startAdapter(name: string): Promise<void> {
    if (this.mutedAdapters.has(name)) {
      throw new Error(`adapter ${name} is muted`);
    }
    const adapter = this.requireAdapter(name);
    await adapter.start({ signal: new AbortController().signal }, (msg) => {
      void this.handleInbound(msg);
    });
    this.publishState(name, { healthy: true, status: "connected" });
  }

  async stopAdapter(name: string): Promise<void> {
    const adapter = this.adapters.get(name);
    if (adapter) await adapter.stop();
    this.publishState(name, { healthy: false, status: "stopped" });
  }

  /** mute = 物理断连（对齐 [G] adapters.go 语义） */
  async setMuted(adapter: string, muted: boolean): Promise<void> {
    if (muted) {
      this.mutedAdapters.add(adapter);
      await this.stopAdapter(adapter);
    } else {
      this.mutedAdapters.delete(adapter);
      await this.startAdapter(adapter);
    }
  }

  async handleInbound(msg: InboundMessage): Promise<InboundResult> {
    const { adapter, channelId } = msg.envelope;
    // 2. muted → 静默丢弃
    if (this.mutedAdapters.has(adapter)) return { handled: "dropped" };

    const binding = this.bindings.get(adapter, channelId);

    // 3. 无绑定 → 配对流程
    if (!binding) {
      const result = this.pairing.handleInbound(
        adapter,
        channelId,
        msg.text,
        msg.envelope.senderName,
      );
      const replyText = this.resultReply(result);
      return replyText !== undefined
        ? { handled: "pairing_flow", replyText }
        : { handled: "pairing_flow" };
    }

    // 1. dedup（配对流程之外，对已绑定渠道去重）
    const dedupKey = SeenMessages.keyOf(adapter, msg.envelope.messageId);
    if (msg.envelope.messageId && !this.seen.mark(dedupKey)) {
      return { handled: "dropped" };
    }

    try {
      return await this.routeBoundInbound(msg, binding);
    } catch (err) {
      // 失败回滚打标，允许重投（[G] #540）
      this.seen.unmark(dedupKey);
      throw err;
    }
  }

  private async routeBoundInbound(
    msg: InboundMessage,
    binding: ChannelBinding,
  ): Promise<InboundResult> {
    this.bindings.update(binding.adapter, binding.channelId, {
      lastInboundMessageId: msg.envelope.messageId,
    });

    const hasPending = [...this.pendingApprovals.values()].some(
      (p) => p.adapter === binding.adapter && p.channelId === binding.channelId,
    );
    const route = routeInboundText(msg.text, hasPending);

    switch (route.kind) {
      case "empty":
        return { handled: "dropped" };
      case "approval": {
        // 4. 有待批审批 → 解析词表
        const pending = [...this.pendingApprovals.values()].find(
          (p) => p.adapter === binding.adapter && p.channelId === binding.channelId,
        );
        if (pending) {
          // 决策 7：IM 侧不提供"总是允许"记忆，scope 恒 once
          this.resolveApproval(pending.approvalId, route.approved, msg.envelope.senderName);
          return {
            handled: "approval",
            replyText: route.approved ? "已批准。" : "已拒绝。",
          };
        }
        return { handled: "dropped" };
      }
      case "slash":
        return this.handleSlash(route.text, binding);
      case "message":
        // 6. 单活跃绑定守卫
        if (binding.muted) {
          return { handled: "dropped", replyText: SINGLE_ACTIVE_BINDING_REFUSAL };
        }
        this.deps.onInboundAccepted?.(msg, binding);
        return { handled: "message" };
    }
  }

  private handleSlash(text: string, binding: ChannelBinding): InboundResult {
    const [cmd] = text.slice(1).trim().split(/\s+/, 1);
    switch (cmd) {
      case "status": {
        const state = this.adapterStates.get(binding.adapter);
        this.deps.onReply?.(binding, {
          kind: "text",
          text: `适配器 ${binding.adapter}：${state?.status ?? "unknown"}；输出模式 ${binding.outputMode}`,
        });
        return { handled: "slash" };
      }
      case "verbose":
      case "quiet":
      case "summary": {
        this.bindings.update(binding.adapter, binding.channelId, {
          outputMode: cmd as OutputMode,
        });
        this.deps.onReply?.(binding, { kind: "text", text: `输出模式已切换为 ${cmd}。` });
        return { handled: "slash" };
      }
      case "unbind": {
        this.bindings.remove(binding.adapter, binding.channelId);
        this.deps.onReply?.(binding, { kind: "text", text: "已解绑。" });
        return { handled: "slash" };
      }
      default:
        this.deps.onReply?.(binding, {
          kind: "text",
          text: `未知命令 /${cmd}。可用：/status /verbose /quiet /summary /unbind`,
        });
        return { handled: "slash" };
    }
  }

  /** 配对码匹配后，桌面操作者点"批准" → 建绑定。 */
  approvePairing(binding: Omit<ChannelBinding, "muted" | "boundAt">): ChannelBinding | null {
    const pending = this.pairing.approveChannel();
    if (!pending) return null;
    if (pending.adapter !== binding.adapter || pending.channelId !== binding.channelId) {
      return null;
    }
    const record: ChannelBinding = {
      ...binding,
      muted: false,
      boundAt: new Date(this.now()).toISOString(),
    };
    this.bindings.upsert(record);
    return record;
  }

  /** 桌面操作者点"拒绝"。满 3 次拉黑渠道（[G] pairing.go:30）。 */
  rejectPairing(): { blacklisted: boolean } {
    return this.pairing.rejectChannel();
  }

  registerPendingApproval(req: PendingApproval): void {
    this.pendingApprovals.set(req.approvalId, req);
  }

  /** IM 侧审批决议（文本回复或卡片回调两个入口都会走到这里）。 */
  resolveApproval(approvalId: string, approved: boolean, respondedBy: string): boolean {
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending) return false;
    this.pendingApprovals.delete(approvalId);
    this.deps.onApprovalResolved?.(approvalId, approved, respondedBy);
    const binding = this.bindings.get(pending.adapter, pending.channelId);
    if (binding) {
      this.deps.onReply?.(binding, {
        kind: "approval_resolved",
        approvalId,
        approved,
        respondedBy,
      });
    }
    return true;
  }

  pendingApprovalCount(): number {
    return this.pendingApprovals.size;
  }

  status(): IMStatusSnapshot {
    return {
      adapters: [...this.adapterStates.values()].map((s) => ({ ...s })),
      bindings: this.bindings.list(),
      pendingApprovalCount: this.pendingApprovals.size,
      pairingChallenge: this.pairing.activeChallenge(),
      pairingAwaiting: this.pairing.pendingApproval(),
    };
  }

  private resultReply(result: { kind: string; replyText?: string }): string | undefined {
    return "replyText" in result ? result.replyText : undefined;
  }

  private requireAdapter(name: string): IMAdapter {
    const adapter = this.adapters.get(name);
    if (!adapter) throw new Error(`unknown adapter: ${name}`);
    return adapter;
  }

  private publishState(
    name: string,
    patch: Partial<Omit<AdapterState, "name" | "platform" | "updatedAt">>,
  ): void {
    const adapter = this.adapters.get(name);
    const existing = this.adapterStates.get(name);
    const lastError = patch.lastError ?? existing?.lastError;
    this.adapterStates.set(name, {
      name,
      platform: adapter?.platform ?? existing?.platform ?? "dummy",
      healthy: patch.healthy ?? existing?.healthy ?? false,
      status: patch.status ?? existing?.status ?? "unknown",
      ...(lastError !== undefined ? { lastError } : {}),
      updatedAt: new Date(this.now()).toISOString(),
    });
  }
}

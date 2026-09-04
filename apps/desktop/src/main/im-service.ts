// IM 远程接入桥接服务（证据：plan §3）
// 薄桥接层（adapter at the seam）：packages/im 是纯 TS 平台无关核心，
// 本文件把它接到 Electron main 的 agent/store 接缝上。
// Phase 1 范围：生命周期 + 入站→turn 提交 + 出站事件翻译 + 启动恢复。
// Phase 2 范围（broker 审批拦截）另行接线，resolveBrokerApproval 已预留注入点。

import {
  FeishuAdapter,
  IMManager,
  isInteractiveSender,
  isTypingClearer,
  isTypingIndicator,
  type ChannelBinding,
  type InboundMessage,
  type IMAdapter,
  type IMStatusSnapshot,
  type OutboundEvent,
  createTurnTranslator,
} from "@artemis/im";

import { AppStoreBindingStore } from "./im-bindings-store.js";
import type { AppStore } from "./store.js";

/** 对齐 packages/protocol 的 promptImageSchema（E7）：name/mimeType/data(base64) */
export interface IMPromptImageAttachment {
  name: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  data: string;
}

/** im-service 依赖的宿主接缝（main.ts 注入真实实现，测试注入假实现）。 */
export interface IMServiceHost {
  /** 提交 turn（main.ts 的 startTaskTurn 路径；IM 侧硬编码 mode:"execute"，决策 7） */
  submitTurn(input: {
    threadId: string;
    text: string;
    attachments?: IMPromptImageAttachment[];
  }): Promise<void>;
  /** 线程运行中追加消息（queueTurn 的 turn.follow-up 路径；协议原生支持 attachments） */
  followUp(input: {
    threadId: string;
    text: string;
    attachments?: IMPromptImageAttachment[];
  }): Promise<void>;
  /** 为 IM 渠道创建可见线程（标题带平台前缀，决策 2） */
  createThread(input: { title: string; workspaceKey: string }): Promise<{ threadId: string }>;
  /** 线程当前状态（决定 prompt 还是 follow-up；线程消失时重建） */
  getThreadStatus(threadId: string): "running" | "waiting-approval" | "idle" | "not-found";
  /** 配对挑战通知桌面（弹配对卡） */
  notifyPairing(challenge: { code: string; adapter: string; channelId: string }): void;
  /** 配对码正确进入待批准态——推送桌面刷新设置面板（批准/拒绝 UI） */
  notifyPairingAwaiting(info: { adapter: string; channelId: string; senderName: string }): void;
  /** 适配器连接/断链——推送桌面刷新（会话条 IM 徽标等） */
  notifyIMStatusChanged(): void;
    /** 审批决议回 broker（Phase 2）。nonce 来自 approval.requested 事件，
   *  经 pendingApprovals.consume 防重放校验（E3 形状自带）。 */
  resolveBrokerApproval(input: {
    approvalId: string;
    nonce: string;
    approved: boolean;
    respondedBy: string;
  }): void;
}

export interface IMAdapterConfig {
  name: string;
  platform: "feishu";
  enabled: boolean;
  /** 飞书凭据（main 从 encrypted-settings-store 读出后传入，本服务不接触存储层） */
  credentials?: { appId: string; appSecret: string; domain?: "feishu" | "lark" };
}

/**
 * 协议事件的最小形状（translate.ts 的 AgentPayloadLike 对齐）。
 * 用宽松可选字段接收任意 AgentPayload：translate 只读这些字段，
 * 其他字段原样忽略（§3.2 "其他（goal、memory、queue 等）忽略"）。
 */
export interface IMAgentEventPayload {
  type: string;
  // turn.completed（schema.ts:829：只有 reason/finalPartId，无文本字段）
  reason?: string | undefined;
  // turn.failed（schema.ts:837：字段是 message）
  message?: string | undefined;
  // message.part.delta（schema.ts:291：助手文本的唯一载体）
  partId?: string | undefined;
  partType?: string | undefined;
  delta?: string | undefined;
  // tool.started / tool.completed（schema.ts:299/313）
  toolCallId?: string | undefined;
  toolName?: string | undefined;
  input?: unknown;
  output?: string | undefined;
  isError?: boolean | undefined;
  // approval.requested / approval.resolved（protocol schema.ts 对齐）
  approvalId?: string | undefined;
  nonce?: string | undefined;
  summary?: string | undefined;
  command?: string | undefined;
  risk?: string | undefined;
  source?: string | undefined;
  approved?: boolean | undefined;
}

/** IM 线程标题：飞书来源一眼可辨（原 [FS] 前缀真机反馈不直观） */
function imThreadTitle(senderName: string): string {
  const who = senderName.trim() || "飞书会话";
  return `飞书 · ${who}`;
}

export class IMService {
  readonly manager: IMManager;
  private readonly host: IMServiceHost;
  private readonly bindingStore: AppStoreBindingStore;
  private readonly adapters = new Map<string, IMAdapter>();
  /** 每线程的 turn 翻译器（summary 模式工具计数聚合，turn 边界重建） */
  private readonly turnTranslators = new Map<string, ReturnType<typeof createTurnTranslator>>();
  /** 审批追踪：approvalId → nonce（broker resolve 用）+ platformMsgId（卡片回写用） */
  private readonly approvalTrackers = new Map<
    string,
    { nonce: string; binding: ChannelBinding; platformMsgId?: string }
  >();

  constructor(deps: { store: AppStore; host: IMServiceHost }) {
    this.host = deps.host;
    this.bindingStore = new AppStoreBindingStore(deps.store);
    this.manager = new IMManager({
      bindings: this.bindingStore,
      onPairingRequested: (challenge) => {
        this.host.notifyPairing({
          code: challenge.code,
          adapter: challenge.adapter,
          channelId: challenge.channelId,
        });
      },
      onPairingAwaitingApproval: (info) => {
        this.host.notifyPairingAwaiting(info);
      },
      onAdapterStateChange: () => {
        this.host.notifyIMStatusChanged();
      },
      onInboundAccepted: (msg, binding) => {
        // submitTurn 可能抛错（如图片超 promptImageSchema 上限）——必须记日志，
        // 否则 IM 消息投递失败完全不可见（静默丢失）
        void this.handleAcceptedInbound(msg, binding).catch((error: unknown) => {
          console.warn(
            `[im] inbound submit failed (${binding.adapter}/${binding.channelId}): ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
      },
      onApprovalResolved: (approvalId, approved, respondedBy) => {
        const tracker = this.approvalTrackers.get(approvalId);
        if (!tracker) return; // 非本服务拦截的审批（理论不可达，防御）
        this.host.resolveBrokerApproval({
          approvalId,
          nonce: tracker.nonce,
          approved,
          respondedBy,
        });
      },
      onReply: (binding, event) => {
        void this.deliver(binding, event);
      },
      onReplyToChannel: (envelope, text) => {
        const adapter = this.adapters.get(envelope.adapter);
        if (!adapter) return;
        // 配对阶段无绑定：构造最小 binding 仅承载 channelId（适配器发送只用该字段）
        void adapter
          .send(
            {
              workspaceKey: "",
              threadId: "",
              adapter: envelope.adapter,
              platform: adapter.platform,
              channelId: envelope.channelId,
              outputMode: "summary",
              muted: false,
              boundAt: "",
            },
            { kind: "text", text },
          )
          .catch((error: unknown) => {
            console.warn(
              `[im] pairing reply failed (${envelope.channelId}): ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          });
      },
    });
  }

  /** 注册 + 启动适配器（main 启动恢复路径逐个调用，[G] adapters.go:31 同款）。 */
  async startAdapter(config: IMAdapterConfig): Promise<void> {
    if (!config.enabled) return;
    this.registerAdapter(this.createAdapter(config));
    await this.manager.startAdapter(config.name);
  }

  /** 注册适配器实例（deliver 出站 + manager 入站两处登记）。
   *  测试可用它注入 dummy adapter，无需走 createAdapter 凭据路径。 */
  registerAdapter(adapter: IMAdapter): void {
    this.adapters.set(adapter.name, adapter);
    this.manager.registerAdapter(adapter);
  }

  async stopAll(): Promise<void> {
    for (const state of this.manager.status().adapters) {
      await this.manager.stopAdapter(state.name);
    }
    this.adapters.clear();
  }

  /** 出站订阅入口：main 的 emitPayload 尾部调用（E5，与 UI 同一事件源）。
   *  审批事件在此拦截（plan §3.1：emitPayload 是所有 ask 分支的唯一出口，
   *  等价于在 handleBrokerRequest 各 handler 插入，但侵入面最小）。 */
  onAgentEvent(threadId: string, payload: IMAgentEventPayload): void {
    const binding = this.bindingStore.list().find((b) => b.threadId === threadId);
    if (!binding || binding.muted) return;

    if (payload.type === "approval.requested") {
      this.interceptApproval(binding, payload);
      return;
    }
    if (payload.type === "approval.resolved") {
      // 审批终态完全由本分支处理（卡片回写/文本），不进翻译管线，避免双发
      this.handleApprovalResolvedEvent(binding, payload);
      return;
    }

    let translator = this.turnTranslators.get(threadId);
    if (!translator || payload.type === "turn.started") {
      translator = createTurnTranslator(binding.outputMode);
      this.turnTranslators.set(threadId, translator);
      // Typing 表情（E24）：turn 开始给用户最新消息加 Typing reaction，
      // 一次即可（表情不过期，无需续命）。入站受理时已即时触发过一次，
      // 适配器按消息 id 去重，这里兜底覆盖受理到 turn 启动之间的缝隙。
      const adapter = this.adapters.get(binding.adapter);
      if (adapter && isTypingIndicator(adapter)) {
        void adapter.triggerTyping(binding).catch(() => undefined);
      }
    }
    for (const event of translator.feed(payload)) {
      void this.deliver(binding, event);
    }
    if (payload.type === "turn.completed" || payload.type === "turn.failed") {
      this.turnTranslators.delete(threadId);
      // 回复送达后清除用户消息上的 Typing 表情（能力存在时；
      // 清除失败仅表情残留，不影响消息流）
      const adapter = this.adapters.get(binding.adapter);
      if (adapter && isTypingClearer(adapter)) {
        void adapter.clearTyping(binding).catch(() => undefined);
      }
    }
  }

  status(): IMStatusSnapshot {
    return this.manager.status();
  }

  /** 解绑频道（设置页入口）。 */
  unbind(adapter: string, channelId: string): boolean {
    return this.bindingStore.remove(adapter, channelId);
  }

  /** 桌面批准配对：建「飞书 · 发送者」可见线程 + 写绑定（决策 2/3）。 */
  async approvePairing(workspaceKey: string): Promise<ChannelBinding | null> {
    const awaiting = this.manager.status().pairingAwaiting;
    if (!awaiting) return null;
    const created = await this.host.createThread({
      title: imThreadTitle(awaiting.senderName),
      workspaceKey,
    });
    const binding = this.manager.approvePairing({
      workspaceKey,
      threadId: created.threadId,
      adapter: awaiting.adapter,
      platform: "feishu",
      channelId: awaiting.channelId,
      outputMode: "summary",
    });
    if (binding) {
      // 对齐 ggcode 行为：配对成功回发渠道确认，IM 侧有明确终态反馈
      const adapter = this.adapters.get(binding.adapter);
      void adapter
        ?.send(binding, { kind: "text", text: "配对成功，已绑定。直接发消息即可开始。" })
        .catch(() => undefined);
    }
    return binding;
  }

  /** 桌面拒绝配对（满 3 次拉黑渠道，E15）。 */
  rejectPairing(): { blacklisted: boolean } {
    return this.manager.rejectPairing();
  }

  private createAdapter(config: IMAdapterConfig): IMAdapter {
    if (config.platform === "feishu") {
      const creds = config.credentials;
      if (!creds) throw new Error(`Feishu adapter "${config.name}" missing credentials`);
      return new FeishuAdapter(config.name, {
        appId: creds.appId,
        appSecret: creds.appSecret,
        ...(creds.domain ? { domain: creds.domain } : {}),
      });
    }
    throw new Error(`unsupported IM platform: ${config.platform as string}`);
  }

  private async handleAcceptedInbound(
    msg: InboundMessage,
    binding: ChannelBinding,
  ): Promise<void> {
    // Typing 表情即时反馈（E24，对齐 ggcode TriggerTyping 时机）：消息受理即
    // 挂到用户这条消息上，不等 turn.started——飞书端"发送后立刻能看到正在处理"。
    // 适配器按消息 id 去重，turn.started 处的兜底触发不会重复加表情。
    const typingAdapter = this.adapters.get(binding.adapter);
    if (typingAdapter && isTypingIndicator(typingAdapter)) {
      void typingAdapter
        .triggerTyping({ ...binding, lastInboundMessageId: msg.envelope.messageId })
        .catch(() => undefined);
    }
    const attachments = msg.attachments
      .filter((a) => a.kind === "image")
      .map((a, i) => ({
        name: `image-${i + 1}`,
        mimeType: a.mime as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
        data: a.dataBase64,
      }));
    const status = this.host.getThreadStatus(binding.threadId);
    if (status === "running" || status === "waiting-approval") {
      // turn.follow-up 协议要求 text 非空（schema min(1)）——纯图片消息
      // 文本已被剥离为空串时给模型侧最小标记（仅入队文本，不进气泡显示）
      const followUpText =
        msg.text.trim() || (attachments.length > 0 ? "[图片]" : "");
      if (!followUpText) return;
      // turn.follow-up 协议原生支持 attachments（host-messages.ts），
      // 运行中发来的图片不能丢
      await this.host.followUp({
        threadId: binding.threadId,
        text: followUpText,
        ...(attachments.length > 0 ? { attachments } : {}),
      });
      return;
    }
    let threadId = binding.threadId;
    if (status === "not-found") {
      // 线程消失（重启/归档）→ 以绑定工作区重建可见线程（决策 2）
      const created = await this.host.createThread({
        title: imThreadTitle(msg.envelope.senderName),
        workspaceKey: binding.workspaceKey,
      });
      this.bindingStore.update(binding.adapter, binding.channelId, {
        threadId: created.threadId,
      });
      threadId = created.threadId;
    }
    await this.host.submitTurn({
      threadId,
      text: msg.text,
      ...(attachments.length > 0 ? { attachments } : {}),
    });
  }

  /** 审批 → IM（§3.1）：注册 manager pending + 发卡片/文本，挂起等 IM 回复。
   *  automation 来源跳过（风险表：automation 优先，现有行为不变）。 */
  private interceptApproval(binding: ChannelBinding, payload: IMAgentEventPayload): void {
    if (payload.source === "automation") return;
    if (!payload.approvalId || !payload.nonce) return;
    const summary = payload.command
      ? `${payload.summary ?? "审批请求"}：${payload.command}`
      : (payload.summary ?? "审批请求");
    this.approvalTrackers.set(payload.approvalId, { nonce: payload.nonce, binding });
    this.manager.registerPendingApproval({
      approvalId: payload.approvalId,
      adapter: binding.adapter,
      channelId: binding.channelId,
      toolName: summary,
      summary,
      risk: payload.risk ?? "medium",
    });
    void this.deliver(binding, {
      kind: "approval_request",
      approvalId: payload.approvalId,
      toolName: summary,
      summary,
      risk: payload.risk ?? "medium",
    });
  }

  /** 桌面端点批准/拒绝（approval.resolved 事件）→ IM 收到终态并回写卡片。 */
  private handleApprovalResolvedEvent(
    binding: ChannelBinding,
    payload: IMAgentEventPayload,
  ): void {
    if (!payload.approvalId || payload.approved === undefined) return;
    // IM 自己决议的路径已由 manager.onReply 投递（deliver 处理卡片回写），跳过避免双发
    if (payload.source === "im") return;
    const tracker = this.approvalTrackers.get(payload.approvalId);
    if (!tracker) return;
    // UI 先决议：清理 manager pending（不再接受 IM 回复）。
    // tracker 留给 deliver 读取 platformMsgId 回写卡片，由 deliver 负责删除。
    this.manager.dropPendingApproval(payload.approvalId);
    void this.deliver(tracker.binding, {
      kind: "approval_resolved",
      approvalId: payload.approvalId,
      approved: payload.approved,
    });
  }

  private async deliver(binding: ChannelBinding, event: OutboundEvent): Promise<void> {
    const adapter = this.adapters.get(binding.adapter);
    if (!adapter) return;
    // 审批请求：优先卡片按钮（InteractiveSender），记录 platformMsgId 供终态回写
    if (event.kind === "approval_request" && isInteractiveSender(adapter)) {
      try {
        const platformMsgId = await adapter.sendApprovalButtons(binding, event);
        const tracker = this.approvalTrackers.get(event.approvalId);
        if (tracker) tracker.platformMsgId = platformMsgId;
        return;
      } catch {
        // 卡片发送失败降级文本（渐进增强策略，E19）
      }
    }
    // 审批终态：有卡片上下文则回写原卡片（移除按钮），否则文本通知
    if (event.kind === "approval_resolved") {
      const tracker = this.approvalTrackers.get(event.approvalId);
      this.approvalTrackers.delete(event.approvalId);
      if (
        tracker?.platformMsgId &&
        adapter instanceof Object &&
        "updateCardForResolution" in adapter &&
        typeof (adapter as { updateCardForResolution?: unknown }).updateCardForResolution ===
          "function"
      ) {
        try {
          await (
            adapter as {
              updateCardForResolution: (
                msgId: string,
                ev: Extract<OutboundEvent, { kind: "approval_resolved" }>,
              ) => Promise<void>;
            }
          ).updateCardForResolution(tracker.platformMsgId, event);
          return;
        } catch {
          // 回写失败降级文本
        }
      }
    }
    try {
      await adapter.send(binding, event);
    } catch (error) {
      // 出站失败不阻断 agent turn（对齐 [G] emitter 的 best-effort 语义）
      console.warn(
        `IM deliver failed (${binding.adapter}/${binding.channelId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

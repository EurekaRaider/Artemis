// IM 远程接入桥接服务（证据：plan §3）
// 薄桥接层（adapter at the seam）：packages/im 是纯 TS 平台无关核心，
// 本文件把它接到 Electron main 的 agent/store 接缝上。
// Phase 1 范围：生命周期 + 入站→turn 提交 + 出站事件翻译 + 启动恢复。
// Phase 2 范围（broker 审批拦截）另行接线，resolveBrokerApproval 已预留注入点。

import {
  FeishuAdapter,
  IMManager,
  type ChannelBinding,
  type InboundMessage,
  type IMAdapter,
  type IMStatusSnapshot,
  type OutboundEvent,
  createTurnTranslator,
} from "@artemis/im";

import { AppStoreBindingStore } from "./im-bindings-store.js";
import type { AppStore } from "./store.js";

/** im-service 依赖的宿主接缝（main.ts 注入真实实现，测试注入假实现）。 */
export interface IMServiceHost {
  /** 提交 turn（main.ts 的 startTaskTurn 路径；IM 侧硬编码 mode:"execute"，决策 7） */
  submitTurn(input: {
    threadId: string;
    text: string;
    attachments?: { kind: "image"; mime: string; dataBase64: string }[];
  }): Promise<void>;
  /** 线程运行中追加消息（queueTurn 的 turn.follow-up 路径） */
  followUp(input: { threadId: string; text: string }): Promise<void>;
  /** 为 IM 渠道创建可见线程（标题带平台前缀，决策 2） */
  createThread(input: { title: string; workspaceKey: string }): Promise<{ threadId: string }>;
  /** 线程当前状态（决定 prompt 还是 follow-up；线程消失时重建） */
  getThreadStatus(threadId: string): "running" | "waiting-approval" | "idle" | "not-found";
  /** 配对挑战通知桌面（弹配对卡） */
  notifyPairing(challenge: { code: string; adapter: string; channelId: string }): void;
  /** 审批决议回 broker（Phase 2 接线） */
  resolveBrokerApproval(input: {
    approvalId: string;
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

/** 协议事件的最小形状（translate.ts 的 AgentPayloadLike 对齐） */
export interface IMAgentEventPayload {
  type: string;
  text?: string;
  error?: string;
  toolName?: string;
  detail?: string;
  isError?: boolean;
}

export class IMService {
  readonly manager: IMManager;
  private readonly host: IMServiceHost;
  private readonly bindingStore: AppStoreBindingStore;
  private readonly adapters = new Map<string, IMAdapter>();
  /** 每线程的 turn 翻译器（summary 模式工具计数聚合，turn 边界重建） */
  private readonly turnTranslators = new Map<string, ReturnType<typeof createTurnTranslator>>();

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
      onInboundAccepted: (msg, binding) => {
        void this.handleAcceptedInbound(msg, binding);
      },
      onApprovalResolved: (approvalId, approved, respondedBy) => {
        this.host.resolveBrokerApproval({ approvalId, approved, respondedBy });
      },
      onReply: (binding, event) => {
        void this.deliver(binding, event);
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

  /** 出站订阅入口：main 的 emitPayload 尾部调用（E5，与 UI 同一事件源）。 */
  onAgentEvent(threadId: string, payload: IMAgentEventPayload): void {
    const binding = this.bindingStore.list().find((b) => b.threadId === threadId);
    if (!binding || binding.muted) return;

    let translator = this.turnTranslators.get(threadId);
    if (!translator || payload.type === "turn.started") {
      translator = createTurnTranslator(binding.outputMode);
      this.turnTranslators.set(threadId, translator);
    }
    for (const event of translator.feed(payload)) {
      void this.deliver(binding, event);
    }
    if (payload.type === "turn.completed" || payload.type === "turn.failed") {
      this.turnTranslators.delete(threadId);
    }
  }

  status(): IMStatusSnapshot {
    return this.manager.status();
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
    const status = this.host.getThreadStatus(binding.threadId);
    if (status === "running" || status === "waiting-approval") {
      await this.host.followUp({ threadId: binding.threadId, text: msg.text });
      return;
    }
    let threadId = binding.threadId;
    if (status === "not-found") {
      // 线程消失（重启/归档）→ 以绑定工作区重建可见线程（决策 2）
      const created = await this.host.createThread({
        title: `[FS] ${msg.envelope.senderName}`,
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
      ...(msg.attachments.length > 0 ? { attachments: msg.attachments } : {}),
    });
  }

  private async deliver(binding: ChannelBinding, event: OutboundEvent): Promise<void> {
    const adapter = this.adapters.get(binding.adapter);
    if (!adapter) return;
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

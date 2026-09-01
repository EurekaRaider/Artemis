// 核心类型（证据：docs/im-support/artemis-im-implementation-plan.md §2.2，
// 对齐 ggcode internal/im/types.go，字段级映射）

export type Platform = "feishu" | "dummy";

export interface Envelope {
  adapter: string; // 适配器实例名，如 "feishu-main"
  platform: Platform;
  channelId: string; // 飞书 chat_id（oc_ 前缀）
  senderId: string; // 飞书 open_id（ou_ 前缀）
  senderName: string;
  messageId: string; // 飞书 message_id（om_ 前缀）
  threadId?: string; // 预留：Slack thread_ts（附录 A / S6），飞书路径不填
  receivedAt: string; // ISO
}

export interface InboundAttachment {
  kind: "image";
  mime: string;
  dataBase64: string;
}

export interface InboundMessage {
  envelope: Envelope;
  text: string;
  attachments: InboundAttachment[];
}

export type OutputMode = "summary" | "verbose" | "quiet";

export type OutboundEvent =
  | { kind: "text"; text: string }
  | { kind: "status"; status: string }
  | {
      kind: "approval_request";
      approvalId: string;
      toolName: string;
      summary: string;
      risk: string;
    }
  | { kind: "approval_resolved"; approvalId: string; approved: boolean; respondedBy?: string }
  | { kind: "tool_summary"; total: number; failures: number } // summary 模式用
  | { kind: "tool_detail"; toolName: string; detail: string; isError?: boolean }; // verbose 模式用

export interface ChannelBinding {
  workspaceKey: string; // projectId 或临时会话 key
  threadId: string; // 绑定的可见线程（决策 2）
  adapter: string;
  platform: Platform;
  channelId: string;
  outputMode: OutputMode; // per-binding（决策 8）
  muted: boolean;
  boundAt: string;
  lastInboundMessageId?: string; // Typing 表情回复的挂载点（证据 E24）
}

export interface AdapterState {
  name: string;
  platform: Platform;
  healthy: boolean;
  status: string; // connecting | connected | online | error | stopped
  lastError?: string;
  contactUri?: string;
  updatedAt: string;
}

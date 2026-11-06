import type { AppLocale } from "@artemis/protocol";
import type {
  ChannelEvent,
  ImConversation,
  ImReply,
  ImGroupRoster,
} from "@artemis/protocol";
import type { ChannelConnection } from "./channel-connection.js";
export interface ChannelStatus {
  id: string;
  name: string;
  channel: ChannelConnection["channel"];
  state: "disabled" | "connecting" | "connected" | "error";
  error?: string;
}

export interface ChannelAdapter {
  status(locale?: AppLocale): ChannelStatus;
  start(): void;
  stop(): void;
  send(
    conversation: ImConversation,
    text: string,
    idempotencyKey: string,
    mentionUserId?: string,
  ): Promise<string | undefined>;
  sendNative?(
    conversation: ImConversation,
    text: string,
    key: string,
    recipient: string,
    locale?: AppLocale,
  ): Promise<string | undefined>;
  publish?(
    conversation: ImConversation,
    file: { name: string; data: Buffer },
    key: string,
    authorize: () => void,
  ): Promise<string | undefined>;
  groupMembers?(
    conversation: ImConversation,
    includePresence?: boolean,
  ): Promise<ImGroupRoster>;
  groupPresence?(
    members: ImGroupRoster["members"],
  ): Promise<ImGroupRoster["members"]>;
  groupInfo?(conversation: ImConversation): Promise<{
    name?: string;
    nameError?: "missing-scope";
    unavailable?: "archived" | "removed" | "dissolved" | "access-denied";
  }>;
  /** Optional capability: replace a shared task-status card without generating another notification. */
  statusCard?(
    conversation: ImConversation,
    text: string,
    idempotencyKey: string,
    messageId?: string,
    locale?: AppLocale,
  ): Promise<string>;
  /** Optional capability: stream live text into a Feishu CardKit card. */
  streamCard?(
    conversation: ImConversation,
    text: string,
    idempotencyKey: string,
    state?: FeishuStreamCardState,
    streaming?: boolean,
  ): Promise<FeishuStreamCardState>;
  approvalCard?(
    conversation: ImConversation,
    text: string,
    idempotencyKey: string,
    approval: NonNullable<ImReply["approval"]>,
    locale?: AppLocale,
  ): Promise<string>;
  typing?(
    messageId: string,
    active: boolean,
    reactionId?: string,
  ): Promise<string | undefined>;
  attachment(
    event: ChannelEvent,
    index: number,
  ): Promise<{ data: Buffer; mimeType: string; name: string }>;
}

/** Persisted streaming-card state so updates resume after gateway restarts. */
export interface FeishuStreamCardState {
  messageId: string;
  createdAt: number;
  cardId?: string;
  sequence?: number;
  streaming?: boolean;
}

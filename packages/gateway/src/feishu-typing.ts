import type { ImConversation } from "@artemis/protocol";

/** Desired activity is persisted with the authenticated desktop reply. */
export interface FeishuTyping {
  connectionId: string;
  messageId: string;
  invocationId: string;
  conversation: ImConversation;
  taskKey: string;
  active: boolean;
  expiresAt: number;
  reactionId?: string;
  retryAt?: number;
  error?: string;
}

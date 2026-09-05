import {
  channelEventSchema,
  type ChannelEvent,
  type ImConversation,
  type ImIdentity,
  type ImReply,
} from "@artemis/protocol";

export interface FeishuApprovalCard {
  approval: NonNullable<ImReply["approval"]>;
  identity: ImIdentity;
  conversation: ImConversation;
  invocationId: string;
  messageId: string;
  consumed?: boolean;
  closed?: boolean;
  retryAt?: number;
}

/** Called only after HTTPS signature verification or authenticated SDK delivery. */
export function normalizeFeishuApproval(
  value: unknown,
  card: FeishuApprovalCard,
  now = Date.now(),
): ChannelEvent | undefined {
  const data = value as
    | {
        header?: Record<string, unknown>;
        event?: {
          operator?: Record<string, unknown>;
          context?: Record<string, unknown>;
          action?: { value?: Record<string, unknown> };
        };
      }
    | undefined;
  const header = data?.header,
    event = data?.event,
    action = event?.action?.value;
  if (
    card.consumed ||
    card.approval.expiresAt <= now ||
    card.conversation.kind !== "direct" ||
    header?.event_type !== "card.action.trigger" ||
    header.app_id !== card.identity.appId ||
    header.tenant_key !== card.identity.tenantId ||
    event?.operator?.open_id !== card.identity.userId ||
    event.context?.open_chat_id !== card.conversation.id ||
    event.context?.open_message_id !== card.messageId ||
    action?.artemisApprovalToken !== card.approval.token ||
    !["yes", "no"].includes(String(action.decision))
  )
    return undefined;
  const result = channelEventSchema.safeParse({
    version: 1,
    messageId: header.event_id,
    identity: card.identity,
    conversation: card.conversation,
    text: `/approve ${card.approval.token} ${action.decision}`,
    timestamp: now,
    mentioned: true,
    bot: false,
    attachments: [],
  });
  return result.success ? result.data : undefined;
}

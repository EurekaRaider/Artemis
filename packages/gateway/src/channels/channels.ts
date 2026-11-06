// Compatibility exports; channel implementations live with their provider.
export { channelConnectionSchema } from "./channel-connection.js";
export type { ChannelConnection } from "./channel-connection.js";
export type {
  ChannelStatus,
  ChannelAdapter,
  FeishuStreamCardState,
} from "./channel-contracts.js";
export {
  ChannelRateLimit,
  ChannelUnavailable,
  DeliveryUncertain,
} from "./channel-errors.js";
export {
  splitImText,
  boundedResponse,
  validateMentionUserId,
} from "./channel-values.js";
export { wecomAttachmentName, normalizeWecom } from "./wecom/wecom-events.js";
export { WecomAdapter } from "./wecom/wecom-adapter.js";
export { verifyFeishu } from "./feishu/feishu-webhook.js";
export { normalizeFeishu } from "./feishu/feishu-events.js";
export { FeishuAdapter } from "./feishu/feishu-adapter.js";

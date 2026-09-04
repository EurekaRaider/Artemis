// 公共出口（深度纪律：仅导出公共接口，内部文件不外泄）

export type {
  AdapterState,
  ChannelBinding,
  Envelope,
  InboundAttachment,
  InboundMessage,
  OutboundEvent,
  OutputMode,
  Platform,
} from "./types.js";

export {
  isApprovalCallbackSource,
  isInteractiveSender,
  isTypingClearer,
  isTypingIndicator,
  type AdapterContext,
  type ApprovalCallbackSource,
  type IMAdapter,
  type InteractiveSender,
  type TypingClearer,
  type TypingIndicator,
} from "./adapter.js";

export { bindingKey, MemoryBindingStore, type BindingStore } from "./bindings.js";
export { SeenMessages } from "./dedup.js";
export { parseApprovalReply, type ApprovalReply } from "./approval-text.js";
export { routeInboundText, type InboundRoute } from "./route.js";
export {
  PairingStateMachine,
  PAIRING_CODE_TTL_MS,
  PAIRING_IDLE_PREEMPT_MS,
  PAIRING_MAX_REJECTS_BEFORE_BLACKLIST,
  PAIRING_MAX_WRONG_CODE_ATTEMPTS,
  type PairingChallenge,
} from "./pairing.js";
export { splitMessageBytes, utf8ByteLength } from "./split.js";
export {
  decodeDataImageUrl,
  extractMediaFromText,
  isLocalMediaPath,
  type ExtractedMedia,
  type ExtractedMediaKind,
} from "./media.js";
export {
  createTurnTranslator,
  translateAgentPayload,
  type AgentPayloadLike,
} from "./translate.js";
export {
  IMManager,
  type IMManagerDeps,
  type IMStatusSnapshot,
  type InboundResult,
  type PendingApproval,
} from "./manager.js";
export { DummyAdapter } from "./adapters/dummy.js";
export {
  FEISHU_MAX_TEXT_BYTES,
  FeishuAdapter,
  buildApprovalCard,
  sniffImageMime,
  type FeishuAdapterOptions,
} from "./adapters/feishu.js";

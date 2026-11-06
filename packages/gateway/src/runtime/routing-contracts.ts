import type {
  CollaborationSpace,
  RemoteInvocationContext,
} from "@artemis/protocol";
import type { AppLocale } from "@artemis/protocol";
import type { NativeEnvelope } from "../channels/native-protocol.js";
import type { ImConversation, ImReply } from "@artemis/protocol";

export interface Delivery {
  locale?: AppLocale;
  groupRecovery?: { groupId: string; rejoinedAt: number };
  security?: {
    deviceId: string;
    projectId: string;
    revision: string;
    audience: string;
  };
  conversation: ImConversation;
  text: string;
  /** Trusted platform sender identity, separate from model-written text. */
  mentionUserId?: string;
  invocationId?: string;
  taskId?: string;
  cardKey?: string;
  /** Live streaming update for an existing status card; never a separate message. */
  stream?: boolean;
  replyId?: string;
  fileId?: string;
  native?: NativeEnvelope;
  approval?: ImReply["approval"];
}

export interface NativeRouting {
  deviceLocale(deviceId: string): AppLocale;
  findSpace(conversation: ImConversation): CollaborationSpace | undefined;
  groupConversationContext(
    deviceId: string,
    spaceId: string,
  ): RemoteInvocationContext;
  isInvocationAuthorized(
    request: RemoteInvocationContext,
    control?: boolean,
  ): boolean;
  queueDelivery(id: string, delivery: Delivery): void;
}

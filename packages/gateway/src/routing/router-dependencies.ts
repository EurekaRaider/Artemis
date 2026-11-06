import type { Delivery } from "../runtime/routing-contracts.js";
import type { AppLocale } from "@artemis/protocol";
import type { NativeCooperation } from "../groups/native-cooperation.js";
import type {
  ChannelEvent,
  CollaborationSpace,
  CollaborationTask,
  ImConversation,
  ImIdentity,
  RemoteInvocationContext,
} from "@artemis/protocol";
import type { GatewayStore } from "../store.js";
export interface RouterDependencies {
  readonly store: GatewayStore;
  readonly native: NativeCooperation;
  eventKey(event: ChannelEvent): string;
  readonly now: () => number;
  findSpace(conversation: ImConversation): CollaborationSpace | undefined;
  broadcast(
    space: CollaborationSpace,
    id: string,
    text: string,
    except?: ImConversation,
    invocationId?: string,
    taskId?: string,
    cardKey?: string,
    replyId?: string,
    mention?: ImIdentity,
  ): void;
  queueDelivery(id: string, delivery: Delivery): void;
  deviceLocale(deviceId: string): AppLocale;
  handlePausedGroup(event: ChannelEvent): boolean;
  routeTargetedCommand(
    event: ChannelEvent,
    _space: CollaborationSpace | undefined,
    eventId: string,
  ): boolean;
  isInvocationAuthorized(
    request: RemoteInvocationContext,
    control?: boolean,
  ): boolean;
  participantName(space: CollaborationSpace, deviceId: string): string;
  securityAllowed(
    security: NonNullable<Delivery["security"]> | undefined,
  ): boolean;
  assignmentForThread(
    deviceId: string,
    threadId: string,
  ): CollaborationTask | undefined;
  inheritSecurity(sourceId: string, targetId: string): void;
}

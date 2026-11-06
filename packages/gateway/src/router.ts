import type { RouterDependencies } from "./routing/router-dependencies.js";
import { createRouterGroups } from "./routing/router-groups.js";
import { createRouterDelivery } from "./routing/router-delivery.js";
import { createRouterSecurity } from "./routing/router-security.js";
import { createRouterIngress } from "./routing/router-ingress.js";

import type { Delivery } from "./runtime/routing-contracts.js";

import type { AppLocale } from "@artemis/protocol";

import { NativeCooperation } from "./groups/native-cooperation.js";

import type {
  ChannelEvent,
  CollaborationCommand,
  CollaborationSpace,
  CollaborationTask,
  ImConversation,
  ImIdentity,
  ImReply,
  RemoteInvocationContext,
} from "@artemis/protocol";
import { GatewayStore } from "./store.js";

export class GatewayRouter {
  private readonly routerIngress = createRouterIngress(
    this.runtimeDependencies(),
  );
  private readonly routerSecurity = createRouterSecurity(
    this.runtimeDependencies(),
  );
  private readonly routerDelivery = createRouterDelivery(
    this.runtimeDependencies(),
  );
  private readonly routerGroups = createRouterGroups(
    this.runtimeDependencies(),
  );
  private runtimeDependencies(): RouterDependencies {
    const host = this;
    return {
      get store() {
        return host.store;
      },
      get native() {
        return host.native;
      },
      get eventKey() {
        return host.eventKey.bind(host);
      },
      get now() {
        return host.now;
      },
      get findSpace() {
        return host.findSpace.bind(host);
      },
      get broadcast() {
        return host.broadcast.bind(host);
      },
      get queueDelivery() {
        return host.queueDelivery.bind(host);
      },
      get deviceLocale() {
        return host.deviceLocale.bind(host);
      },
      get handlePausedGroup() {
        return host.handlePausedGroup.bind(host);
      },
      get routeTargetedCommand() {
        return host.routeTargetedCommand.bind(host);
      },
      get isInvocationAuthorized() {
        return host.isInvocationAuthorized.bind(host);
      },
      get participantName() {
        return host.participantName.bind(host);
      },
      get securityAllowed() {
        return host.securityAllowed.bind(host);
      },
      get assignmentForThread() {
        return host.assignmentForThread.bind(host);
      },
      get inheritSecurity() {
        return host.inheritSecurity.bind(host);
      },
    };
  }

  deviceLocale(deviceId: string): AppLocale {
    return this.routerGroups.deviceLocale(deviceId);
  }
  readonly native: NativeCooperation;
  constructor(
    readonly store: GatewayStore,
    private readonly now: () => number = Date.now,
  ) {
    this.native = new NativeCooperation(store, this, now);
  }
  ingest(input: unknown): boolean {
    return this.routerIngress.ingest(input);
  }
  private eventKey(event: ChannelEvent): string {
    return this.routerIngress.eventKey(event);
  }
  queueDelivery(id: string, delivery: Delivery): void {
    return this.routerDelivery.queueDelivery(id, delivery);
  }
  processIncoming(): void {
    return this.routerIngress.processIncoming();
  }
  private routeTargetedCommand(
    event: ChannelEvent,
    _space: CollaborationSpace | undefined,
    eventId: string,
  ): boolean {
    return this.routerIngress.routeTargetedCommand(event, _space, eventId);
  }
  /** Recovery notices are informational; they never enter the device task queue. */
  private handlePausedGroup(event: ChannelEvent): boolean {
    return this.routerIngress.handlePausedGroup(event);
  }
  findSpace(conversation: ImConversation): CollaborationSpace | undefined {
    return this.routerGroups.findSpace(conversation);
  }
  private inheritSecurity(sourceId: string, targetId: string): void {
    return this.routerSecurity.inheritSecurity(sourceId, targetId);
  }
  isInvocationAuthorized(
    request: RemoteInvocationContext,
    control = request.control === "cancel",
  ): boolean {
    return this.routerSecurity.isInvocationAuthorized(request, control);
  }
  securityAllowed(
    security: NonNullable<Delivery["security"]> | undefined,
  ): boolean {
    return this.routerSecurity.securityAllowed(security);
  }
  acceptSecurity(
    deviceId: string,
    invocationId: string,
    security: ImReply["security"],
  ): void {
    return this.routerSecurity.acceptSecurity(deviceId, invocationId, security);
  }
  canDeliver(delivery: Delivery): boolean {
    return this.routerSecurity.canDeliver(delivery);
  }
  private participantName(space: CollaborationSpace, deviceId: string): string {
    return this.routerGroups.participantName(space, deviceId);
  }
  private broadcast(
    space: CollaborationSpace,
    id: string,
    text: string,
    except?: ImConversation,
    invocationId?: string,
    taskId?: string,
    cardKey?: string,
    replyId?: string,
    mention?: ImIdentity,
  ): void {
    return this.routerDelivery.broadcast(
      space,
      id,
      text,
      except,
      invocationId,
      taskId,
      cardKey,
      replyId,
      mention,
    );
  }
  receiveReply(deviceId: string, input: unknown): void {
    return this.routerDelivery.receiveReply(deviceId, input);
  }
  acknowledge(deviceId: string, id: string): void {
    return this.routerDelivery.acknowledge(deviceId, id);
  }
  private assignmentForThread(
    deviceId: string,
    threadId: string,
  ): CollaborationTask | undefined {
    return this.routerGroups.assignmentForThread(deviceId, threadId);
  }
  groupConversationContext(
    deviceId: string,
    spaceId: string,
  ): RemoteInvocationContext {
    return this.routerGroups.groupConversationContext(deviceId, spaceId);
  }
  desktopCollaborationContext(
    deviceId: string,
    invocationId: string,
    threadId: string,
    turnId: string,
  ): string {
    return this.routerGroups.desktopCollaborationContext(
      deviceId,
      invocationId,
      threadId,
      turnId,
    );
  }
  collaborate(
    _deviceId: string,
    _invocationId: string,
    _threadId: string,
    _command: CollaborationCommand,
  ): unknown {
    return this.routerGroups.collaborate(
      _deviceId,
      _invocationId,
      _threadId,
      _command,
    );
  }
  private queueAssignmentCancellation(
    task: CollaborationTask,
    id: string,
  ): void {
    return this.routerGroups.queueAssignmentCancellation(task, id);
  }
}

export type { Delivery } from "./runtime/routing-contracts.js";

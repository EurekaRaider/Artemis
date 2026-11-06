import type { CooperationDependencies } from "./cooperation/cooperation-dependencies.js";
import { createCooperationLifecycle } from "./cooperation/cooperation-lifecycle.js";
import { createCooperationCommands } from "./cooperation/cooperation-commands.js";
import { createCooperationIncoming } from "./cooperation/cooperation-incoming.js";
import { createCooperationTransport } from "./cooperation/cooperation-transport.js";
import { createCooperationPeers } from "./cooperation/cooperation-peers.js";
import { createCooperationRepository } from "./cooperation/cooperation-repository.js";

import type { Peer, NativeTask } from "./cooperation/cooperation-types.js";

import { randomUUID } from "node:crypto";
import type {
  ChannelEvent,
  CollaborationCommand,
  CollaborationSpace,
  ImReply,
  ImBotPresence,
  RemoteInvocationContext,
} from "@artemis/protocol";
import { GatewayStore } from "../store.js";
import type { NativeRouting } from "../runtime/routing-contracts.js";

import type { NativeEnvelope } from "../channels/native-protocol.js";

// Exact replay detection complements the model's semantic responsibility check.

export class NativeCooperation {
  private readonly cooperationRepository = createCooperationRepository(
    this.runtimeDependencies(),
  );
  private readonly cooperationPeers = createCooperationPeers(
    this.runtimeDependencies(),
  );
  private readonly cooperationTransport = createCooperationTransport(
    this.runtimeDependencies(),
  );
  private readonly cooperationIncoming = createCooperationIncoming(
    this.runtimeDependencies(),
  );
  private readonly cooperationCommands = createCooperationCommands(
    this.runtimeDependencies(),
  );
  private readonly cooperationLifecycle = createCooperationLifecycle(
    this.runtimeDependencies(),
  );
  private runtimeDependencies(): CooperationDependencies {
    const host = this;
    return {
      get store() {
        return host.store;
      },
      get router() {
        return host.router;
      },
      get peers() {
        return host.peers.bind(host);
      },
      get allowed() {
        return host.allowed.bind(host);
      },
      get tasks() {
        return host.tasks.bind(host);
      },
      get now() {
        return host.now;
      },
      set now(value: CooperationDependencies["now"]) {
        host.now = value;
      },
      get group() {
        return host.group.bind(host);
      },
      get frame() {
        return host.frame.bind(host);
      },
      get pendingProbeUntil() {
        return host.pendingProbeUntil.bind(host);
      },
      get send() {
        return host.send.bind(host);
      },
      get address() {
        return host.address.bind(host);
      },
      get probe() {
        return host.probe.bind(host);
      },
      get task() {
        return host.task.bind(host);
      },
      get saveTask() {
        return host.saveTask.bind(host);
      },
      get respond() {
        return host.respond.bind(host);
      },
      get sessionKey() {
        return host.sessionKey.bind(host);
      },
    };
  }

  memberPresence(groupId: string, peerId: string): ImBotPresence {
    return this.cooperationPeers.memberPresence(groupId, peerId);
  }

  constructor(
    readonly store: GatewayStore,
    readonly router: NativeRouting,
    private now = Date.now,
  ) {
    // Both ends of a task can live in this gateway. Preserve legacy records,
    // but scope storage to each bot's group binding while keeping wire IDs stable.
    this.store.transaction(() => {
      for (const task of this.store.list<NativeTask>("native-tasks")) {
        const legacy = this.store.get<NativeTask>("native-tasks", task.id);
        if (legacy?.groupId !== task.groupId) continue;
        if (!this.task(task.groupId, task.id)) this.saveTask(legacy);
        this.store.delete("native-tasks", task.id);
      }
    });
  }
  private task(groupId: string, id: string): NativeTask | undefined {
    return this.cooperationRepository.task(groupId, id);
  }
  private saveTask(task: NativeTask): void {
    return this.cooperationRepository.saveTask(task);
  }
  private address(group: CollaborationSpace): {
    platform: "feishu" | "lark" | "slack" | "wecom";
    tenant: string;
    group: string;
    sender: string;
  } {
    return this.cooperationRepository.address(group);
  }
  private group(id: string): CollaborationSpace {
    return this.cooperationRepository.group(id);
  }
  peers(groupId: string): Peer[] {
    return this.cooperationRepository.peers(groupId);
  }
  tasks(groupId: string): NativeTask[] {
    return this.cooperationRepository.tasks(groupId);
  }
  private sessionKey(
    request: RemoteInvocationContext,
    group: CollaborationSpace,
    peer: string,
  ): string {
    return this.cooperationRepository.sessionKey(request, group, peer);
  }
  private allowed(group: CollaborationSpace, peer: string): boolean {
    return this.cooperationRepository.allowed(group, peer);
  }
  private frame(
    group: CollaborationSpace,
    recipient: string,
    action: NativeEnvelope["action"],
    text = "",
    task: string = randomUUID(),
    workflow: string = randomUUID(),
  ): NativeEnvelope {
    return this.cooperationTransport.frame(
      group,
      recipient,
      action,
      text,
      task,
      workflow,
    );
  }
  private send(
    group: CollaborationSpace,
    envelope: NativeEnvelope,
    invocationId?: string,
    permissionRejection = false,
  ): void {
    return this.cooperationTransport.send(
      group,
      envelope,
      invocationId,
      permissionRejection,
    );
  }
  probe(groupId: string, peer?: string): void {
    return this.cooperationPeers.probe(groupId, peer);
  }
  pendingProbeUntil(groupId: string, peer: string): number {
    return this.cooperationPeers.pendingProbeUntil(groupId, peer);
  }
  authorize(groupId: string, peers: string[]): void {
    return this.cooperationPeers.authorize(groupId, peers);
  }
  // Permission comes from the owner; protocol proof establishes capability only.
  setMemberAssignment(groupId: string, peer: string, allowed: boolean): void {
    return this.cooperationPeers.setMemberAssignment(groupId, peer, allowed);
  }

  observeBot(event: ChannelEvent): void {
    return this.cooperationPeers.observeBot(event);
  }
  syncRoster(groupId: string): void {
    return this.cooperationPeers.syncRoster(groupId);
  }
  receive(event: ChannelEvent): boolean {
    return this.cooperationIncoming.receive(event);
  }
  private respond(
    group: CollaborationSpace,
    task: NativeTask,
    action: NativeEnvelope["action"],
    text: string,
    cancellationReceipt = false,
  ): void {
    return this.cooperationTransport.respond(
      group,
      task,
      action,
      text,
      cancellationReceipt,
    );
  }
  localTaskDeleted(
    deviceId: string,
    invocationId: string,
    threadId: string,
  ): void {
    return this.cooperationLifecycle.localTaskDeleted(
      deviceId,
      invocationId,
      threadId,
    );
  }
  reply(request: RemoteInvocationContext, reply: ImReply): void {
    return this.cooperationLifecycle.reply(request, reply);
  }
  command(
    request: RemoteInvocationContext,
    threadId: string,
    id: string,
    command: CollaborationCommand,
  ): unknown {
    return this.cooperationCommands.command(request, threadId, id, command);
  }
  tick(): void {
    return this.cooperationLifecycle.tick();
  }
}

export { type NativeTask } from "./cooperation/cooperation-types.js";

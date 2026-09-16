import { imIdentityKey } from "@artemis/protocol";
import { randomUUID } from "node:crypto";
import type {
  ChannelEvent,
  CollaborationCommand,
  CollaborationSpace,
  ImReply,
  ImGroupRoster,
  RemoteInvocationContext,
} from "@artemis/protocol";
import { GatewayStore, digest } from "./store.js";
import type { GatewayRouter, Delivery } from "./router.js";
import type { ChannelConnection } from "./channels.js";
import {
  decodeNativeEnvelope,
  encodeNativeEnvelope,
  type NativeEnvelope,
} from "./native-protocol.js";

type Peer = { id: string; name: string; verifiedAt?: number };
export type NativeTask = {
  version: 1;
  id: string;
  groupId: string;
  workflow: string;
  peer: string;
  direction: "incoming" | "outgoing";
  state:
    | "blocked"
    | "sent"
    | "accepted"
    | "running"
    | "completed"
    | "failed"
    | "cancel-sent"
    | "cancelled"
    | "uncertain"
    | "rejected";
  text: string;
  result?: string;
  invocationId: string;
  threadId?: string;
  cancelId?: string;
  delivery?: string;
  envelope: NativeEnvelope;
  dependencies: string[];
  sequence: number;
  updatedAt: number;
};
const terminal = (state: NativeTask["state"]) =>
  ["completed", "failed", "cancelled", "rejected"].includes(state);
export class NativeCooperation {
  constructor(
    readonly store: GatewayStore,
    readonly router: GatewayRouter,
    private now = Date.now,
  ) {}
  private address(group: CollaborationSpace) {
    const stored = this.store.get<{ sealed: string }>(
      "connections",
      group.endpoints[0]!.connectionId,
    );
    if (!stored) throw new Error("Bot connection unavailable.");
    const config = this.store.unseal<ChannelConnection>(stored.sealed);
    return {
      platform:
        config.channel === "feishu" && config.domain === "lark"
          ? ("lark" as const)
          : config.channel,
      tenant: config.tenantId,
      group: group.endpoints[0]!.id,
      sender:
        config.channel === "slack"
          ? config.botUserId
          : config.channel === "feishu"
            ? config.botOpenId
            : config.botId,
    };
  }
  private group(id: string): CollaborationSpace {
    const group = this.store.get<CollaborationSpace>("native-groups", id);
    if (
      !group?.nativeGroup?.enabled ||
      !this.router.findSpace(group.endpoints[0]!)
    )
      throw new Error("Native group authorization is unavailable.");
    return group;
  }
  peers(groupId: string): Peer[] {
    return this.store.get<Peer[]>("native-peers", groupId) ?? [];
  }
  tasks(groupId: string): NativeTask[] {
    return this.store
      .list<NativeTask>("native-tasks")
      .filter((t) => t.groupId === groupId)
      .map((t) => ({
        ...t,
        delivery: String(
          this.store.db
            .prepare("SELECT state FROM queue WHERE bucket='outgoing' AND id=?")
            .get(`native:${t.cancelId ?? t.envelope.id}`)?.state ?? "pending",
        ),
      }));
  }
  private allowed(group: CollaborationSpace, peer: string): boolean {
    return (
      group.nativeGroup?.capability === "events" &&
      !!group.nativeGroup.allowedBots?.includes(peer) &&
      !!this.peers(group.id).find((p) => p.id === peer)?.verifiedAt
    );
  }
  private frame(
    group: CollaborationSpace,
    recipient: string,
    action: NativeEnvelope["action"],
    text = "",
    task: string = randomUUID(),
    workflow: string = randomUUID(),
  ): NativeEnvelope {
    return {
      version: 1,
      id: randomUUID(),
      ...this.address(group),
      recipient,
      action,
      text,
      task,
      workflow,
      issuedAt: this.now(),
      expiresAt: this.now() + 30 * 60000,
      sequence: 0,
    };
  }
  private send(
    group: CollaborationSpace,
    envelope: NativeEnvelope,
    invocationId?: string,
  ): void {
    const delivery: Delivery = {
      conversation: {
        ...group.endpoints[0]!,
        spaceId: group.id,
        spaceRevision: group.revision,
      },
      text: encodeNativeEnvelope(envelope),
      native: envelope,
      ...(invocationId ? { invocationId } : {}),
    };
    this.store.enqueue(
      "outgoing",
      `native:${envelope.id}`,
      delivery.conversation.connectionId,
      delivery,
    );
    this.store.put(
      "native-history",
      digest(JSON.stringify([group.id, envelope.sender, envelope.id])),
      {
        version: 1,
        id: digest(JSON.stringify([group.id, envelope.sender, envelope.id])),
        groupId: group.id,
        time: this.now(),
        direction: "outgoing",
        envelope,
      },
    );
  }
  probe(groupId: string, peer?: string): void {
    const group = this.group(groupId);
    const envelope = this.frame(group, peer ?? "*", peer ? "probe" : "hello");
    if (peer && !this.peers(groupId).some((p) => p.id === peer))
      throw new Error("Select an observed bot identity.");
    this.store.transaction(() => {
      this.store.put("native-probes", envelope.id, {
        groupId,
        peer,
        expiresAt: envelope.expiresAt,
      });
      this.send(group, envelope);
    });
  }
  authorize(groupId: string, peers: string[]): void {
    const group = this.group(groupId);
    if (
      peers.some(
        (id) => !this.peers(groupId).find((p) => p.id === id)?.verifiedAt,
      )
    )
      throw new Error("Every bot must pass an IM round-trip probe first.");
    if (
      JSON.stringify([...(group.nativeGroup?.allowedBots ?? [])].sort()) ===
      JSON.stringify([...new Set(peers)].sort())
    )
      return;
    this.store.put("native-groups", group.id, {
      ...group,
      revision: randomUUID(),
      nativeGroup: {
        ...group.nativeGroup,
        allowedBots: [...new Set(peers)],
        capability: peers.length ? "events" : "manual",
      },
    });
  }
  // Permission comes from the owner; protocol proof establishes capability only.
  setMemberAssignment(groupId: string, peer: string, allowed: boolean): void {
    const group = this.group(groupId);
    const peers = new Set(group.nativeGroup?.allowedBots ?? []);
    if (allowed) peers.add(peer);
    else peers.delete(peer);
    this.store.put("native-groups", group.id, {
      ...group,
      nativeGroup: {
        ...group.nativeGroup,
        allowedBots: [...peers],
        capability: peers.size ? "events" : "manual",
      },
    });
  }

  observeBot(event: ChannelEvent): void {
    if (
      !event.bot ||
      event.identity.channel !== "feishu" ||
      event.conversation.kind !== "group"
    )
      return;
    const group = this.router.findSpace(event.conversation);
    const owner = group?.participants[0]?.identity;
    if (
      !group ||
      !owner ||
      event.identity.channel !== owner.channel ||
      event.identity.tenantId !== owner.tenantId ||
      event.identity.appId !== owner.appId ||
      event.timestamp < group.nativeGroup!.enabledAt ||
      event.timestamp > this.now() + 60000 ||
      event.identity.userId === this.address(group).sender
    )
      return;
    const peers = this.peers(group.id);
    if (!peers.some((p) => p.id === event.identity.userId)) {
      peers.push({ id: event.identity.userId, name: event.identity.userId });
      this.store.put("native-peers", group.id, peers.slice(-100));
    }
    // Observation is identity evidence only. Permission and correlated proof
    // are still required before either side can dispatch work.
    const prior = this.store.get<{ roster?: ImGroupRoster }>(
      "native-group-info",
      group.id,
    );
    const members = (prior?.roster?.members ?? []).filter(
      (m) => m.identity.userId !== event.identity.userId,
    );
    members.push({
      identity: event.identity,
      name: event.identity.userId,
      kind: "bot",
    });
    this.store.put("native-group-info", group.id, {
      ...prior,
      roster: {
        members: members.slice(-10000),
        complete: false,
        error: "partial",
      },
    });
  }
  syncRoster(groupId: string): void {
    const group = this.store.get<CollaborationSpace>("native-groups", groupId);
    if (
      !group?.nativeGroup?.enabled ||
      !this.router.findSpace(group.endpoints[0]!)
    )
      return;
    const roster = this.store.get<{ roster?: ImGroupRoster }>(
      "native-group-info",
      groupId,
    )?.roster;
    if (!roster) return;
    const peers = this.peers(groupId);
    for (const member of roster.members) {
      if (member.kind !== "bot" || member.self) continue;
      const peer = peers.find((p) => p.id === member.identity.userId);
      if (peer) peer.name = member.name;
      else peers.push({ id: member.identity.userId, name: member.name });
    }
    this.store.put(
      "native-peers",
      groupId,
      peers
        .filter(
          (p) =>
            !roster.complete ||
            roster.members.some(
              (m) => m.kind === "bot" && m.identity.userId === p.id,
            ),
        )
        .slice(-100),
    );
    if (!this.store.get("connections", group.endpoints[0]!.connectionId))
      return;
    for (const peer of this.peers(groupId)) {
      if (!group.nativeGroup?.allowedBots?.includes(peer.id) || peer.verifiedAt)
        continue;
      const key = JSON.stringify([groupId, peer.id]);
      const next = this.store.get<number>("native-auto-probe", key) ?? 0;
      if (next > this.now()) continue;
      this.store.put("native-auto-probe", key, this.now() + 300000);
      this.probe(groupId, peer.id);
    }
  }
  receive(event: ChannelEvent): boolean {
    const envelope = decodeNativeEnvelope(event.text);
    if (!envelope || !event.bot || event.conversation.kind !== "group")
      return false;
    const group = this.router.findSpace(event.conversation);
    if (!group) return false;
    const address = this.address(group);
    const owner = group.participants.find(
      (p) => p.deviceId === group.nativeGroup!.ownerDeviceId,
    )?.identity;
    if (
      !owner ||
      event.identity.tenantId !== address.tenant ||
      event.identity.channel !== owner.channel ||
      event.identity.appId !== owner.appId
    )
      return false;
    if (
      envelope.platform !== address.platform ||
      envelope.tenant !== address.tenant ||
      envelope.group !== address.group ||
      envelope.sender !== event.identity.userId ||
      envelope.sender === address.sender ||
      ![address.sender, "*"].includes(envelope.recipient) ||
      envelope.issuedAt > this.now() + 60000 ||
      event.timestamp < group.nativeGroup!.enabledAt
    )
      return false;
    const key = JSON.stringify([group.id, envelope.sender, envelope.id]);
    const previous = this.store.get<NativeEnvelope>("native-inbox", key);
    if (previous) {
      if (JSON.stringify(previous) !== JSON.stringify(envelope)) return false;
      return true;
    }
    if (
      !["progress", "completed", "failed", "cancelled"].includes(
        envelope.action,
      ) &&
      envelope.expiresAt <= this.now()
    )
      return false;
    return this.store.transaction(() => {
      if (["hello", "probe", "proof"].includes(envelope.action)) {
        const peers = this.peers(group.id);
        if (!peers.some((p) => p.id === envelope.sender))
          peers.push({ id: envelope.sender, name: envelope.sender });
        if (envelope.action === "proof") {
          const probe =
            envelope.replyTo &&
            this.store.get<{
              groupId: string;
              peer?: string;
              expiresAt: number;
            }>("native-probes", envelope.replyTo);
          if (
            !probe ||
            probe.groupId !== group.id ||
            probe.peer !== envelope.sender ||
            probe.expiresAt <= this.now()
          )
            return false;
          peers.find((p) => p.id === envelope.sender)!.verifiedAt = this.now();
          this.store.delete("native-probes", envelope.replyTo!);
        } else if (
          envelope.action === "probe" &&
          envelope.recipient === address.sender
        ) {
          const proof = this.frame(group, envelope.sender, "proof");
          proof.replyTo = envelope.id;
          this.send(group, proof);
        }
        this.store.put("native-peers", group.id, peers.slice(-100));
      } else {
        if (envelope.recipient !== address.sender) return false;
        if (
          ["delegate", "note"].includes(envelope.action) &&
          !this.allowed(group, envelope.sender)
        )
          return false;
        const existing = this.store.get<NativeTask>(
          "native-tasks",
          envelope.task,
        );
        if (envelope.action === "delegate") {
          if (existing || !envelope.text.trim()) return false;
          if (
            this.store.get(
              "group-denied-senders",
              JSON.stringify([group.id, imIdentityKey(event.identity)]),
            )
          ) {
            const rejected = this.frame(
              group,
              envelope.sender,
              "rejected",
              "机器人主人已禁止此成员派工。",
              envelope.task,
              envelope.workflow,
            );
            rejected.replyTo = envelope.id;
            rejected.sequence = 1;
            this.send(group, rejected);
            this.store.put("native-inbox", key, envelope);
            return true;
          }

          const owner = this.router.groupConversationContext(
            group.nativeGroup!.ownerDeviceId,
            group.id,
          );
          const request: RemoteInvocationContext = {
            ...owner,
            id: digest(key),
            messageId: event.messageId,
            text: envelope.text,
            expiresAt: Math.min(envelope.expiresAt, this.now() + 30 * 60000),
            nativeTaskId: envelope.task,
            collaboration: {
              taskId: envelope.task,
              coordinatorDeviceId: owner.deviceId,
              coordinatorThreadId: owner.id,
              mission: envelope.text,
            },
          };
          const task: NativeTask = {
            version: 1,
            id: envelope.task,
            groupId: group.id,
            workflow: envelope.workflow,
            peer: envelope.sender,
            direction: "incoming",
            state: "accepted",
            text: envelope.text,
            invocationId: request.id,
            envelope,
            sequence: 0,
            dependencies: [],
            updatedAt: this.now(),
          };
          this.store.put("native-tasks", task.id, task);
          this.store.put("invocations", request.id, request);
          this.store.enqueue("device", request.id, owner.deviceId, request);
          // Transaction commits both the task and receipt before the sender can see acceptance.
          this.respond(
            group,
            task,
            "accepted",
            "Task persisted; awaiting local execution.",
          );
        } else {
          if (
            !existing ||
            existing.groupId !== group.id ||
            existing.peer !== envelope.sender ||
            existing.workflow !== envelope.workflow
          )
            return false;
          if (envelope.action === "note") {
            // Authenticated notes belong to the timeline, never the task executor.
          } else if (envelope.action === "cancel") {
            if (existing.direction !== "incoming") return false;
            if (terminal(existing.state))
              this.respond(
                group,
                existing,
                existing.state === "cancelled"
                  ? "cancelled"
                  : existing.state === "completed"
                    ? "completed"
                    : "failed",
                existing.result ?? existing.state,
              );
            else {
              const request = this.store.get<RemoteInvocationContext>(
                "invocations",
                existing.invocationId,
              )!;
              const cancel = {
                ...request,
                id: digest(key),
                text: "",
                control: "cancel" as const,
                expiresAt: this.now() + 300000,
              };
              this.store.put("invocations", cancel.id, cancel);
              this.store.enqueue("device", cancel.id, request.deviceId, cancel);
            }
          } else {
            if (
              existing.direction !== "outgoing" ||
              envelope.replyTo !== existing.envelope.id ||
              envelope.sequence <= existing.sequence ||
              terminal(existing.state)
            )
              return false;
            const states = {
              accepted: "accepted",
              progress: "running",
              completed: "completed",
              failed: "failed",
              rejected: "rejected",
              cancelled: "cancelled",
            } as const;
            if (!(envelope.action in states)) return false;
            const state = states[envelope.action as keyof typeof states];
            this.store.put("native-tasks", existing.id, {
              ...existing,
              state:
                state === "completed" && !envelope.text.trim()
                  ? "failed"
                  : existing.state === "cancel-sent" &&
                      ["accepted", "running"].includes(state)
                    ? "cancel-sent"
                    : state,
              result: envelope.text,
              sequence: envelope.sequence,
              updatedAt: this.now(),
            });
          }
        }
      }
      this.store.put("native-inbox", key, envelope);
      this.store.put(
        "native-history",
        digest(JSON.stringify([group.id, envelope.sender, envelope.id])),
        {
          version: 1,
          id: digest(JSON.stringify([group.id, envelope.sender, envelope.id])),
          groupId: group.id,
          time: this.now(),
          direction: "incoming",
          envelope,
        },
      );
      return true;
    });
  }
  private respond(
    group: CollaborationSpace,
    task: NativeTask,
    action: NativeEnvelope["action"],
    text: string,
  ) {
    const current = this.store.get<NativeTask>("native-tasks", task.id)!;
    const envelope = this.frame(
      group,
      task.peer,
      action,
      Buffer.from(text).subarray(0, 12000).toString("utf8").slice(0, 8000),
      task.id,
      task.workflow,
    );
    envelope.replyTo = task.envelope.id;
    envelope.sequence = current.sequence + 1;
    this.store.put("native-tasks", task.id, {
      ...current,
      sequence: envelope.sequence,
    });
    this.send(group, envelope, task.invocationId);
  }
  reply(request: RemoteInvocationContext, reply: ImReply): void {
    if (!request.nativeTaskId || reply.visibility === "owner") return;
    const task = this.store.get<NativeTask>(
      "native-tasks",
      request.nativeTaskId,
    );
    if (!task || task.direction !== "incoming" || terminal(task.state)) return;
    const group = this.group(task.groupId);
    const final = reply.final && reply.deliveryState !== "pending";
    const oversized =
      final &&
      (reply.text.length > 8000 || Buffer.byteLength(reply.text) > 12000);
    const rejected =
      final && reply.outcome === "failed" && !task.threadId && !reply.taskId;
    const state = rejected
      ? "rejected"
      : oversized
        ? "failed"
        : final
          ? (reply.outcome ?? "completed")
          : reply.started
            ? "running"
            : task.state;
    const updated = {
      ...task,
      state,
      ...(reply.taskId ? { threadId: reply.taskId } : {}),
      result: oversized
        ? "Result exceeds the IM protocol limit; publish an IM attachment or provide a bounded summary."
        : reply.text,
      updatedAt: this.now(),
    };
    this.store.put("native-tasks", task.id, updated);
    this.respond(
      group,
      updated,
      rejected
        ? "rejected"
        : oversized
          ? "failed"
          : final
            ? (reply.outcome ?? "completed")
            : "progress",
      updated.result,
    );
  }
  command(
    request: RemoteInvocationContext,
    threadId: string,
    id: string,
    command: CollaborationCommand,
  ): unknown {
    const group = this.group(request.conversation.spaceId!);
    if (!this.router.isInvocationAuthorized(request))
      throw new Error("Authorization revoked.");
    if (command.action === "participants")
      return this.peers(group.id).filter((p) => this.allowed(group, p.id));
    if (command.action === "status")
      return this.tasks(group.id).filter(
        (t) => t.invocationId === request.id && t.threadId === threadId,
      );
    if (request.nativeTaskId)
      throw new Error(
        "The original bot coordinates this workflow; return results through IM.",
      );
    const key = JSON.stringify([request.id, threadId, id]);
    const previous = this.store.get<{
      command: CollaborationCommand;
      result: unknown;
    }>("native-commands", key);
    if (previous) {
      if (JSON.stringify(previous.command) !== JSON.stringify(command))
        throw new Error("Command ID already used.");
      return previous.result;
    }
    return this.store.transaction(() => {
      const workflowKey = JSON.stringify([request.id, threadId]);
      const workflow = this.store.get<{ id: string }>(
        "native-workflows",
        workflowKey,
      ) ?? { id: randomUUID() };
      let result: unknown;
      if (command.action === "cancel") {
        const task = this.store.get<NativeTask>(
          "native-tasks",
          command.taskId ?? "",
        );
        if (
          !task ||
          task.invocationId !== request.id ||
          task.threadId !== threadId ||
          task.direction !== "outgoing"
        )
          throw new Error("Task is not owned by this workflow.");
        if (!terminal(task.state) && task.state !== "cancel-sent") {
          if (task.state === "blocked")
            this.store.put("native-tasks", task.id, {
              ...task,
              state: "cancelled",
              updatedAt: this.now(),
            });
          else {
            const cancel = this.frame(
              group,
              task.peer,
              "cancel",
              "",
              task.id,
              task.workflow,
            );
            this.send(group, cancel, request.id);
            this.store.put("native-tasks", task.id, {
              ...task,
              state: "cancel-sent",
              cancelId: cancel.id,
              updatedAt: this.now(),
            });
          }
        }
        result = this.store.get("native-tasks", task.id);
      } else if (
        command.action === "delegate" ||
        command.action === "delegate-many"
      ) {
        const assignments =
          command.action === "delegate"
            ? [
                {
                  participantId: command.participantId!,
                  text: command.text,
                  dependsOn: [] as string[],
                },
              ]
            : (command.assignments ?? []);
        if (!assignments.length)
          throw new Error("At least one assignment is required.");
        const tasks: NativeTask[] = [];
        for (const assignment of assignments) {
          if (
            !this.allowed(group, assignment.participantId) ||
            !assignment.text.trim()
          )
            throw new Error("Bot is not authorized or verified.");
          const dependencies = assignment.dependsOn ?? [];
          if (
            dependencies.some(
              (dep) =>
                !this.tasks(group.id).some(
                  (t) =>
                    t.id === dep &&
                    t.workflow === workflow.id &&
                    t.direction === "outgoing",
                ),
            )
          )
            throw new Error(
              "Dependencies must reference existing tasks in this workflow.",
            );
          const envelope = this.frame(
            group,
            assignment.participantId,
            "delegate",
            assignment.text,
            randomUUID(),
            workflow.id,
          );
          const task: NativeTask = {
            version: 1,
            id: envelope.task,
            groupId: group.id,
            workflow: workflow.id,
            peer: assignment.participantId,
            direction: "outgoing",
            state: dependencies.length ? "blocked" : "sent",
            text: assignment.text,
            invocationId: request.id,
            threadId,
            envelope,
            dependencies,
            sequence: 0,
            updatedAt: this.now(),
          };
          this.store.put("native-tasks", task.id, task);
          tasks.push(task);
          if (!dependencies.length) this.send(group, envelope, request.id);
        }
        this.store.put("native-workflows", workflowKey, {
          id: workflow.id,
        });
        result = tasks;
      } else if (command.action === "message") {
        const task = this.store.get<NativeTask>(
          "native-tasks",
          command.taskId ?? "",
        );
        if (
          !task ||
          task.invocationId !== request.id ||
          task.threadId !== threadId ||
          task.direction !== "outgoing" ||
          !this.allowed(group, task.peer)
        )
          throw new Error("Select this workflow's task before sending a note.");
        const note = this.frame(
          group,
          task.peer,
          "note",
          command.text,
          task.id,
          task.workflow,
        );
        this.send(group, note, request.id);
        result = { state: "note-queued", taskId: task.id };
      } else if (command.action === "finish") {
        const tasks = this.tasks(group.id).filter(
          (t) => t.workflow === workflow.id && t.direction === "outgoing",
        );
        if (
          !tasks.length ||
          tasks.some((t) => t.state !== "completed" || !t.result?.trim())
        )
          throw new Error("Wait for all successful results before finishing.");
        if (!command.text.trim()) throw new Error("A summary is required.");
        this.router.queueDelivery(`native-summary:${digest(key)}`, {
          conversation: request.conversation,
          invocationId: request.id,
          text: command.text,
        });
        result = { state: "summary-queued", workflow: workflow.id };
      } else
        throw new Error(
          "Use delegate, delegate-many, status or cancel for native IM cooperation.",
        );
      this.store.put("native-commands", key, { command, result });
      return result;
    });
  }
  tick(): void {
    for (const task of this.store.list<NativeTask>("native-tasks")) {
      if (terminal(task.state)) continue;
      const request = this.store.get<RemoteInvocationContext>(
        "invocations",
        task.invocationId,
      );
      if (!request || !this.router.isInvocationAuthorized(request)) {
        if (
          request &&
          task.direction === "outgoing" &&
          !["cancel-sent", "blocked"].includes(task.state)
        ) {
          const group = this.store.get<CollaborationSpace>(
            "native-groups",
            task.groupId,
          );
          if (
            group &&
            this.store.get("connections", group.endpoints[0]!.connectionId)
          )
            this.store.transaction(() => {
              const cancel = this.frame(
                group,
                task.peer,
                "cancel",
                "",
                task.id,
                task.workflow,
              );
              cancel.expiresAt = this.now() + 300000;
              this.store.put("native-revocation-cancels", cancel.id, {
                groupId: group.id,
                peer: task.peer,
                expiresAt: cancel.expiresAt,
              });
              this.send(group, cancel);
              this.store.put("native-tasks", task.id, {
                ...task,
                state: "cancel-sent",
                cancelId: cancel.id,
                result:
                  "Authorization revoked; cancellation requested through IM.",
                updatedAt: this.now(),
              });
            });
        }
        continue;
      }
      if (
        task.direction === "incoming" &&
        task.state === "accepted" &&
        task.envelope.expiresAt <= this.now()
      ) {
        const row = this.store.db
          .prepare("SELECT state FROM queue WHERE bucket='device' AND id=?")
          .get(task.invocationId);
        if (row?.state === "pending" || row?.state === "expired")
          this.store.transaction(() => {
            this.store.mark("device", task.invocationId, "expired");
            this.store.put("native-tasks", task.id, {
              ...task,
              state: "failed",
              result: "Assignment expired before execution.",
              updatedAt: this.now(),
            });
            this.respond(
              this.group(task.groupId),
              task,
              "failed",
              "Assignment expired before execution.",
            );
          });
        continue;
      }
      if (
        task.direction === "outgoing" &&
        ["sent", "cancel-sent"].includes(task.state)
      ) {
        const row = this.store.db
          .prepare("SELECT state FROM queue WHERE bucket='outgoing' AND id=?")
          .get(`native:${task.cancelId ?? task.envelope.id}`);
        if (
          task.state === "sent" &&
          task.envelope.expiresAt <= this.now() &&
          row?.state === "pending"
        ) {
          this.store.mark("outgoing", `native:${task.envelope.id}`, "expired");
          this.store.put("native-tasks", task.id, {
            ...task,
            state: "failed",
            result: "Assignment expired before IM delivery.",
            updatedAt: this.now(),
          });
          continue;
        }
        if (
          row?.state === "uncertain" ||
          (task.state === "sent" && task.envelope.expiresAt <= this.now())
        ) {
          this.store.put("native-tasks", task.id, {
            ...task,
            state: "uncertain",
            result:
              "Awaiting verification; never automatically replay execution.",
            updatedAt: this.now(),
          });
          continue;
        }
        if (["failed", "revoked"].includes(String(row?.state))) {
          this.store.put("native-tasks", task.id, {
            ...task,
            state: "failed",
            result: "IM delivery failed or authorization revoked.",
            updatedAt: this.now(),
          });
          continue;
        }
      }
      if (task.direction === "outgoing" && task.state === "blocked") {
        if (task.envelope.expiresAt <= this.now()) {
          this.store.put("native-tasks", task.id, {
            ...task,
            state: "failed",
            result: "Assignment expired before dependencies completed.",
            updatedAt: this.now(),
          });
          continue;
        }

        const dependencies = task.dependencies.map((id) =>
          this.store.get<NativeTask>("native-tasks", id),
        );
        if (
          dependencies.some(
            (t) => t && terminal(t.state) && t.state !== "completed",
          )
        ) {
          this.store.put("native-tasks", task.id, {
            ...task,
            state: "failed",
            result: "A prerequisite failed; owner action required.",
            updatedAt: this.now(),
          });
        } else if (
          dependencies.every(
            (t) => t?.state === "completed" && t.result?.trim(),
          )
        ) {
          this.store.transaction(() => {
            const text = `${task.text}\n\nPrerequisite results:\n${dependencies.map((t) => t!.result).join("\n")}`;
            if (text.length > 8000 || Buffer.byteLength(text) > 12000) {
              this.store.put("native-tasks", task.id, {
                ...task,
                state: "failed",
                result:
                  "Prerequisite results exceed the IM protocol limit; owner action required.",
                updatedAt: this.now(),
              });
              return;
            }
            const envelope = { ...task.envelope, text };
            this.send(this.group(task.groupId), envelope, request.id);
            this.store.put("native-tasks", task.id, {
              ...task,
              envelope,
              state: "sent",
              updatedAt: this.now(),
            });
          });
        }
      }
    }
  }
}

import { randomUUID } from "node:crypto";
import {
  channelEventSchema,
  imConversationKey,
  imIdentityKey,
  imReplySchema,
  remoteInvocationSchema,
  type ChannelEvent,
  type CollaborationCommand,
  type CollaborationSpace,
  type CollaborationTask,
  type ImConversation,
  type ImIdentity,
  type ImReply,
  type RemoteInvocationContext,
} from "@artemis/protocol";
import { GatewayStore, digest } from "./store.js";
import { splitImText } from "./channels.js";

export interface Delivery {
  conversation: ImConversation;
  text: string;
  invocationId?: string;
  taskId?: string;
  cardKey?: string;
}
interface IdentityBinding {
  identity: ImIdentity;
  deviceId: string;
}

export class GatewayRouter {
  constructor(
    readonly store: GatewayStore,
    private readonly now: () => number = Date.now,
  ) {}
  ingest(input: unknown): boolean {
    const event = channelEventSchema.parse(input);
    if (event.bot || (event.conversation.kind === "group" && !event.mentioned))
      return false;
    if (event.conversation.connectionId !== event.identity.connectionId)
      throw new Error("Channel identity does not match the conversation.");
    return this.store.enqueue(
      "incoming",
      this.eventKey(event),
      event.identity.connectionId,
      event,
    );
  }
  private eventKey(event: ChannelEvent): string {
    return digest(`${event.identity.connectionId}\0${event.messageId}`);
  }
  queueDelivery(id: string, delivery: Delivery): void {
    const chunks = splitImText(delivery.text);
    chunks.forEach((text, index) =>
      this.store.enqueue(
        "outgoing",
        `${id}:${index}`,
        delivery.conversation.connectionId,
        { ...delivery, text },
      ),
    );
  }
  processIncoming(): void {
    this.expireAssignments();
    for (const row of this.store.db
      .prepare(
        "SELECT id,payload FROM queue WHERE bucket='device' AND state='pending' AND json_extract(payload,'$.expiresAt')<=? LIMIT 100",
      )
      .all(this.now())) {
      const request = remoteInvocationSchema.parse(
        JSON.parse(String(row.payload)),
      );
      this.store.transaction(() => {
        this.store.mark("device", String(row.id), "expired");
        this.queueDelivery(`expired:${String(row.id)}`, {
          conversation: request.conversation,
          invocationId: request.id,
          text: "排队请求已超过截止时间，未启动任务。需要继续时请重新发送。",
        });
      });
    }
    for (const item of this.store.pending<ChannelEvent>(
      "incoming",
      this.now(),
    )) {
      const event = item.payload;
      try {
        if (
          event.conversation.kind === "direct" &&
          /^\/pair\s+[a-f0-9]{16}$/iu.test(event.text)
        ) {
          this.store.transaction(() => {
            const pending = this.store.requestPair(
              event.text.split(/\s+/u)[1]!,
              event.identity,
              event.conversation,
              this.now(),
            );
            if (!pending) {
              this.store.pair(
                event.text.split(/\s+/u)[1]!,
                event.identity,
                this.now(),
              );
              this.store.put(
                "direct-routes",
                imIdentityKey(event.identity),
                event.conversation,
              );
            }
            this.queueDelivery(`${item.id}:paired`, {
              conversation: event.conversation,
              text: pending
                ? "配对请求已发送，请回到 Artemis 的消息接入设置批准。"
                : "配对成功。发送 /projects 选择项目，/help 查看操作。",
            });
            this.store.mark("incoming", item.id, "done");
          });
          continue;
        }
        this.store.transaction(() => {
          const binding = this.store.get<IdentityBinding>(
            "identities",
            imIdentityKey(event.identity),
          );
          if (!binding) {
            if (event.conversation.kind === "direct")
              this.queueDelivery(`${item.id}:unpaired`, {
                conversation: event.conversation,
                text: "请先在 Artemis 的 IM 连接设置生成配对码，然后发送 /pair 配对码。",
              });
            this.store.mark("incoming", item.id, "done");
            return;
          }
          if (
            !this.store.get<{ revoked: boolean }>(
              "devices",
              binding.deviceId,
            ) ||
            this.store.get<{ revoked: boolean }>("devices", binding.deviceId)
              ?.revoked
          )
            throw new Error(
              "This device has been revoked. Pair an active device first.",
            );
          if (event.conversation.kind === "direct")
            this.store.put(
              "direct-routes",
              imIdentityKey(event.identity),
              event.conversation,
            );
          else
            this.store.put(
              "observed-groups",
              imConversationKey(event.conversation),
              { conversation: event.conversation, lastSeenAt: this.now() },
            );
          if (
            event.conversation.kind === "group" &&
            event.text.startsWith("/space-confirm ")
          ) {
            const candidate = this.store.get<
              CollaborationSpace & { administrators: ImIdentity[] }
            >("spaces", event.text.slice(15).trim());
            if (
              !candidate?.endpoints.some(
                (e) =>
                  imConversationKey(e) ===
                  imConversationKey(event.conversation),
              ) ||
              !candidate.administrators.some(
                (a) => imIdentityKey(a) === imIdentityKey(event.identity),
              )
            )
              throw new Error(
                "Only the designated administrator can confirm this group and sharing scope.",
              );
            const confirmations =
              this.store.get<string[]>("space-confirmations", candidate.id) ??
              [];
            this.store.put("space-confirmations", candidate.id, [
              ...new Set([
                ...confirmations,
                imConversationKey(event.conversation),
              ]),
            ]);
            this.queueDelivery(`${item.id}:confirmed`, {
              conversation: event.conversation,
              text: `已确认协作空间 ${candidate.name}。此空间中的公开任务、状态和成果将对 ${candidate.endpoints.length} 个群可见。`,
            });
            this.store.mark("incoming", item.id, "done");
            return;
          }
          const space = this.findSpace(event.conversation);
          if (
            event.conversation.kind === "group" &&
            (!space ||
              !space.participants.some(
                (p) =>
                  p.deviceId === binding.deviceId &&
                  imIdentityKey(p.identity) === imIdentityKey(event.identity),
              ))
          ) {
            this.queueDelivery(`${item.id}:group-denied`, {
              conversation: event.conversation,
              text: "此群尚未绑定协作空间，或该成员尚未获准参与。请由管理员配置空间，并在自己的 Artemis 中授权该空间。",
            });
            this.store.mark("incoming", item.id, "done");
            return;
          }
          const conversation = {
            ...event.conversation,
            ...(space
              ? { spaceId: space.id, spaceRevision: space.revision }
              : {}),
          };
          const reply = event.replyTo
            ? this.store.get<{ taskId?: string; deviceId: string }>(
                "message-map",
                `${event.identity.connectionId}:${event.replyTo}`,
              )
            : undefined;
          const linked =
            space && reply?.taskId
              ? this.store.get<ImReply>(
                  "thread-links",
                  `${reply.deviceId}:${reply.taskId}`,
                )
              : undefined;
          const parent = linked
            ? this.store.get<RemoteInvocationContext>(
                "invocations",
                linked.invocationId,
              )
            : undefined;
          const peerReply =
            parent &&
            parent.conversation.spaceId === space?.id &&
            this.isInvocationAuthorized(parent) &&
            reply?.deviceId !== binding.deviceId &&
            !event.text.startsWith("/") &&
            space?.participants.some((p) => p.deviceId === parent.deviceId);
          const request = remoteInvocationSchema.parse({
            version: 1,
            id: item.id,
            deviceId: peerReply ? parent.deviceId : binding.deviceId,
            identity: peerReply ? parent.identity : event.identity,
            ...(peerReply ? { originator: event.identity } : {}),
            conversation: peerReply ? parent.conversation : conversation,
            messageId: event.messageId,
            text: event.text,
            expiresAt: peerReply ? parent.expiresAt : this.now() + 30 * 60_000,
            attachments: peerReply ? [] : event.attachments,
            ...(parent?.collaboration &&
            (peerReply || reply?.deviceId === binding.deviceId)
              ? { collaboration: parent.collaboration }
              : {}),
            ...(reply?.taskId &&
            (reply.deviceId === binding.deviceId || peerReply)
              ? { taskId: reply.taskId }
              : {}),
          });
          this.store.put("invocations", request.id, request);
          this.store.enqueue("device", request.id, request.deviceId, request);
          if (
            (this.store.get<{ expiresAt: number }>(
              "device-leases",
              request.deviceId,
            )?.expiresAt ?? 0) <= this.now()
          )
            this.queueDelivery(`${item.id}:offline`, {
              conversation,
              invocationId: request.id,
              text: `目标 Artemis 当前离线或已暂停，请求已排队。请在电脑上打开 Artemis 并启用 IM 连接；恢复后会重新检查授权，请求在 ${Math.max(1, Math.ceil((request.expiresAt - this.now()) / 60000))} 分钟后失效。`,
            });
          if (space && !event.text.startsWith("/"))
            this.broadcast(
              space,
              `${item.id}:shared`,
              `[${this.participantName(space, binding.deviceId)} · ${event.identity.channel}] ${event.text}`,
              conversation,
              request.id,
              request.taskId,
            );
          this.store.mark("incoming", item.id, "done");
        });
      } catch (error) {
        this.queueDelivery(`${item.id}:error`, {
          conversation: event.conversation,
          text:
            error instanceof Error
              ? error.message
              : "IM request could not be accepted.",
        });
        this.store.mark("incoming", item.id, "failed");
      }
    }
  }
  findSpace(conversation: ImConversation): CollaborationSpace | undefined {
    return this.store
      .list<CollaborationSpace>("spaces")
      .find(
        (space) =>
          space.endpoints.some(
            (endpoint) =>
              imConversationKey(endpoint) === imConversationKey(conversation),
          ) &&
          space.endpoints.every((endpoint) =>
            (
              this.store.get<string[]>("space-confirmations", space.id) ?? []
            ).includes(imConversationKey(endpoint)),
          ),
      );
  }
  isInvocationAuthorized(request: RemoteInvocationContext): boolean {
    const device = this.store.get<{ revoked: boolean }>(
      "devices",
      request.deviceId,
    );
    if (
      !device ||
      device.revoked ||
      this.store.get<IdentityBinding>(
        "identities",
        imIdentityKey(request.identity),
      )?.deviceId !== request.deviceId
    )
      return false;
    if (request.conversation.kind === "direct") return !request.originator;
    const space = this.findSpace(request.conversation);
    if (
      !space ||
      space.id !== request.conversation.spaceId ||
      space.revision !== request.conversation.spaceRevision ||
      !space.participants.some(
        (p) =>
          p.deviceId === request.deviceId &&
          imIdentityKey(p.identity) === imIdentityKey(request.identity),
      )
    )
      return false;
    if (request.originator) {
      const originator = this.store.get<IdentityBinding>(
        "identities",
        imIdentityKey(request.originator),
      );
      if (
        !originator ||
        this.store.get<{ revoked: boolean }>("devices", originator.deviceId)
          ?.revoked ||
        !space.participants.some(
          (p) =>
            p.deviceId === originator.deviceId &&
            imIdentityKey(p.identity) === imIdentityKey(request.originator!),
        )
      )
        return false;
    }
    return true;
  }
  canDeliver(delivery: Delivery): boolean {
    if (delivery.invocationId) {
      const request = this.store.get<RemoteInvocationContext>(
        "invocations",
        delivery.invocationId,
      );
      if (!request || !this.isInvocationAuthorized(request)) return false;
    }
    if (delivery.conversation.spaceId) {
      const space = this.findSpace(delivery.conversation);
      if (
        !space ||
        space.id !== delivery.conversation.spaceId ||
        space.revision !== delivery.conversation.spaceRevision
      )
        return false;
    }
    return true;
  }
  private participantName(space: CollaborationSpace, deviceId: string): string {
    return (
      space.participants.find((p) => p.deviceId === deviceId)?.name ?? "Artemis"
    );
  }
  private broadcast(
    space: CollaborationSpace,
    id: string,
    text: string,
    except?: ImConversation,
    invocationId?: string,
    taskId?: string,
    cardKey?: string,
  ): void {
    for (const endpoint of space.endpoints) {
      if (except && imConversationKey(except) === imConversationKey(endpoint))
        continue;
      this.queueDelivery(`${id}:${imConversationKey(endpoint)}`, {
        conversation: {
          ...endpoint,
          spaceId: space.id,
          ...(space.revision ? { spaceRevision: space.revision } : {}),
        },
        text,
        ...(invocationId ? { invocationId } : {}),
        ...(taskId ? { taskId } : {}),
        ...(cardKey ? { cardKey } : {}),
      });
    }
  }
  receiveReply(deviceId: string, input: unknown): void {
    const parsedReply = imReplySchema.parse(input);
    const reply = { ...parsedReply, id: `${deviceId}:${parsedReply.id}` };
    const request = this.store.get<RemoteInvocationContext>(
      "invocations",
      reply.invocationId,
    );
    if (!request || request.deviceId !== deviceId)
      throw new Error("Reply does not belong to this device.");
    if (!this.isInvocationAuthorized(request)) return;
    const replyKey = JSON.stringify([deviceId, reply.id]);
    this.store.transaction(() => {
      if (this.store.get("replies", replyKey)) return;
      this.store.put("replies", replyKey, reply);
      const space = request.conversation.spaceId
        ? this.store.get<CollaborationSpace>(
            "spaces",
            request.conversation.spaceId,
          )
        : undefined;
      const ownerRoute = this.store.get<ImConversation>(
        "direct-routes",
        imIdentityKey(request.identity),
      );
      const cardKey =
        reply.taskId && reply.status && reply.visibility === "conversation"
          ? `${deviceId}:${reply.taskId}`
          : undefined;
      if (cardKey && reply.final) {
        const labels = {
          queued: "排队中",
          running: "正在执行",
          waiting: "等待主人确认",
          completed: "已完成",
          failed: "失败",
          cancelled: "已停止",
        };
        const text = `任务 ${reply.taskId}\n${labels[reply.status!]}`;
        if (space)
          this.broadcast(
            space,
            `${reply.id}:status`,
            `[${this.participantName(space, deviceId)} 的 Agent]\n${text}`,
            undefined,
            request.id,
            reply.taskId,
            cardKey,
          );
        else
          this.queueDelivery(`${reply.id}:status`, {
            conversation: request.conversation,
            invocationId: request.id,
            ...(reply.taskId ? { taskId: reply.taskId } : {}),
            text,
            cardKey,
          });
      }
      if (reply.visibility === "owner") {
        if (ownerRoute)
          this.queueDelivery(reply.id, {
            conversation: ownerRoute,
            text: reply.text,
            invocationId: request.id,
            ...(reply.taskId ? { taskId: reply.taskId } : {}),
          });
        else
          this.queueDelivery(reply.id, {
            conversation: request.conversation,
            text: "等待主人在 Artemis 桌面处理确认。",
          });
      } else if (space) {
        this.broadcast(
          space,
          reply.id,
          `[${this.participantName(space, deviceId)} 的 Agent]\n${reply.text}`,
          undefined,
          request.id,
          reply.taskId,
          reply.final ? undefined : cardKey,
        );
      } else
        this.queueDelivery(reply.id, {
          conversation: request.conversation,
          text: reply.text,
          invocationId: request.id,
          ...(reply.taskId ? { taskId: reply.taskId } : {}),
          ...(!reply.final && cardKey ? { cardKey } : {}),
        });
      const assignment = request.collaboration
        ? this.store.get<CollaborationTask>(
            "collaboration-tasks",
            request.collaboration.taskId,
          )
        : reply.taskId
          ? this.assignmentForThread(deviceId, reply.taskId)
          : undefined;
      if (assignment && reply.started && assignment.state === "queued") {
        assignment.state = "working";
        this.store.put("collaboration-tasks", assignment.id, assignment);
      }
      if (assignment && reply.final) {
        const task = assignment;
        if (task && task.state !== "cancelled") {
          task.result = reply.text;
          task.state = reply.outcome ?? "completed";
          this.store.put("collaboration-tasks", task.id, task);
          // Completion is delivered once to the original coordinator; it has no authority to expand grants.
          const parent = this.store
            .list<RemoteInvocationContext>("invocations")
            .find(
              (item) =>
                item.deviceId === task.coordinatorDeviceId &&
                item.conversation.spaceId === task.spaceId &&
                this.store.get<ImReply>(
                  "thread-links",
                  `${task.coordinatorDeviceId}:${task.coordinatorThreadId}`,
                )?.invocationId === item.id,
            );
          if (parent) {
            const result = {
              ...parent,
              id: `result:${task.id}`,
              taskId: task.coordinatorThreadId,
              text: `[协作结果 ${task.id}]\n${task.result}`,
              attachments: [],
              expiresAt: Math.min(parent.expiresAt, task.expiresAt),
            };
            this.store.put("invocations", result.id, result);
            this.store.enqueue("device", result.id, parent.deviceId, result);
          }
        }
      }
      if (reply.taskId && (reply.started || reply.final)) {
        if (!this.store.get("thread-links", `${deviceId}:${reply.taskId}`))
          this.store.put("thread-links", `${deviceId}:${reply.taskId}`, reply);
        if (assignment)
          this.store.put("assignment-threads", assignment.id, reply.taskId);
      }
    });
  }
  acknowledge(deviceId: string, id: string): void {
    const request = this.store.get<RemoteInvocationContext>("invocations", id);
    if (!request || request.deviceId !== deviceId)
      throw new Error("Cannot acknowledge another device's request.");
    this.store.mark("device", id, "done");
  }
  private assignmentForThread(
    deviceId: string,
    threadId: string,
  ): CollaborationTask | undefined {
    return this.store
      .list<CollaborationTask>("collaboration-tasks")
      .find(
        (task) =>
          task.participantDeviceId === deviceId &&
          this.store.get<string>("assignment-threads", task.id) === threadId,
      );
  }
  collaborate(
    deviceId: string,
    invocationId: string,
    threadId: string,
    command: CollaborationCommand,
  ): unknown {
    const request = this.store.get<RemoteInvocationContext>(
      "invocations",
      invocationId,
    );
    if (
      !request ||
      request.deviceId !== deviceId ||
      !this.isInvocationAuthorized(request) ||
      !request.conversation.spaceId ||
      request.expiresAt <= this.now()
    )
      throw new Error("An active authorized collaboration task is required.");
    const space = this.store.get<CollaborationSpace>(
      "spaces",
      request.conversation.spaceId,
    );
    if (!space || !space.participants.some((p) => p.deviceId === deviceId))
      throw new Error("Participant is no longer in this space.");
    const assignment =
      this.assignmentForThread(deviceId, threadId) ??
      (request.collaboration
        ? this.store.get<CollaborationTask>(
            "collaboration-tasks",
            request.collaboration.taskId,
          )
        : undefined);
    // Persist the execution route before tools can return results; private control receipts never replace it.
    const threadKey = `${deviceId}:${threadId}`;
    if (!this.store.get("thread-links", threadKey))
      this.store.put("thread-links", threadKey, {
        version: 1,
        id: threadKey,
        invocationId,
        taskId: threadId,
        text: "",
        final: false,
        visibility: "conversation",
      } satisfies ImReply);
    if (assignment)
      this.store.put("assignment-threads", assignment.id, threadId);
    if (
      this.store.get("finished-collaborations", `${deviceId}:${threadId}`) &&
      command.action !== "status"
    )
      throw new Error("This collaboration has ended.");
    if (command.action === "participants")
      return space.participants.map(({ deviceId: id, name }) => ({ id, name }));
    const tasks = this.store
      .list<CollaborationTask>("collaboration-tasks")
      .filter(
        (task) =>
          task.spaceId === space.id &&
          task.coordinatorDeviceId === deviceId &&
          task.coordinatorThreadId === threadId,
      );
    if (command.action === "status") return tasks;
    if (command.action === "delegate") {
      if (assignment)
        throw new Error(
          "Only the initiating coordinator can delegate across devices.",
        );
      if (tasks.length >= 16)
        throw new Error("Collaboration task budget reached (16 assignments).");
      if (!command.text.trim())
        throw new Error("A bounded task with a deliverable is required.");
      const participant = space.participants.find(
        (p) => p.deviceId === command.participantId && p.deviceId !== deviceId,
      );
      if (!participant)
        throw new Error("Participant is not available in this space.");
      const binding = this.store.get<IdentityBinding>(
        "identities",
        imIdentityKey(participant.identity),
      );
      if (binding?.deviceId !== participant.deviceId)
        throw new Error("Participant has been unpaired.");
      const endpoint = space.endpoints.find(
        (e) => e.connectionId === participant.identity.connectionId,
      );
      if (!endpoint)
        throw new Error("Participant's IM is not connected to this space.");
      const task: CollaborationTask = {
        id: randomUUID(),
        spaceId: space.id,
        coordinatorDeviceId: deviceId,
        coordinatorThreadId: threadId,
        participantDeviceId: participant.deviceId,
        invocationId: randomUUID(),
        state: "queued",
        mission: command.text,
        result: "",
        expiresAt: request.expiresAt,
      };
      const invocation = remoteInvocationSchema.parse({
        version: 1,
        id: task.invocationId,
        deviceId: participant.deviceId,
        identity: participant.identity,
        conversation: {
          ...endpoint,
          spaceId: space.id,
          spaceRevision: space.revision,
        },
        messageId: task.id,
        text: command.text,
        attachments: [],
        expiresAt: task.expiresAt,
        collaboration: {
          taskId: task.id,
          coordinatorDeviceId: deviceId,
          coordinatorThreadId: threadId,
          mission: command.text,
        },
      });
      this.store.transaction(() => {
        this.store.put("collaboration-tasks", task.id, task);
        this.store.put("invocations", invocation.id, invocation);
        this.store.enqueue(
          "device",
          invocation.id,
          participant.deviceId,
          invocation,
        );
      });
      return task;
    }
    if (command.action === "message") {
      if (!command.text.trim()) throw new Error("Message cannot be empty.");
      const rootKey = `${assignment?.coordinatorDeviceId ?? deviceId}:${assignment?.coordinatorThreadId ?? threadId}`;
      const count =
        this.store.get<number>("collaboration-messages", rootKey) ?? 0;
      if (count >= 64)
        throw new Error("Collaboration message budget reached (64 messages).");
      this.store.put("collaboration-messages", rootKey, count + 1);
      const messageId = randomUUID();
      if (command.participantId) {
        const target = space.participants.find(
          (p) =>
            p.deviceId === command.participantId && p.deviceId !== deviceId,
        );
        if (!target)
          throw new Error("Target is not a participant in this space.");
        const candidates = this.store
          .list<CollaborationTask>("collaboration-tasks")
          .filter(
            (t) =>
              t.spaceId === space.id &&
              `${t.coordinatorDeviceId}:${t.coordinatorThreadId}` === rootKey,
          );
        const assignment = candidates.find(
          (t) =>
            t.participantDeviceId === target.deviceId &&
            (!command.taskId || t.id === command.taskId),
        );
        const targetThreadId = assignment
          ? this.store.get<string>("assignment-threads", assignment.id)
          : rootKey.startsWith(`${target.deviceId}:`)
            ? rootKey.slice(target.deviceId.length + 1)
            : undefined;
        const parentReply = targetThreadId
          ? this.store.get<ImReply>(
              "thread-links",
              `${target.deviceId}:${targetThreadId}`,
            )
          : undefined;
        const original = parentReply
          ? this.store.get<RemoteInvocationContext>(
              "invocations",
              parentReply.invocationId,
            )
          : undefined;
        if (!original || !targetThreadId)
          throw new Error(
            "Target has not started its collaboration session yet. Check status before messaging.",
          );
        const followUp = {
          ...original,
          id: `message:${messageId}`,
          taskId: targetThreadId,
          text: `[${this.participantName(space, deviceId)} 的 Agent]\n${command.text}`,
          attachments: [],
          originator: request.identity,
        };
        this.store.put("invocations", followUp.id, followUp);
        this.store.enqueue("device", followUp.id, target.deviceId, followUp);
      }
      this.broadcast(
        space,
        messageId,
        `[${this.participantName(space, deviceId)} 的 Agent]\n${command.text}`,
        undefined,
        request.id,
        threadId,
      );
      return { published: true };
    }
    if (command.action === "finish") {
      if (
        assignment ||
        tasks.some((task) =>
          ["working", "queued", "cancelling"].includes(task.state),
        )
      )
        throw new Error(
          "Wait for required participants before finishing collaboration.",
        );
      this.store.put(
        "finished-collaborations",
        `${deviceId}:${threadId}`,
        true,
      );
      this.broadcast(
        space,
        randomUUID(),
        `[协作完成]\n${command.text}`,
        undefined,
        request.id,
        threadId,
      );
      return { completed: true };
    }
    const task = tasks.find((item) => item.id === command.taskId);
    if (!task)
      throw new Error("Only the task coordinator can cancel this assignment.");
    if (["completed", "failed", "cancelled"].includes(task.state)) return task;
    task.state = "cancelling";
    this.store.put("collaboration-tasks", task.id, task);
    this.queueAssignmentCancellation(task, `cancel:${task.id}`);
    return task;
  }
  private expireAssignments(): void {
    for (const task of this.store.list<CollaborationTask>(
      "collaboration-tasks",
    )) {
      if (
        !["queued", "working", "cancelling"].includes(task.state) ||
        task.expiresAt > this.now()
      )
        continue;
      this.store.transaction(() => {
        task.state = "failed";
        task.result =
          "协作任务已到截止时间，已请求目标设备停止；以设备回报的实际操作结果为准。";
        this.store.put("collaboration-tasks", task.id, task);
        this.queueAssignmentCancellation(task, `deadline:${task.id}`);
      });
    }
  }
  private queueAssignmentCancellation(
    task: CollaborationTask,
    id: string,
  ): void {
    const assignment = this.store.get<RemoteInvocationContext>(
      "invocations",
      task.invocationId,
    );
    if (!assignment) return;
    const cancel = {
      ...assignment,
      id,
      text: "",
      control: "cancel" as const,
      expiresAt: this.now() + 300000,
    };
    this.store.put("invocations", cancel.id, cancel);
    this.store.enqueue("device", cancel.id, assignment.deviceId, cancel);
  }
}

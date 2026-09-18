import { splitSlackMarkdown } from "./slack-format.js";
import { NativeCooperation } from "./native-cooperation.js";
import { NATIVE_PREFIX, type NativeEnvelope } from "./native-protocol.js";
import { randomUUID } from "node:crypto";
import {
  channelEventSchema,
  imConversationKey,
  imIdentityKey,
  imReplySchema,
  type ImSecurityContext,
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
import type { FeishuTyping } from "./feishu-typing.js";
import type { FeishuApprovalCard } from "./feishu-approval.js";

export interface Delivery {
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
  replyId?: string;
  fileId?: string;
  native?: NativeEnvelope;
  approval?: ImReply["approval"];
}
interface IdentityBinding {
  identity: ImIdentity;
  deviceId: string;
}

export class GatewayRouter {
  readonly native: NativeCooperation;
  constructor(
    readonly store: GatewayStore,
    private readonly now: () => number = Date.now,
  ) {
    this.native = new NativeCooperation(store, this, now);
  }
  ingest(input: unknown): boolean {
    const event = channelEventSchema.parse(input);
    if (event.conversation.connectionId !== event.identity.connectionId)
      throw new Error("Channel identity does not match the conversation.");
    if (event.text.trim().startsWith(NATIVE_PREFIX))
      return this.native.receive(event);
    if (event.bot || (event.conversation.kind === "group" && !event.mentioned))
      return false;

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
    if (delivery.invocationId) {
      const security = this.store.get<NonNullable<Delivery["security"]>>(
        "invocation-security",
        delivery.invocationId,
      );
      if (security) delivery = { ...delivery, security };
    }
    const entry = this.store.get<{ sealed: string }>(
      "connections",
      delivery.conversation.connectionId,
    );
    const connection = entry
      ? this.store.unseal<{ channel: string }>(entry.sealed)
      : undefined;
    const chunks =
      connection?.channel === "slack"
        ? splitSlackMarkdown(delivery.text)
        : splitImText(delivery.text);
    chunks.forEach((text, index) =>
      this.store.enqueue(
        "outgoing",
        `${id}:${index}`,
        delivery.conversation.connectionId,
        {
          ...delivery,
          text,
          ...(index > 0
            ? { approval: undefined, mentionUserId: undefined }
            : {}),
        },
      ),
    );
  }
  processIncoming(): void {
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
        const space = request.conversation.spaceId
          ? this.findSpace(request.conversation)
          : undefined;
        const text =
          "排队请求已超过截止时间，未启动任务。需要继续时请重新发送。";
        if (space && space.revision === request.conversation.spaceRevision)
          this.broadcast(
            space,
            `expired:${String(row.id)}`,
            `[${this.participantName(space, request.deviceId)} 的 Agent]\n${text}`,
            undefined,
            request.id,
          );
        else
          this.queueDelivery(`expired:${String(row.id)}`, {
            conversation: request.conversation,
            invocationId: request.id,
            text,
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
          const nativeSpace =
            event.conversation.kind === "group"
              ? this.findSpace(event.conversation)
              : undefined;
          const owner = nativeSpace?.nativeGroup
            ? nativeSpace.participants[0]
            : undefined;
          if (
            owner &&
            (event.identity.channel !== owner.identity.channel ||
              event.identity.connectionId !== owner.identity.connectionId ||
              event.identity.tenantId !== owner.identity.tenantId ||
              event.identity.appId !== owner.identity.appId)
          ) {
            this.store.mark("incoming", item.id, "done");
            return;
          }
          if (
            nativeSpace &&
            this.store.get(
              "group-denied-senders",
              JSON.stringify([nativeSpace.id, imIdentityKey(event.identity)]),
            )
          ) {
            this.queueDelivery(`${item.id}:assignment-denied`, {
              conversation: event.conversation,
              text: "机器人主人已禁止你的账号在本群派工，请联系主人调整成员权限。",
            });
            this.store.mark("incoming", item.id, "done");
            return;
          }
          const groupSender =
            owner &&
            imIdentityKey(owner.identity) !== imIdentityKey(event.identity);
          const binding = this.store.get<IdentityBinding>(
            "identities",
            imIdentityKey(owner?.identity ?? event.identity),
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
          else {
            const key = imConversationKey(event.conversation);
            const previous = this.store.get<{ identities?: ImIdentity[] }>(
              "observed-groups",
              key,
            );
            const identities = [
              ...(previous?.identities ?? []).filter(
                (i) => imIdentityKey(i) !== imIdentityKey(event.identity),
              ),
              event.identity,
            ].slice(-100);
            this.store.put("observed-groups", key, {
              ...previous,
              conversation: event.conversation,
              identities,
              lastSeenAt: this.now(),
            });
          }
          const paused = this.store
            .list<CollaborationSpace>("native-groups")
            .some(
              (group) =>
                group.nativeGroup?.version === 1 &&
                !group.nativeGroup.enabled &&
                group.endpoints.some(
                  (endpoint) =>
                    imConversationKey(endpoint) ===
                    imConversationKey(event.conversation),
                ),
            );
          if (paused) {
            this.store.mark("incoming", item.id, "done");
            return;
          }
          const space = this.findSpace(event.conversation);
          if (event.conversation.kind === "group" && !space) {
            this.queueDelivery(`${item.id}:group-setup`, {
              conversation: event.conversation,
              text: "已发现这个群。请回到 Artemis → 消息接入 → 群聊，刷新群列表并确认项目与分享范围。启用后请重新发送任务；当前消息不会执行。",
            });
            this.store.mark("incoming", item.id, "done");
            return;
          }
          if (
            event.conversation.kind === "group" &&
            space &&
            !space.nativeGroup &&
            !space.participants.some(
              (p) =>
                p.deviceId === binding.deviceId &&
                imIdentityKey(p.identity) === imIdentityKey(event.identity),
            )
          ) {
            this.queueDelivery(`${item.id}:group-denied`, {
              conversation: event.conversation,
              text: "你尚未获准向此机器人派工。请让机器人主人在 Artemis 的群聊设置中授权你的账号。当前不会启动任务。",
            });
            this.store.mark("incoming", item.id, "done");
            return;
          }
          if (
            space?.nativeGroup &&
            event.timestamp < space.nativeGroup.enabledAt
          ) {
            this.store.mark("incoming", item.id, "done");
            return;
          }
          if (
            groupSender &&
            event.text.trimStart().startsWith("/") &&
            !/^\/(?:new|stop|status|stopwait)(?:\s|$)/iu.test(event.text.trim())
          ) {
            this.queueDelivery(`${item.id}:owner-command`, {
              conversation: event.conversation,
              text: "群成员可以提交、查询或停止自己的任务；切换项目和审批仅供机器人主人使用。",
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
          if (this.routeTargetedCommand(event, space, item.id)) {
            this.store.mark("incoming", item.id, "done");
            return;
          }
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
            identity: peerReply
              ? parent.identity
              : (owner?.identity ?? event.identity),
            ...(peerReply || groupSender ? { originator: event.identity } : {}),
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
  private routeTargetedCommand(
    event: ChannelEvent,
    _space: CollaborationSpace | undefined,
    eventId: string,
  ): boolean {
    if (!/^\/(?:agents|ask|space-confirm)(?:\s|$)/u.test(event.text))
      return false;
    this.queueDelivery(`${eventId}:manual`, {
      conversation: event.conversation,
      text: "此群仅支持人工派工。请在同一 IM 群里 @ 目标机器人；跨群空间与共享网关派工已退役。",
    });
    return true;
  }
  findSpace(conversation: ImConversation): CollaborationSpace | undefined {
    return this.store
      .list<CollaborationSpace>("native-groups")
      .find(
        (space) =>
          space.nativeGroup?.version === 1 &&
          space.nativeGroup.enabled &&
          space.endpoints.length === 1 &&
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
  private inheritSecurity(sourceId: string, targetId: string): void {
    const own = this.store.get<NonNullable<Delivery["security"]>>(
      "invocation-security",
      sourceId,
    );
    const inherited =
      this.store.get<Array<NonNullable<Delivery["security"]>>>(
        "invocation-dependencies",
        sourceId,
      ) ?? [];
    const dependencies = [...inherited, ...(own ? [own] : [])];
    if (dependencies.length)
      this.store.put("invocation-dependencies", targetId, dependencies);
  }
  isInvocationAuthorized(
    request: RemoteInvocationContext,
    control = request.control === "cancel",
  ): boolean {
    if (
      !control &&
      (
        this.store.get<Array<NonNullable<Delivery["security"]>>>(
          "invocation-dependencies",
          request.id,
        ) ?? []
      ).some((s) => !this.securityAllowed(s))
    )
      return false;
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
      (!control && space.revision !== request.conversation.spaceRevision) ||
      !space.participants.some(
        (p) =>
          p.deviceId === request.deviceId &&
          imIdentityKey(p.identity) === imIdentityKey(request.identity),
      )
    )
      return false;
    if (
      this.store.get(
        "group-denied-senders",
        JSON.stringify([
          space.id,
          imIdentityKey(request.originator ?? request.identity),
        ]),
      )
    )
      return false;
    if (request.originator && space.nativeGroup) {
      const row = this.store.db
        .prepare("SELECT payload FROM queue WHERE bucket='incoming' AND id=?")
        .get(request.id);
      const source = row
        ? channelEventSchema.safeParse(JSON.parse(String(row.payload)))
        : undefined;
      return (
        !!source?.success &&
        !source.data.bot &&
        source.data.mentioned &&
        source.data.timestamp >= space.nativeGroup.enabledAt &&
        source.data.messageId === request.messageId &&
        source.data.text === request.text &&
        (!request.text.trimStart().startsWith("/") ||
          /^\/(?:new|stop|status|stopwait)(?:\s|$)/iu.test(
            request.text.trim(),
          )) &&
        imIdentityKey(source.data.identity) ===
          imIdentityKey(request.originator) &&
        imConversationKey(source.data.conversation) ===
          imConversationKey(request.conversation) &&
        request.originator.channel === request.identity.channel &&
        request.originator.connectionId === request.identity.connectionId &&
        request.originator.tenantId === request.identity.tenantId &&
        request.originator.appId === request.identity.appId
      );
    }
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
  securityAllowed(
    security: NonNullable<Delivery["security"]> | undefined,
  ): boolean {
    if (!security) return false;
    const state = this.store.get<{
      grants: Array<{
        projectId: string;
        revision: string;
        audience: string;
        expiresAt: number;
      }>;
    }>("device-security", security.deviceId);
    const lease = this.store.get<{ expiresAt: number }>(
      "device-leases",
      security.deviceId,
    );
    return (
      !!lease &&
      lease.expiresAt > this.now() &&
      !!state?.grants.some(
        (g) =>
          g.projectId === security.projectId &&
          g.revision === security.revision &&
          g.audience === security.audience &&
          g.expiresAt > this.now(),
      )
    );
  }
  acceptSecurity(
    deviceId: string,
    invocationId: string,
    security: ImReply["security"],
  ): void {
    if (!security || !this.securityAllowed({ ...security, deviceId }))
      throw new Error(
        "Shared operation requires a current data grant. Upgrade and confirm IM permissions.",
      );
    const invocation = this.store.get<RemoteInvocationContext>(
      "invocations",
      invocationId,
    );
    if (
      !invocation ||
      invocation.deviceId !== deviceId ||
      security.audience !==
        (invocation.conversation.kind === "direct"
          ? "owner"
          : `space:${invocation.conversation.spaceId}`)
    )
      throw new Error("Sharing audience does not match the invocation.");
    const old = this.store.get<NonNullable<Delivery["security"]>>(
      "invocation-security",
      invocationId,
    );
    if (
      old &&
      (old.revision !== security.revision ||
        old.projectId !== security.projectId ||
        old.audience !== security.audience)
    )
      throw new Error("An invocation cannot change its security scope.");
    this.store.put("invocation-security", invocationId, {
      ...security,
      deviceId,
    });
  }
  canDeliver(delivery: Delivery): boolean {
    if (
      delivery.native &&
      delivery.native.expiresAt <= this.now() &&
      [
        "hello",
        "probe",
        "proof",
        "delegate",
        "continue",
        "cancel",
        "note",
      ].includes(delivery.native.action)
    )
      return false;

    if (delivery.native?.action === "cancel") {
      const grant = this.store.get<{
        groupId: string;
        peer: string;
        expiresAt: number;
      }>("native-revocation-cancels", delivery.native.id);
      if (grant)
        return (
          grant.groupId === delivery.conversation.spaceId &&
          grant.peer === delivery.native.recipient &&
          grant.expiresAt > this.now() &&
          delivery.native.text === "" &&
          !this.store.get<{ unavailable?: string }>(
            "native-group-info",
            grant.groupId,
          )?.unavailable
        );
    }

    if (
      delivery.native &&
      !["hello", "probe", "proof"].includes(delivery.native.action)
    ) {
      const group = this.findSpace(delivery.conversation);
      if (!group?.nativeGroup?.allowedBots?.includes(delivery.native.recipient))
        return false;
    }
    if (delivery.security && !this.securityAllowed(delivery.security))
      return false;
    if (delivery.invocationId) {
      const request = this.store.get<RemoteInvocationContext>(
        "invocations",
        delivery.invocationId,
      );
      if (!request || !this.isInvocationAuthorized(request)) return false;
      const stamp = this.store.get<NonNullable<Delivery["security"]>>(
        "invocation-security",
        request.id,
      );
      if (stamp && !this.securityAllowed(stamp)) return false;
      if (
        this.store.get("device-security", request.deviceId) &&
        delivery.taskId &&
        !delivery.security
      )
        return false;
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
      space.participants.findLast((p) => p.deviceId === deviceId)?.name ??
      "Artemis"
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
    replyId?: string,
    mention?: ImIdentity,
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
        ...(mention?.connectionId === endpoint.connectionId &&
        endpoint.kind === "group"
          ? { mentionUserId: mention.userId }
          : {}),
        ...(replyId ? { replyId } : {}),
        ...(invocationId ? { invocationId } : {}),
        ...(taskId ? { taskId } : {}),
        ...(cardKey ? { cardKey } : {}),
      });
    }
  }
  receiveReply(deviceId: string, input: unknown): void {
    const parsedReply = imReplySchema.parse(input);
    if (
      parsedReply.approval &&
      (parsedReply.visibility !== "owner" || !parsedReply.taskId)
    )
      throw new Error("Approval cards must target the task owner.");
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
      if (request.nativeTaskId) {
        this.native.reply(request, parsedReply);
        return;
      }
      if (reply.approval?.resolved) {
        const key = `${request.identity.connectionId}:${reply.approval.token}`;
        const card = this.store.get<FeishuApprovalCard>("approval-cards", key);
        if (card && card.invocationId !== request.id)
          throw new Error(
            "Approval result does not belong to this invocation.",
          );
        this.store.put("approval-results", key, reply.approval);
        if (card)
          this.store.put("approval-cards", key, {
            ...card,
            approval: reply.approval,
            consumed: true,
            closed: false,
          });
      }
      if (
        request.identity.channel === "feishu" &&
        !request.originator &&
        !request.collaboration &&
        reply.taskId &&
        (reply.started || reply.status || reply.final)
      ) {
        const taskKey = `${deviceId}:${reply.taskId}`;
        const key = `${request.identity.connectionId}:${request.messageId}`;
        for (const prior of this.store.list<FeishuTyping>("feishu-typing")) {
          if (
            prior.taskKey === taskKey &&
            prior.messageId !== request.messageId
          )
            this.store.put(
              "feishu-typing",
              `${prior.connectionId}:${prior.messageId}`,
              { ...prior, active: false },
            );
        }
        this.store.put("feishu-typing", key, {
          ...this.store.get<FeishuTyping>("feishu-typing", key),
          connectionId: request.identity.connectionId,
          messageId: request.messageId,
          invocationId: request.id,
          conversation: request.conversation,
          taskKey,
          active:
            !reply.final && (reply.status === "running" || !!reply.started),
          expiresAt: Date.now() + 300000,
        } satisfies FeishuTyping);
      }
      const space = request.conversation.spaceId
        ? this.store.get<CollaborationSpace>(
            "native-groups",
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
      // Notify the actual sender, not the receiving bot's owner. Keep progress
      // card updates quiet; actionable waits and final results need a new message.
      const mention =
        reply.taskId &&
        reply.visibility === "conversation" &&
        request.conversation.kind === "group" &&
        !reply.heartbeat &&
        (reply.final || reply.status === "waiting")
          ? (request.originator ?? request.identity)
          : undefined;
      if (cardKey && (reply.final || mention)) {
        const labels = {
          queued: "排队中",
          running: "正在执行",
          waiting: "等待处理",
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
            ...(reply.approval ? { approval: reply.approval } : {}),
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
          reply.final || mention ? undefined : cardKey,
          parsedReply.id,
          mention,
        );
      } else
        this.queueDelivery(reply.id, {
          conversation: request.conversation,
          text: reply.text,
          invocationId: request.id,
          ...(reply.taskId ? { taskId: reply.taskId } : {}),
          ...(mention ? { mentionUserId: mention.userId } : {}),
          ...(!reply.final && !mention && cardKey ? { cardKey } : {}),
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
          task.deliveryState = reply.deliveryState ?? "delivered";
          if (task.deliveryState === "delivered") task.result = reply.text;
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
          if (
            parent &&
            !parent.desktopTurnId &&
            task.deliveryState === "delivered"
          ) {
            const result = {
              ...parent,
              id: `result:${task.id}`,
              sourceKind: "tool-result" as const,
              taskId: task.coordinatorThreadId,
              text: `[协作结果 ${task.id}]\n${task.result}`,
              attachments: [],
              expiresAt: Math.min(parent.expiresAt, task.expiresAt),
            };
            this.inheritSecurity(request.id, result.id);
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
  groupConversationContext(
    deviceId: string,
    spaceId: string,
  ): RemoteInvocationContext {
    const space = this.store.get<CollaborationSpace>("native-groups", spaceId);
    const participant = space?.participants.find(
      (p) =>
        p.deviceId === deviceId &&
        this.store.get<IdentityBinding>("identities", imIdentityKey(p.identity))
          ?.deviceId === deviceId,
    );
    const endpoint =
      participant &&
      space?.endpoints.find(
        (e) => e.connectionId === participant.identity.connectionId,
      );
    if (!space || !participant || !endpoint)
      throw new Error(
        "Only a paired member can open this group's conversation.",
      );
    const id = `group:${digest(JSON.stringify([deviceId, spaceId, space.revision]))}`;
    const request = remoteInvocationSchema.parse({
      version: 1,
      id,
      deviceId,
      identity: participant.identity,
      conversation: { ...endpoint, spaceId, spaceRevision: space.revision },
      messageId: id,
      text: "",
      attachments: [],
      expiresAt: this.now() + 30 * 60_000,
    });
    if (!this.isInvocationAuthorized(request))
      throw new Error(
        "Every group must be confirmed before opening the conversation.",
      );
    this.store.put("invocations", id, request);
    return request;
  }
  desktopCollaborationContext(
    deviceId: string,
    invocationId: string,
    threadId: string,
    turnId: string,
  ): string {
    const original = this.store.get<RemoteInvocationContext>(
      "invocations",
      invocationId,
    );
    if (
      !original ||
      original.deviceId !== deviceId ||
      original.conversation.kind !== "group" ||
      !this.isInvocationAuthorized({ ...original, originator: undefined })
    )
      throw new Error(
        "Desktop collaboration requires a current authorized group binding.",
      );
    const id = `desktop:${digest(JSON.stringify([deviceId, threadId, turnId]))}`;
    const existing = this.store.get<RemoteInvocationContext>("invocations", id);
    if (existing) {
      if (existing.expiresAt <= this.now())
        throw new Error(
          "This desktop collaboration turn has expired. Start a new turn.",
        );
      return id;
    }
    const request = remoteInvocationSchema.parse({
      version: 1,
      id,
      deviceId,
      identity: original.identity,
      conversation: original.conversation,
      messageId: id,
      text: "Desktop group collaboration",
      desktopTurnId: turnId,
      attachments: [],
      expiresAt: this.now() + 30 * 60_000,
    });
    this.store.put("invocations", id, request);
    this.store.put("thread-links", `${deviceId}:${threadId}`, {
      version: 1,
      id,
      invocationId: id,
      taskId: threadId,
      text: "",
      final: false,
      visibility: "conversation",
    } satisfies ImReply);
    this.store.delete("finished-collaborations", `${deviceId}:${threadId}`);
    return id;
  }
  collaborate(
    _deviceId: string,
    _invocationId: string,
    _threadId: string,
    _command: CollaborationCommand,
  ): unknown {
    throw new Error(
      "自动协作尚未通过平台验证。请在同一 IM 群中人工 @ 目标机器人，并附上任务摘要。共享网关派工已退役。",
    );
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

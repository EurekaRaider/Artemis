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
  invocationId?: string;
  taskId?: string;
  cardKey?: string;
  approval?: ImReply["approval"];
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
    if (delivery.invocationId) {
      const security = this.store.get<NonNullable<Delivery["security"]>>(
        "invocation-security",
        delivery.invocationId,
      );
      if (security) delivery = { ...delivery, security };
    }
    const chunks = splitImText(delivery.text);
    chunks.forEach((text, index) =>
      this.store.enqueue(
        "outgoing",
        `${id}:${index}`,
        delivery.conversation.connectionId,
        { ...delivery, text, ...(index > 0 ? { approval: undefined } : {}) },
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
          if (event.conversation.kind === "group" && !space) {
            const configured = this.store
              .list<CollaborationSpace>("spaces")
              .find((candidate) =>
                candidate.endpoints.some(
                  (endpoint) =>
                    imConversationKey(endpoint) ===
                    imConversationKey(event.conversation),
                ),
              );
            const confirmations = configured
              ? (this.store.get<string[]>(
                  "space-confirmations",
                  configured.id,
                ) ?? [])
              : [];
            const pending = configured?.endpoints.filter(
              (endpoint) =>
                !confirmations.includes(imConversationKey(endpoint)),
            );
            const confirmedHere = confirmations.includes(
              imConversationKey(event.conversation),
            );
            const prefix = event.identity.channel === "slack" ? "" : "/";
            this.queueDelivery(`${item.id}:group-setup`, {
              conversation: event.conversation,
              text: configured
                ? `此群已加入协作空间“${configured.name}”。${confirmedHere ? "本群已确认" : "本群待确认"}，空间还有 ${pending!.length} 个群待确认。请让设置中选定的确认人在待确认群里 @机器人发送 ${prefix}space-confirm ${configured.id}。所有群确认后，每位成员再到 Artemis 的“项目授权”允许该空间使用自己的项目。当前不会启动任务。`
                : "已发现这个群，机器人连接正常，群协作空间尚未配置。\n请回到 Artemis → 设置 → 消息接入 → 群协作空间：\n1. 点击“刷新群和成员”，勾选此群、参与账号与电脑，并选择群确认人。\n2. 点击“保存空间并等待各群确认”，按页面给出的指令在各群确认。\n3. 每位成员到“项目授权”允许该空间使用自己的项目。\n发现群不会自动授权或启动任务；完成后再 @机器人发送任务。",
            });
            this.store.mark("incoming", item.id, "done");
            return;
          }
          if (
            event.conversation.kind === "group" &&
            space &&
            !space.participants.some(
              (p) =>
                p.deviceId === binding.deviceId &&
                imIdentityKey(p.identity) === imIdentityKey(event.identity),
            )
          ) {
            this.queueDelivery(`${item.id}:group-denied`, {
              conversation: event.conversation,
              text: "群协作空间已确认，但你的已配对账号尚未加入这个空间。请让空间管理员在 Artemis 的“群协作空间”中勾选你的账号与电脑，保存后重新完成各群确认；再在自己的“项目授权”中允许该空间使用项目。当前不会启动任务。",
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
  private routeTargetedCommand(
    event: ChannelEvent,
    space: CollaborationSpace | undefined,
    id: string,
  ): boolean {
    const input = event.text.trim();
    const command = /^\/(agents|ask)(?=\s|$)/u.exec(input)?.[1];
    if (!command) return false;
    if (event.conversation.kind !== "group" || !space)
      throw new Error(
        "请在已确认的协作空间群内 @机器人，发送 /agents 或 /ask 成员编号 任务内容。",
      );
    const participants = [
      ...new Map(
        space.participants
          .filter(
            (p) =>
              this.store.get<IdentityBinding>(
                "identities",
                imIdentityKey(p.identity),
              )?.deviceId === p.deviceId &&
              this.store.get<{ revoked: boolean }>("devices", p.deviceId)
                ?.revoked === false &&
              space.endpoints.some(
                (e) => e.connectionId === p.identity.connectionId,
              ),
          )
          .map((p) => [p.deviceId, p]),
      ).values(),
    ];
    if (command === "agents") {
      if (input !== "/agents")
        throw new Error("查看可选 Agent 请只发送 /agents。");
      this.queueDelivery(`${id}:agents`, {
        conversation: {
          ...event.conversation,
          spaceId: space.id,
          spaceRevision: space.revision,
        },
        text: `协作空间 ${space.name} 的 Agent：\n${participants.map((p) => `${p.name} · ${{ wecom: "企业微信", feishu: "飞书 / Lark", slack: "Slack" }[p.identity.channel]}\n/ask ${p.deviceId} 任务内容`).join("\n\n")}\n\n复制目标成员的指令并替换任务内容。同名成员用编号区分；任务在目标电脑执行，仍需本人授权项目与空间。Slack 指令不加开头的 /。`,
      });
      return true;
    }
    const match = /^\/ask\s+(\S+)\s+([\s\S]+)$/u.exec(input);
    if (!match?.[2]?.trim())
      throw new Error(
        "用法：/ask 成员编号 任务内容。先发送 /agents 获取准确编号。",
      );
    const targetIds = match[1]!.split(",");
    if (targetIds.length > 16 || new Set(targetIds).size !== targetIds.length)
      throw new Error("一次可选择 1–16 位不同成员，多个编号用英文逗号分隔。");
    const targets = targetIds.map((targetId) => {
      const target = participants.find((p) => p.deviceId === targetId);
      if (!target)
        throw new Error(
          "目标 Agent 不可用或不在此空间，请发送 /agents 重新选择成员编号。不会转交给其他 Agent。",
        );
      return target;
    });
    if (event.attachments.length)
      throw new Error(
        "定向派发暂只支持文字任务，请移除附件后重发。文件需由主人显式发布后共享。",
      );
    const text = match[2].trim();
    if (text.startsWith("/"))
      throw new Error(
        "请填写任务内容，不能代替目标主人发送审批、停止或其他控制指令。",
      );
    for (const target of targets) {
      const requestId = targets.length === 1 ? id : `${id}:${target.deviceId}`;
      const endpoint = space.endpoints.find(
        (e) => e.connectionId === target.identity.connectionId,
      )!;
      const request = remoteInvocationSchema.parse({
        version: 1,
        id: requestId,
        deviceId: target.deviceId,
        identity: target.identity,
        originator: event.identity,
        conversation: {
          ...endpoint,
          spaceId: space.id,
          spaceRevision: space.revision,
        },
        messageId: event.messageId,
        text,
        attachments: [],
        expiresAt: this.now() + 30 * 60_000,
      });
      if (!this.isInvocationAuthorized(request))
        throw new Error("空间或成员授权已失效，请刷新后重试。");
      this.store.put("invocations", requestId, request);
      this.store.enqueue("device", requestId, target.deviceId, request);
      const online =
        (this.store.get<{ expiresAt: number }>("device-leases", target.deviceId)
          ?.expiresAt ?? 0) > this.now();
      this.queueDelivery(`${requestId}:targeted`, {
        conversation: {
          ...event.conversation,
          spaceId: space.id,
          spaceRevision: space.revision,
        },
        invocationId: requestId,
        text: `已定向提交给 ${target.name} 的 Agent（${target.deviceId}）。${online ? "等待目标电脑检查项目与空间授权。" : "目标电脑离线或已暂停，请在 30 分钟内恢复 Artemis 和 IM 连接；恢复后会检查授权，超时不执行。"}公开进度和结果会回到此空间的所有群。`,
      });
      this.broadcast(
        space,
        `${requestId}:targeted-task`,
        `[${space.participants.find((p) => imIdentityKey(p.identity) === imIdentityKey(event.identity))!.name} → ${target.name} 的 Agent]\n${text}`,
        event.conversation,
        requestId,
      );
    }
    return true;
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
  isInvocationAuthorized(request: RemoteInvocationContext): boolean {
    if (
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
    const space = this.store.get<CollaborationSpace>("spaces", spaceId);
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
    // Match the desktop mention picker: multiple IM accounts share one executor.
    const participants = [
      ...new Map(space.participants.map((p) => [p.deviceId, p])).values(),
    ];
    if (command.action === "participants")
      return participants.map(({ deviceId: id, name }) => ({ id, name }));
    const tasks = this.store
      .list<CollaborationTask>("collaboration-tasks")
      .filter(
        (task) =>
          task.spaceId === space.id &&
          task.coordinatorDeviceId === deviceId &&
          task.coordinatorThreadId === threadId,
      );
    if (command.action === "status") return tasks;
    if (command.action === "delegate-many") {
      const assignments = command.assignments;
      if (
        !assignments?.length ||
        assignments.length > 16 ||
        new Set(assignments.map((a) => a.participantId)).size !==
          assignments.length
      )
        throw new Error("Choose 1–16 distinct participants for a batch.");
      // Either every assignment is queued or none are; execution happens on each device independently.
      return this.store.transaction(() =>
        assignments.map((a) =>
          this.collaborate(deviceId, invocationId, threadId, {
            action: "delegate",
            participantId: a.participantId,
            text: a.text,
          }),
        ),
      );
    }
    if (command.action === "delegate") {
      if (assignment)
        throw new Error(
          "Only the initiating coordinator can delegate across devices.",
        );
      if (tasks.length >= 16)
        throw new Error("Collaboration task budget reached (16 assignments).");
      if (!command.text.trim())
        throw new Error("A bounded task with a deliverable is required.");
      const participant = participants.find(
        (p) => p.deviceId === command.participantId,
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
      // Even on this device, the assignment gets a fresh invocation and task.
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
        this.inheritSecurity(request.id, invocation.id);
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
        const target = participants.find(
          (p) => p.deviceId === command.participantId,
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
        const targetAssignment = candidates.find(
          (t) =>
            t.participantDeviceId === target.deviceId &&
            (command.taskId
              ? t.id === command.taskId
              : t.id !== assignment?.id),
        );
        const targetThreadId = targetAssignment
          ? this.store.get<string>("assignment-threads", targetAssignment.id)
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
        if (original.desktopTurnId)
          throw new Error(
            "The desktop coordinator reads results through status. Publish group updates without participantId and return your final result.",
          );
        const followUp = {
          ...original,
          id: `message:${messageId}`,
          taskId: targetThreadId,
          text: `[${this.participantName(space, deviceId)} 的 Agent]\n${command.text}`,
          attachments: [],
          originator: request.identity,
        };
        this.inheritSecurity(request.id, followUp.id);
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

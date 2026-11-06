import { type Binding, type PendingAction } from "./im-runtime-types.js";

import { randomUUID } from "node:crypto";

import { type ImOutboundCandidate } from "@artemis/protocol";
import { inspectImOutbound, imContentHash } from "./im-policy.js";

import {
  assertImGatewayUrl,
  type ImReply,
  type RemoteInvocationContext,
} from "@artemis/protocol";

import type { ImServiceDependencies } from "./im-service-dependencies.js";
export function createImOutboundRuntime(
  services: Pick<
    ImServiceDependencies,
    | "get"
    | "secure"
    | "text"
    | "checkContext"
    | "put"
    | "deliverySecurity"
    | "remove"
    | "db"
    | "http"
    | "config"
    | "fullLocalAccess"
    | "ops"
    | "replyStreams"
    | "closed"
  >,
) {
  function holdOutbound(
    binding: Binding,
    kind: ImOutboundCandidate["kind"],
    body: unknown,
    reason: string,
    id: string = randomUUID(),
  ): ImOutboundCandidate {
    const existing = services.get<ImOutboundCandidate>(
      "outbound-candidates",
      id,
    );
    if (existing) {
      if (existing.contentHash !== imContentHash(JSON.stringify(body)))
        throw new Error("Delivery ID cannot be reused for different contents.");
      return existing;
    }
    if (!services.secure.isEncryptionAvailable())
      throw new Error(services.text("reviewSaveFailed"));
    services.checkContext(binding);
    const raw = JSON.stringify(body);
    const candidate: ImOutboundCandidate = {
      id,
      threadId: binding.threadId,
      kind,
      contentHash: imContentHash(raw),
      security: binding.security!,
      expiresAt: Date.now() + 300000,
      state: "pending",
      reason,
    };
    services.put(
      "outbound-bodies",
      id,
      services.secure.encryptString(raw).toString("base64"),
    );
    services.put("outbound-candidates", id, candidate);
    return candidate;
  }

  async function resolveOutbound(
    id: string,
    hash: string,
    approve: boolean,
    text?: string,
  ): Promise<void> {
    const candidate = services.get<ImOutboundCandidate>(
      "outbound-candidates",
      id,
    );
    if (
      !candidate ||
      candidate.state !== "pending" ||
      candidate.expiresAt <= Date.now() ||
      candidate.contentHash !== hash
    )
      throw new Error(services.text("reviewInvalid"));
    const binding = services.get<Binding>("bindings", candidate.threadId);
    if (!binding) throw new Error(services.text("taskUnavailable"));
    services.checkContext(binding);
    if (
      JSON.stringify(services.deliverySecurity(binding.security!)) !==
        JSON.stringify(services.deliverySecurity(candidate.security)) ||
      binding.security?.identityKey !== candidate.security.identityKey
    )
      throw new Error(services.text("authorizationChanged"));
    const encrypted = services.get<string>("outbound-bodies", id);
    if (!encrypted) throw new Error(services.text("reviewContentMissing"));
    const raw = services.secure.decryptString(Buffer.from(encrypted, "base64"));
    if (imContentHash(raw) !== hash)
      throw new Error(services.text("reviewHashMismatch"));
    if (!approve) {
      services.put("outbound-candidates", id, {
        ...candidate,
        state: "rejected",
      });
      services.remove("outbound-bodies", id);
      return;
    }
    const body = JSON.parse(raw);
    if (text !== undefined && candidate.kind !== "reply")
      throw new Error(services.text("resultNotText"));
    if (text !== undefined) body.text = text;
    // Freeze edited text too. Only transport is retried; the task never runs again.
    const frozen = JSON.stringify(body);
    const approved = {
      ...candidate,
      state: "sending" as const,
      contentHash: imContentHash(frozen),
    };
    const sealed = services.secure.encryptString(frozen).toString("base64");
    services.db.exec("BEGIN IMMEDIATE");
    try {
      services.put("outbound-bodies", id, sealed);
      services.put("outbound-candidates", id, approved);
      services.db.exec("COMMIT");
    } catch (error) {
      services.db.exec("ROLLBACK");
      throw error;
    }
    await handlers.deliverApproved(approved);
  }

  function recordNativeFile(
    binding: Binding,
    invocationId: string,
    name: string,
  ): void {
    const parentThreadId = binding.parentThreadId;
    if (!parentThreadId) return;
    const id = `artifact:${invocationId}`;
    services.put("native-messages", JSON.stringify([parentThreadId, id]), {
      parentThreadId,
      id,
      text: `📎 ${name}`,
      state: "submitted",
    });
  }

  async function deliverApproved(
    candidate: ImOutboundCandidate,
  ): Promise<void> {
    const binding = services.get<Binding>("bindings", candidate.threadId);
    if (!binding || candidate.expiresAt <= Date.now())
      throw new Error(services.text("outboundExpired"));
    services.checkContext(binding);
    if (
      JSON.stringify(services.deliverySecurity(binding.security!)) !==
        JSON.stringify(services.deliverySecurity(candidate.security)) ||
      binding.security?.identityKey !== candidate.security.identityKey
    )
      throw new Error(services.text("outboundAuthorizationChanged"));
    const encrypted = services.get<string>("outbound-bodies", candidate.id);
    if (!encrypted) throw new Error(services.text("outboundContentMissing"));
    const raw = services.secure.decryptString(Buffer.from(encrypted, "base64"));
    if (imContentHash(raw) !== candidate.contentHash)
      throw new Error(services.text("outboundHashMismatch"));
    const body = JSON.parse(raw);
    if (candidate.kind === "reply") {
      services.put("outbox", body.id, body);
      return;
    }
    if (candidate.kind === "collaborate")
      await services.http("/v1/device/collaborate", "POST", body);
    else {
      const result = await (
        await services.http("/v1/device/artifacts", "POST", body)
      ).json();
      if (result.native)
        handlers.recordNativeFile(binding, body.invocationId, body.name);
      handlers.reply(
        binding.request,
        result.native
          ? services.text("fileQueuedStatus", binding.request)
          : services.text("filePublished", binding.request, {
              url: `${assertImGatewayUrl(services.config.gatewayUrl).origin}${result.path}`,
            }),
        binding.threadId,
        false,
        "conversation",
        `${candidate.id}:published`,
      );
    }
    services.put("outbound-candidates", candidate.id, {
      ...candidate,
      state: "sent",
    });
    services.remove("outbound-bodies", candidate.id);
  }

  function reply(
    request: RemoteInvocationContext,
    text: string,
    taskId?: string,
    final = false,
    visibility: ImReply["visibility"] = "conversation",
    id: string = randomUUID(),
    outcome?: ImReply["outcome"],
    started = false,
    status?: ImReply["status"],
    approval?: ImReply["approval"],
    stream = false,
  ): void {
    const reply: ImReply = {
      version: 1,
      id,
      invocationId: request.id,
      text: text.slice(0, 64000),
      visibility,
      final,
      ...(started ? { started: true } : {}),
      ...(status || started || final
        ? { status: status ?? (started ? "running" : (outcome ?? "completed")) }
        : {}),
      ...(outcome ? { outcome } : {}),
      ...(taskId ? { taskId } : {}),
      ...(approval ? { approval } : {}),
      ...(stream ? { stream: true } : {}),
    };
    const binding = taskId
      ? services.get<Binding>("bindings", taskId)
      : undefined;
    if (taskId && !binding) delete reply.taskId;
    if (binding) {
      try {
        services.checkContext(binding);
      } catch {
        reply.text = services.text("scopeExpired", request);
        delete reply.taskId;
        delete reply.approval;
        delete reply.started;
        reply.final = false;
        services.put("outbox", reply.id, reply);
        return;
      }
      if (binding.security) {
        reply.security = services.deliverySecurity(binding.security);
        const reason = services.fullLocalAccess(binding)
          ? undefined
          : inspectImOutbound(reply.text, services.ops.locale?.() ?? "zh-CN");
        if (reason) {
          handlers.holdOutbound(binding, "reply", reply, reason, reply.id);
          services.put("outbox", `${reply.id}:held`, {
            ...reply,
            id: `${reply.id}:held`,
            text: services.text("heldResult", request),
            deliveryState: "pending",
            status: "waiting",
            approval: undefined,
          });
          return;
        }
      }
      // Owner direct chats return results using their paired identity.
    } else if (
      inspectImOutbound(reply.text, services.ops.locale?.() ?? "zh-CN")
    )
      reply.text = services.text("failedDesktop", request);
    if (
      binding?.parentThreadId &&
      !binding.privateLocal &&
      visibility === "conversation" &&
      !request.nativeTaskId
    ) {
      const key = JSON.stringify([binding.parentThreadId, reply.id]);
      const previous = services.get<{ time: number }>("native-messages", key);
      services.put("native-messages", key, {
        parentThreadId: binding.parentThreadId,
        id: reply.id,
        text: reply.text,
        state: "queued",
        time: previous?.time ?? Date.now(),
      });
    }
    services.put("outbox", reply.id, reply);
  }

  function replyApprovalResult(
    binding: Binding,
    action: PendingAction,
    approved: boolean,
    id: string,
  ): void {
    handlers.reply(
      binding.request,
      `${services.text("task", binding.request, { id: action.threadId })}\n${services.text(approved ? "approved" : "denied", binding.request)}`,
      action.threadId,
      false,
      "owner",
      `${id}:approval-result`,
      undefined,
      false,
      undefined,
      {
        token: action.token,
        expiresAt: action.expiresAt,
        resolved: approved ? "approved" : "denied",
      },
    );
  }

  function finalText(
    threadId: string,
    turnId?: string,
    partId?: string,
  ): string {
    const events = services.ops
      .events(threadId)
      .filter(
        (e) => e.turnId === turnId && e.payload.type === "message.part.delta",
      );
    const parts = new Map<string, string>();
    for (const event of events) {
      const p = event.payload;
      if (p.type === "message.part.delta" && p.partType === "text")
        parts.set(p.partId, (parts.get(p.partId) ?? "") + p.delta);
    }
    return partId
      ? (parts.get(partId) ?? "")
      : ([...parts.values()].at(-1) ?? "");
  }

  function observeReplyStream(
    binding: Binding,
    threadId: string,
    turnId: string,
    delta: string,
  ): void {
    if (
      binding.request.identity.channel !== "feishu" ||
      binding.request.conversation.kind !== "direct" ||
      binding.request.conversation.spaceId ||
      !binding.projectId
    )
      return;
    const state = services.replyStreams.get(threadId) ?? {
      text: "",
      turnId,
      lastAt: 0,
    };
    if (state.turnId !== turnId) {
      if (state.timer) clearTimeout(state.timer);
      state.text = "";
      state.turnId = turnId;
      state.lastAt = 0;
    }
    state.text = (state.text + delta).slice(-60000);
    services.replyStreams.set(threadId, state);
    const elapsed = Date.now() - state.lastAt;
    if (elapsed >= 1000) {
      handlers.flushReplyStream(binding, threadId);
    } else if (!state.timer) {
      state.timer = setTimeout(
        () => handlers.flushReplyStream(binding, threadId),
        1000 - elapsed,
      );
    }
  }

  function flushReplyStream(binding: Binding, threadId: string): void {
    if (services.closed || !services.config.enabled) return;
    if (
      services.get<Binding>("bindings", threadId)?.request.id !==
      binding.request.id
    ) {
      handlers.clearReplyStream(threadId);
      return;
    }
    const state = services.replyStreams.get(threadId);
    if (!state) return;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = undefined;
    }
    state.lastAt = Date.now();
    if (
      !state.text.trim() ||
      inspectImOutbound(state.text, services.ops.locale?.() ?? "zh-CN")
    )
      return;
    try {
      services.checkContext(binding);
    } catch {
      return;
    }
    handlers.reply(
      binding.request,
      state.text,
      threadId,
      false,
      "conversation",
      `${state.turnId}:stream:${Date.now()}`,
      undefined,
      false,
      "running",
      undefined,
      true,
    );
  }

  function clearReplyStream(threadId: string): void {
    const state = services.replyStreams.get(threadId);
    if (!state) return;
    if (state.timer) clearTimeout(state.timer);
    services.replyStreams.delete(threadId);
  }
  const handlers = {
    holdOutbound,
    resolveOutbound,
    recordNativeFile,
    deliverApproved,
    reply,
    replyApprovalResult,
    finalText,
    observeReplyStream,
    flushReplyStream,
    clearReplyStream,
  };
  return handlers;
}

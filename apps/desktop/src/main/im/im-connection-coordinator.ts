import { errorMessage, busy } from "./im-runtime-values.js";
import type { Binding, Receipt } from "./im-runtime-types.js";

import { randomUUID } from "node:crypto";

import {
  IM_SECURITY_VERSION,
  type ImOutboundCandidate,
} from "@artemis/protocol";

import { z } from "zod";
import {
  assertImGatewayUrl,
  imPairingRequestSchema,
  remoteInvocationSchema,
  type ImReply,
  type ImStatus,
} from "@artemis/protocol";

import type { ImCoordinatorDependencies } from "./im-coordinator-dependencies.js";
export function createImConnectionCoordinator(
  services: Pick<
    ImCoordinatorDependencies,
    | "config"
    | "get"
    | "closed"
    | "localGateway"
    | "usesLocalGateway"
    | "put"
    | "text"
    | "ensureLocalGateway"
    | "manage"
    | "refreshConnection"
    | "error"
    | "status"
    | "token"
    | "sessionId"
    | "ops"
    | "localActivity"
    | "leaseUntil"
    | "polling"
    | "state"
    | "list"
    | "grant"
    | "cancelOperations"
    | "http"
    | "reconciled"
    | "observe"
    | "drain"
    | "drainDelegationWaits"
    | "checkContext"
    | "remove"
    | "fullLocalAccess"
    | "resolveOutbound"
    | "deliverApproved"
    | "securityReady"
    | "applyRetiredGroups"
    | "syncSecurity"
    | "identities"
    | "pairingRequests"
    | "removedConnections"
    | "channelStatus"
    | "spaces"
    | "displaySpaces"
    | "syncingGroups"
    | "syncGroupConversations"
    | "groupConversationError"
  >,
) {
  function usesLocalGateway(): boolean {
    return (
      !!services.config.deviceId &&
      services.get<string>("gateway", "local-device") ===
        services.config.deviceId
    );
  }

  async function ensureLocalGateway() {
    if (services.closed) throw new Error("IM service is shutting down.");
    const credential = await services.localGateway.start();
    if (services.closed) throw new Error("IM service is shutting down.");
    if (
      services.usesLocalGateway() &&
      services.config.gatewayUrl !== credential.url
    ) {
      services.config = { ...services.config, gatewayUrl: credential.url };
      services.put("settings", "current", services.config);
    }
    return credential;
  }

  async function setupLocalGateway(): Promise<ImStatus> {
    if (services.config.enabled && !services.usesLocalGateway())
      throw new Error(services.text("pauseBeforeSwitch"));
    const credential = await services.ensureLocalGateway();
    if (!services.usesLocalGateway()) {
      await services.manage({
        action: "register",
        gatewayUrl: credential.url,
        adminToken: credential.token,
        name: services.config.deviceName,
      });
      services.put("gateway", "local-device", services.config.deviceId);
    }
    await services.refreshConnection();
    services.error = undefined;
    return services.status();
  }

  async function http(
    path: string,
    method = "GET",
    body?: unknown,
    credential?: { url: string; token: string },
  ): Promise<Response> {
    if (!credential && services.usesLocalGateway())
      await services.ensureLocalGateway();
    const requestedAt = Date.now();
    const origin = assertImGatewayUrl(
      credential?.url ?? services.config.gatewayUrl,
    ).origin;
    const response = await fetch(origin + path, {
      method,
      headers: {
        Authorization: `Bearer ${credential?.token ?? services.token}`,
        "X-Artemis-Device": services.config.deviceId,
        "X-Artemis-Security-Version": String(IM_SECURITY_VERSION),
        "X-Artemis-Session": services.sessionId,
        "X-Artemis-Locale": services.ops.locale?.() ?? "zh-CN",
        ...(path === "/v1/device/status"
          ? { "X-Artemis-Activity": services.localActivity() }
          : {}),
        "Content-Type": "application/json",
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 409)
        services.leaseUntil = 0;
      const result = await response.json().catch(() => ({}));
      throw new Error(
        typeof result.error === "string"
          ? result.error
          : `Gateway returned ${response.status}.`,
      );
    }
    // Use the local request time, independent of the Gateway's clock. A slow response only shortens this lease.
    const lease = Number(response.headers.get("x-artemis-lease-until"));
    if (lease > 0) services.leaseUntil = requestedAt + 40000;
    return response;
  }

  async function poll(): Promise<void> {
    if (
      services.polling ||
      services.closed ||
      !services.config.enabled ||
      !services.token
    )
      return;
    services.polling = true;
    services.state =
      services.state === "connected" ? "connected" : "connecting";
    try {
      await services.refreshConnection();
      if (services.closed) return;
      for (const binding of services.list<Binding>("bindings"))
        try {
          services.grant(binding);
        } catch {
          services.cancelOperations(binding.threadId);
          if (
            services.ops.thread(binding.threadId) &&
            busy(services.ops.thread(binding.threadId)!)
          )
            await services.ops.cancel(binding.threadId);
        }
      const inbox = await (await services.http("/v1/device/inbox")).json();
      for (const input of z
        .array(remoteInvocationSchema)
        .parse(inbox.requests)) {
        if (!services.get("receipts", input.id))
          services.put("receipts", input.id, {
            request: input,
            state: "pending",
          } satisfies Receipt);
        await services.http("/v1/device/ack", "POST", { id: input.id });
      }
      if (services.closed) return;
      if (services.ops.ready() && services.usesLocalGateway()) {
        // Receipts deliberately survive deletion to prevent redelivery from
        // recreating a task. They also repair orphaned native state after restart.
        for (const receipt of services.list<Receipt>("receipts")) {
          if (
            receipt.state !== "done" ||
            !receipt.request.nativeTaskId ||
            !receipt.threadId ||
            services.ops.thread(receipt.threadId) ||
            services.get("deleted-native-tasks", receipt.request.id)
          )
            continue;
          await services.http("/v1/device/native-task-deleted", "POST", {
            invocationId: receipt.request.id,
            threadId: receipt.threadId,
          });
          services.put("deleted-native-tasks", receipt.request.id, true);
        }
      }
      if (!services.reconciled && services.ops.ready()) {
        for (const binding of services.list<Binding>("bindings"))
          services.observe(services.ops.events(binding.threadId));
        services.reconciled = true;
      }
      await services.drain();
      await services.drainDelegationWaits();
      for (const binding of services.list<Binding>("bindings")) {
        if (
          !binding.request.nativeTaskId ||
          !services.ops.thread(binding.threadId) ||
          !busy(services.ops.thread(binding.threadId)!)
        )
          continue;
        const key = `${binding.threadId}:${binding.request.nativeTaskId}`;
        if (
          Date.now() - (services.get<number>("task-heartbeats", key) ?? 0) <
          60_000
        )
          continue;
        services.checkContext(binding);
        const id = randomUUID();
        services.put("outbox", id, {
          version: 1,
          id,
          invocationId: binding.request.id,
          taskId: binding.threadId,
          text: services.text("heartbeat", binding.request),
          final: false,
          heartbeat: true,
          visibility: "conversation",
        } satisfies ImReply);
        services.put("task-heartbeats", key, Date.now());
      }
      for (const candidate of services.list<ImOutboundCandidate>(
        "outbound-candidates",
      )) {
        if (!["sending", "pending"].includes(candidate.state)) continue;
        if (candidate.expiresAt <= Date.now()) {
          services.put("outbound-candidates", candidate.id, {
            ...candidate,
            state: "expired",
          });
          services.remove("outbound-bodies", candidate.id);
          services.remove("outbox", candidate.id);
          continue;
        }
        if (candidate.state === "pending") {
          const binding = services.get<Binding>("bindings", candidate.threadId);
          try {
            if (binding && services.fullLocalAccess(binding)) {
              // Recover results held by older builds, only under the same live
              // scope, recipient, content hash and expiry checked by the journal.
              await services.resolveOutbound(
                candidate.id,
                candidate.contentHash,
                true,
              );
              services.remove("outbox", `${candidate.id}:held`);
            }
          } catch {
            // Preserve the journal for transport retry or explicit scope expiry.
          }
          continue;
        }
        if (candidate.state === "sending") {
          const binding = services.get<Binding>("bindings", candidate.threadId);
          try {
            if (!binding) throw new Error();
            services.checkContext(binding);
          } catch {
            services.put("outbound-candidates", candidate.id, {
              ...candidate,
              state: "expired",
            });
            services.remove("outbound-bodies", candidate.id);
            services.remove("outbox", candidate.id);
            continue;
          }
          await services.deliverApproved(candidate);
        }
      }
      for (const reply of services.list<ImReply>("outbox")) {
        if (reply.taskId) {
          const binding = services.get<Binding>("bindings", reply.taskId);
          try {
            if (!binding) throw new Error("Legacy delivery");
            services.checkContext(binding);
            if (binding.security) {
              if (!reply.security) throw new Error("Legacy delivery");
              if (reply.security.revision !== binding.security.revision)
                throw new Error("Stale delivery");
            }
            // Ad-hoc replies carry no security stamp by design.
          } catch {
            services.remove("outbox", reply.id);
            continue;
          }
        }
        await services.http("/v1/device/reply", "POST", reply);
        services.remove("outbox", reply.id);
        for (const message of services.list<{
          parentThreadId: string;
          id: string;
          text: string;
          state: string;
        }>("native-messages")) {
          if (message.id === reply.id)
            services.put(
              "native-messages",
              JSON.stringify([message.parentThreadId, message.id]),
              { ...message, state: "submitted" },
            );
        }
        const candidate = services.get<ImOutboundCandidate>(
          "outbound-candidates",
          reply.id,
        );
        if (candidate?.state === "sending") {
          services.put("outbound-candidates", reply.id, {
            ...candidate,
            state: "sent",
          });
          services.remove("outbound-bodies", reply.id);
        }
      }
      services.state = "connected";
      services.error = undefined;
    } catch (error) {
      services.state = "error";
      services.error = errorMessage(error);
      if (!services.closed && services.leaseUntil <= Date.now())
        for (const binding of services.list<Binding>("bindings")) {
          services.cancelOperations(binding.threadId);
          const thread = services.ops.thread(binding.threadId);
          if (thread && busy(thread))
            await services.ops.cancel(binding.threadId).catch(() => undefined);
        }
    } finally {
      services.polling = false;
    }
  }

  async function refreshConnection(): Promise<void> {
    if (!services.token || !services.config.deviceId) return;
    const status = await (await services.http("/v1/device/status")).json();
    services.securityReady = status.securityVersion === IM_SECURITY_VERSION;
    await services.applyRetiredGroups(status.retiredGroups);
    if (services.securityReady) await services.syncSecurity();
    services.identities = z
      .array(remoteInvocationSchema.shape.identity)
      .parse(status.identities);
    services.pairingRequests = z
      .array(imPairingRequestSchema)
      .parse(status.pairingRequests ?? []);
    services.removedConnections = new Set(
      Array.isArray(status.removedConnections)
        ? (status.removedConnections as unknown[]).filter(
            (id): id is string => typeof id === "string",
          )
        : [],
    );
    services.channelStatus = Array.isArray(status.connections)
      ? status.connections.map((connection: Record<string, unknown>) => ({
          ...connection,
          ...(typeof connection.callbackPath === "string" &&
          /^\/channels\/feishu\/[\w-]+$/u.test(connection.callbackPath)
            ? {
                callbackUrl: new URL(
                  connection.callbackPath,
                  assertImGatewayUrl(services.config.gatewayUrl).origin,
                ).href,
              }
            : {}),
        }))
      : [];
    services.spaces = Array.isArray(status.spaces) ? status.spaces : [];
    const currentSpaces = services.displaySpaces();
    for (const binding of services.list<Binding>("bindings")) {
      if (!binding.targetDeviceIds) continue;
      const space = currentSpaces.find(
        (s) => s.id === binding.request.conversation.spaceId,
      );
      if (!space) continue;
      const targetDeviceIds = binding.targetDeviceIds.filter((id) =>
        space.participants.some((m) => m.deviceId === id),
      );
      if (targetDeviceIds.length !== binding.targetDeviceIds.length)
        services.put("bindings", binding.threadId, {
          ...binding,
          targetDeviceIds,
        });
    }
    services.syncingGroups ??= services
      .syncGroupConversations()
      .then(
        () => {
          services.groupConversationError = undefined;
        },
        (error) => {
          services.groupConversationError = errorMessage(error);
        },
      )
      .finally(() => {
        services.syncingGroups = undefined;
      });
    await services.syncingGroups;
  }
  const handlers = {
    usesLocalGateway,
    ensureLocalGateway,
    setupLocalGateway,
    http,
    poll,
    refreshConnection,
  };
  return handlers;
}

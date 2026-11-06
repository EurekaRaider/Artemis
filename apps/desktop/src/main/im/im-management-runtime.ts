import { busy } from "./im-runtime-values.js";
import { type Binding } from "./im-runtime-types.js";

import { formatImTaskTitle } from "../conversation/task-title.js";
import { SlackSetupService } from "./slack-setup-service.js";

import { type DelegationWait } from "./im-delegation-waits.js";
import { randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";

import {
  beginFeishuScan,
  fetchFeishuBotInfo,
  pollFeishuScan,
} from "./feishu-register.js";

import {
  type ImAuthorizationOperation,
  IM_SECURITY_VERSION,
  imScopeConfirmation,
  type ImOutboundCandidate,
  type ExecutionGrant,
  type CollaborationSpace,
} from "@artemis/protocol";
import { inspectImOutbound, imScopeEntries } from "./im-policy.js";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { z } from "zod";
import {
  assertImGatewayUrl,
  imGroupMentionTargets,
  imIdentityKey,
  imManagementSchema,
  type ImManagement,
} from "@artemis/protocol";

import { readLegacyImSettings } from "./im-legacy-import.js";

import type { ImServiceDependencies } from "./im-service-dependencies.js";
export function createImManagementRuntime(
  services: Pick<
    ImServiceDependencies,
    | "config"
    | "usesLocalGateway"
    | "slackRuntime"
    | "slackSetup"
    | "directory"
    | "secure"
    | "refreshConnection"
    | "channelStatus"
    | "serializeAuthorization"
    | "pendingAuthorizations"
    | "get"
    | "submitGroupAuthorization"
    | "checkContext"
    | "delegationWaits"
    | "remove"
    | "cancelDelegationTask"
    | "text"
    | "ops"
    | "list"
    | "put"
    | "resolveOutbound"
    | "fullLocalAccess"
    | "starts"
    | "groupContext"
    | "status"
    | "displaySpaces"
    | "legacyImports"
    | "localSetup"
    | "setupLocalGateway"
    | "http"
    | "db"
    | "token"
    | "localGateway"
    | "identities"
    | "pairingRequests"
    | "removedConnections"
    | "spaces"
    | "ensureLocalGateway"
    | "savePreparedSettings"
    | "prepareSettings"
    | "state"
    | "taskState"
    | "finalText"
    | "reply"
    | "grant"
    | "cancelOperations"
  >,
) {
  async function manage(
    input: ImManagement,
    serialized = false,
  ): Promise<unknown> {
    const action = imManagementSchema.parse(input);
    if (
      action.action === "slack-setup-start" ||
      action.action === "slack-setup-submit" ||
      action.action === "slack-setup-status" ||
      action.action === "slack-setup-cancel"
    ) {
      if (!services.config.deviceId || !services.usesLocalGateway())
        throw new Error(
          "Slack automatic setup requires the registered local Gateway.",
        );
      if (!services.slackRuntime)
        throw new Error("Bundled Slack CLI is unavailable.");
      services.slackSetup ??= new SlackSetupService({
        directory: join(services.directory, "slack-setup"),
        secure: services.secure,
        runtime: services.slackRuntime,
        owner: () =>
          services.usesLocalGateway() ? services.config.deviceId : "remote",
        connections: async () => {
          await services.refreshConnection();
          return services.channelStatus.flatMap((value) => {
            const connection = value as {
              id?: string;
              name?: string;
              channel?: string;
            };
            return connection.channel === "slack" &&
              typeof connection.id === "string" &&
              typeof connection.name === "string"
              ? [{ id: connection.id, name: connection.name }]
              : [];
          });
        },
        connect: async (connection, signal) => {
          const deviceId = services.config.deviceId;
          await services.serializeAuthorization(async () => {
            signal.throwIfAborted();
            if (
              !services.usesLocalGateway() ||
              services.config.deviceId !== deviceId ||
              services.pendingAuthorizations().length
            )
              throw new Error("Slack setup identity or authorization changed.");
            await handlers.manage(
              {
                action: "admin",
                operation: "connections",
                configuration: connection,
              },
              true,
            );
            for (let attempt = 0; attempt < 30; attempt++) {
              await services.refreshConnection();
              const current = services.channelStatus.find(
                (value) => (value as { id?: string }).id === connection.id,
              ) as { state?: string } | undefined;
              if (current?.state === "connected") return;
              signal.throwIfAborted();
              await wait(1000, undefined, { signal });
            }
            throw new Error("Slack Gateway connection could not be confirmed.");
          });
        },
      });
      if (action.action === "slack-setup-start")
        return services.slackSetup.start(action.name, action.sessionId);
      if (action.action === "slack-setup-submit")
        return services.slackSetup.submit(action.sessionId, action.challenge);
      if (action.action === "slack-setup-cancel")
        return services.slackSetup.cancel(action.sessionId);
      return services.slackSetup.status(action.sessionId);
    }
    if (
      services.get("migrations", "authorization-v1") &&
      (action.action === "authorize-native-group" ||
        (action.action === "admin" && action.operation === "native-group"))
    )
      throw new Error(
        "Use the versioned group authorization command to change bindings.",
      );
    if (
      !serialized &&
      (action.action === "authorize-native-group" ||
        action.action === "register" ||
        action.action === "resolve-pairing" ||
        action.action === "set-group-member-assignment" ||
        action.action === "unpair" ||
        (action.action === "admin" &&
          action.operation !== "status" &&
          action.operation !== "refresh-groups"))
    ) {
      return services.serializeAuthorization(async () => {
        if (services.pendingAuthorizations().length)
          throw new Error(
            "Resolve pending group authorization before changing its identity or binding.",
          );
        return handlers.manage(action, true);
      });
    }
    if (action.action === "authorize-group")
      return services.serializeAuthorization(() =>
        services.submitGroupAuthorization(action.command),
      );
    if (action.action === "retry-group-authorization")
      return services.serializeAuthorization(async () => {
        const operation = services.get<ImAuthorizationOperation>(
          "group-authorizations",
          action.operationId,
        );
        if (!operation) throw new Error("Authorization operation not found.");
        return services.submitGroupAuthorization(operation.command);
      });
    if (
      action.action === "delegation-retry" ||
      action.action === "delegation-continue-wait"
    ) {
      const wait = services.get<DelegationWait>(
        "delegation-waits",
        action.waitId,
      );
      if (!wait) throw new Error("Delegation wait not found.");
      const binding = services.get<Binding>("bindings", wait.threadId);
      if (!binding) throw new Error("Delegation conversation unavailable.");
      services.checkContext(binding);
      if (action.action === "delegation-retry")
        services.delegationWaits.approveRetry(wait.id);
      else services.delegationWaits.continueWaiting(wait.id);
      services.remove(
        "cancelled-delegation-turns",
        JSON.stringify([wait.threadId, wait.id]),
      );
      services.remove(
        "delegation-interrupted-turns",
        JSON.stringify([wait.threadId, wait.id]),
      );
      return {
        state:
          action.action === "delegation-retry" ? "retry-approved" : "waiting",
      };
    }
    if (action.action === "delegation-stop-wait") {
      const wait = services.get<DelegationWait>(
        "delegation-waits",
        action.waitId,
      );
      if (!wait) throw new Error("Delegation wait not found.");
      await Promise.all(
        wait.tasks.map((task) =>
          services.cancelDelegationTask(wait.threadId, task.id),
        ),
      );
      return { state: "cancelled", remoteCancelled: false };
    }
    if (action.action === "delegation-cancel") {
      const wait = services.get<DelegationWait>(
        "delegation-waits",
        action.waitId,
      );
      if (!wait) throw new Error("Delegation wait not found.");
      // Persist cancellation before any asynchronous local or remote work.
      const local = wait.tasks.map((task) =>
        services.cancelDelegationTask(wait.threadId, task.id),
      );
      const results = await Promise.allSettled([
        ...local,
        ...wait.tasks.map((task) =>
          handlers.manage({
            action: "native-cancel",
            groupId: wait.groupId,
            taskId: task.id,
            messageId: randomUUID(),
          }),
        ),
      ]);
      if (results.slice(0, local.length).some((r) => r.status === "rejected"))
        throw new Error(services.text("cancelLocalUnconfirmed"));
      if (
        results
          .slice(local.length)
          .some((result) => result.status === "rejected")
      )
        throw new Error(services.text("cancelRemoteUnconfirmed"));
      return { state: "cancel-sent" };
    }
    if (action.action === "scope-entries") {
      const project = services.ops
        .projects()
        .find((p) => p.id === action.projectId);
      if (!project) throw new Error(services.text("projectMissing"));
      return imScopeEntries(project.path, action.path);
    }
    if (action.action === "outbound-list") {
      for (const value of services.list<ImOutboundCandidate>(
        "outbound-candidates",
      )) {
        if (value.expiresAt <= Date.now()) {
          if (value.state === "pending")
            services.put("outbound-candidates", value.id, {
              ...value,
              state: "expired",
            });
          services.remove("outbound-bodies", value.id);
        }
      }
      return services
        .list<ImOutboundCandidate>("outbound-candidates")
        .filter((c) => c.state === "pending");
    }
    if (action.action === "outbound-preview") {
      const candidate = services.get<ImOutboundCandidate>(
        "outbound-candidates",
        action.id,
      );
      if (
        !candidate ||
        candidate.state !== "pending" ||
        candidate.expiresAt <= Date.now()
      )
        throw new Error(services.text("reviewExpired"));
      const binding = services.get<Binding>("bindings", candidate.threadId);
      if (!binding) throw new Error(services.text("taskUnavailable"));
      services.checkContext(binding);
      const encrypted = services.get<string>("outbound-bodies", action.id);
      if (!encrypted) throw new Error(services.text("reviewContentMissing"));
      return {
        ...candidate,
        body: JSON.parse(
          services.secure.decryptString(Buffer.from(encrypted, "base64")),
        ),
      };
    }
    if (action.action === "outbound-resolve") {
      await services.resolveOutbound(
        action.id,
        action.contentHash,
        action.approve,
        action.text,
      );
      return { resolved: true };
    }
    if (action.action === "handoff") {
      if (!action.text.trim())
        throw new Error(services.text("selectHandoffText"));
      const binding = services.get<Binding>("bindings", action.threadId);
      if (!binding)
        throw new Error(services.text("selectRestrictedConversation"));
      services.checkContext(binding);
      if (
        !services.fullLocalAccess(binding) &&
        inspectImOutbound(action.text, services.ops.locale?.() ?? "zh-CN")
      )
        throw new Error(services.text("handoffContainsReview"));
      await services.ops.start(
        action.threadId,
        `[${services.text("handoffMaterialLabel")}]\n${action.text}`,
        services.ops.thread(action.threadId)!.mode,
        [],
      );
      return { threadId: action.threadId };
    }
    if (action.action === "remove-conversation-member") {
      const binding = services.get<Binding>("bindings", action.threadId);
      const thread = services.ops.thread(action.threadId);
      if (!binding || !thread || !binding.request.conversation.spaceId)
        throw new Error(services.text("groupConversationMissing"));
      if (busy(thread) || services.starts.has(thread.id))
        throw new Error(services.text("stopBeforeMemberRemoval"));
      const targets =
        binding.targetDeviceIds ??
        imGroupMentionTargets(services.groupContext(binding)).map(
          (m) => m.deviceId,
        );
      const targetDeviceIds = targets.filter((id) => id !== action.deviceId);
      services.put("bindings", thread.id, { ...binding, targetDeviceIds });
      return services.status();
    }
    if (action.action === "open-group-conversation") {
      throw new Error(services.text("legacySpaceRetired"));
    }
    if (action.action === "rename-group-member") {
      await services.refreshConnection();
      const members = services.displaySpaces().flatMap((s) => s.participants);
      const identities = [
        ...new Map(
          members
            .filter(
              (m) =>
                m.deviceId === action.deviceId &&
                (!action.identity ||
                  imIdentityKey(m.identity) === imIdentityKey(action.identity)),
            )
            .map((m) => [imIdentityKey(m.identity), m.identity]),
        ).values(),
      ];
      if (!identities.length)
        throw new Error(services.text("memberUnavailable"));
      if (identities.length !== 1)
        throw new Error(services.text("chooseAccount"));
      services.put(
        "member-labels",
        JSON.stringify([
          services.config.deviceId,
          action.deviceId,
          imIdentityKey(identities[0]!),
        ]),
        {
          name: action.name,
          deviceName: action.deviceName,
        },
      );
      return services.status();
    }
    if (action.action === "preview-legacy")
      throw new Error("Legacy import requires the desktop file dialog.");
    if (action.action === "import-legacy") {
      const pending = services.legacyImports.get(action.importId);
      if (
        !pending ||
        pending.expiresAt <= Date.now() ||
        pending.gatewayUrl !== services.config.gatewayUrl
      )
        throw new Error(services.text("importPreviewExpired"));
      const id = `feishu-import-${randomUUID()}`;
      await handlers.manage({
        action: "admin",
        operation: "connections",
        ...(action.adminToken ? { adminToken: action.adminToken } : {}),
        configuration: {
          ...pending.config,
          id,
          channel: "feishu",
          transport: "websocket",
          enabled: true,
          tenantId: action.tenantId,
          botOpenId: action.botOpenId,
        },
      });
      services.legacyImports.delete(action.importId);
      return { id, requiresPairing: true, requiresProjectGrant: false };
    }
    if (action.action === "feishu-scan-begin")
      return beginFeishuScan(action.domain, services.ops.locale?.() ?? "zh-CN");
    if (action.action === "feishu-scan-poll")
      return pollFeishuScan({
        deviceCode: action.deviceCode,
        domain: action.domain,
      });
    if (action.action === "feishu-scan-connect") {
      // 扫码凭据走与手动表单相同的连接保存通道：网关负责解析剩余平台身份
      // （tenantId/botOpenId）；扫码会话若带回 tenant_key 则直接跳过企业解析。
      const id = `feishu-${randomUUID()}`;
      // 注册服务不总带应用名：用刚换到的凭据直接向飞书取机器人资料，
      // 拿真实应用名与机器人 open id；失败不阻断建连，仅保留回落名。
      const bot = await fetchFeishuBotInfo(
        action.domain ?? "feishu",
        action.appId,
        action.appSecret,
      ).catch(() => undefined);
      await handlers.manage({
        action: "admin",
        operation: "connections",
        configuration: {
          id,
          name: bot?.name ?? action.appName ?? `Feishu ${id.slice(7, 15)}`,
          channel: "feishu",
          transport: "websocket",
          domain: action.domain ?? "feishu",
          appId: action.appId,
          appSecret: action.appSecret,
          ...(action.tenantId ? { tenantId: action.tenantId } : {}),
          ...(bot?.botOpenId ? { botOpenId: bot.botOpenId } : {}),
          enabled: true,
        },
      });
      await services.refreshConnection();
      // The renderer chains the pairing-code dialog right after a scan, so
      // the freshly minted connection id travels with the status.
      return { connectionId: id, status: services.status() };
    }
    if (action.action === "setup-local") {
      services.localSetup ??= services.setupLocalGateway().finally(() => {
        services.localSetup = undefined;
      });
      return services.localSetup;
    }
    if (action.action === "export-gateway")
      throw new Error("Gateway export requires the desktop save dialog.");
    if (action.action === "refresh") {
      await services.refreshConnection();
      return services.status();
    }
    if (action.action === "register") {
      if (services.config.enabled)
        throw new Error("Pause IM before changing device registration.");
      if (!services.secure.isEncryptionAvailable())
        throw new Error(services.text("credentialsSaveUnavailable"));
      const value = z
        .object({ id: z.string().uuid(), token: z.string().min(32) })
        .parse(
          await (
            await services.http(
              "/v1/admin/register",
              "POST",
              { name: action.name },
              { url: action.gatewayUrl, token: action.adminToken },
            )
          ).json(),
        );
      for (const namespace of [
        "outbox",
        "receipts",
        "selections",
        "actions",
        "subscriptions",
        "usage",
      ]) {
        services.db
          .prepare("DELETE FROM im_state WHERE namespace=?")
          .run(namespace);
      }
      services.token = value.token;
      services.put(
        "credentials",
        "device",
        services.secure.encryptString(value.token).toString("base64"),
      );
      services.config = {
        ...services.config,
        gatewayUrl: assertImGatewayUrl(action.gatewayUrl).origin,
        deviceId: value.id,
        deviceName: action.name,
      };
      services.put("settings", "current", services.config);
      services.remove("gateway", "local-device");
      if (
        services.localGateway.url &&
        services.config.gatewayUrl !== services.localGateway.url
      )
        await services.localGateway.close();
      services.identities = [];
      services.pairingRequests = [];
      services.channelStatus = [];
      services.removedConnections.clear();
      services.spaces = [];
      return services.status();
    }
    if (action.action === "refresh-group-members") {
      const group = services.spaces.find(
        (s) => (s as CollaborationSpace).id === action.spaceId,
      ) as CollaborationSpace | undefined;
      if (
        !services.usesLocalGateway() ||
        group?.nativeGroup?.ownerDeviceId !== services.config.deviceId
      )
        return;
      const credential = await services.ensureLocalGateway();
      await services.http(
        "/v1/admin/refresh-group-members",
        "PUT",
        { spaceId: action.spaceId },
        credential,
      );
      await services.refreshConnection();
      return;
    }
    if (action.action === "set-group-member-assignment") {
      const group = services.spaces.find(
        (s) => (s as CollaborationSpace).id === action.spaceId,
      ) as CollaborationSpace | undefined;
      if (
        !services.usesLocalGateway() ||
        group?.nativeGroup?.ownerDeviceId !== services.config.deviceId
      )
        throw new Error(services.text("localBotGroupsOnly"));
      const credential = await services.ensureLocalGateway();
      await services.http(
        "/v1/admin/native-group-member",
        "PUT",
        {
          spaceId: action.spaceId,
          identity: action.identity,
          allowed: action.allowed,
        },
        credential,
      );
      await services.refreshConnection();
      return { allowed: action.allowed };
    }
    if (action.action === "authorize-native-group") {
      if (
        action.grant.security?.scopes.some(
          (scope) => scope.localAccess === "full",
        )
      )
        throw new Error(
          "Use confirmed group authorization to enable full local access.",
        );
      if (!services.usesLocalGateway())
        throw new Error(services.text("enableLocalGateway"));
      if (
        !services.identities.some(
          (i) => imIdentityKey(i) === imIdentityKey(action.owner),
        )
      )
        throw new Error(services.text("identityUnpaired"));
      if (!services.ops.projects().some((p) => p.id === action.grant.projectId))
        throw new Error(services.text("projectMissing"));
      const existingGrant = services.config.grants.find(
        (g) => g.projectId === action.grant.projectId,
      );
      const scope = action.grant.security?.scopes.find(
        (s) => s.audience === "owner",
      );
      if (!scope || !imScopeConfirmation(action.grant.security, scope))
        throw new Error(services.text("confirmScope"));
      const credential = await services.ensureLocalGateway();
      const group = (await (
        await services.http(
          "/v1/admin/native-group",
          "PUT",
          {
            conversation: action.conversation,
            owner: action.owner,
            allowedSenders: action.allowedSenders,
            deviceId: services.config.deviceId,
            name: action.name,
            projectId: action.grant.projectId,
            enabled: true,
          },
          credential,
        )
      ).json()) as CollaborationSpace;
      const audience = `space:${group.id}`;
      const previous = services.config.grants.find(
        (g) => g.projectId === action.grant.projectId,
      );
      // Keep the existing project's operation policy; the new audience only supplies its own data scope.
      const grant: ExecutionGrant = {
        ...(previous ?? action.grant),
        groups: [...new Set([...(previous?.groups ?? []), audience])],
        security: {
          version: IM_SECURITY_VERSION,
          revision: randomUUID(),
          confirmedAt: Date.now(),
          scopes: [
            ...(previous?.security?.scopes.filter(
              (s) => s.audience !== audience,
            ) ?? []),
            {
              ...scope,
              audience,
              confirmedAt: Date.now(),
              revision: randomUUID(),
              spaceRevision: group.revision!,
            },
          ],
        },
      };
      await services.savePreparedSettings(
        await services.prepareSettings({
          ...services.config,
          grants: [
            ...services.config.grants.filter(
              (g) => g.projectId !== grant.projectId,
            ),
            grant,
          ],
        }),
      );
      await services.refreshConnection();
      return services.status();
    }
    if (action.action === "native-cancel") {
      if (!services.usesLocalGateway())
        throw new Error("Native cancellation requires the local gateway.");
      const state = (await (
        await services.http("/v1/device/native-cooperation", "POST", {
          groupId: action.groupId,
          operation: "state",
        })
      ).json()) as {
        tasks: Array<{ id: string; invocationId: string; threadId?: string }>;
      };
      const task = state.tasks.find((t) => t.id === action.taskId);
      const binding =
        task &&
        services
          .list<Binding>("bindings")
          .find(
            (b) =>
              b.threadId === task.threadId &&
              b.request.conversation.spaceId === action.groupId,
          );
      if (!binding)
        throw new Error("Only the local coordinator can cancel this task.");
      await services.cancelDelegationTask(binding.threadId, action.taskId);
      return (
        await services.http("/v1/device/native-command", "POST", {
          id: action.messageId,
          invocationId: task!.invocationId,
          threadId: binding.threadId,
          command: { action: "cancel", taskId: action.taskId, text: "" },
        })
      ).json();
    }
    if (action.action === "native-cooperation") {
      if (!services.usesLocalGateway())
        throw new Error("Native cooperation requires this local gateway.");
      const { action: _action, ...input } = action;
      const result = await (
        await services.http("/v1/device/native-cooperation", "POST", input)
      ).json();
      if (action.operation !== "state") await services.refreshConnection();
      return result;
    }
    if (
      action.action === "native-group-state" ||
      action.action === "native-group-input"
    ) {
      if (action.action === "native-group-input")
        await services.refreshConnection();
      const binding = services.get<Binding>("bindings", action.threadId);
      if (
        !binding ||
        binding.parentThreadId ||
        !services.groupContext(binding).native
      )
        throw new Error(services.text("groupConversationMissing"));
      if (action.action === "native-group-state") {
        // Cache platform outcomes locally, so offline history stays readable.
        // A failed refresh must never promote a queued send to delivered.
        if (services.state === "connected" && services.usesLocalGateway()) {
          try {
            const result = (await (
              await services.http("/v1/device/native-deliveries", "POST", {
                groupId: binding.request.conversation.spaceId,
              })
            ).json()) as {
              version: number;
              messages: Array<{ id: string; state: string }>;
            };
            if (result.version === 1)
              for (const update of result.messages) {
                const key = JSON.stringify([action.threadId, update.id]);
                const previous = services.get<Record<string, unknown>>(
                  "native-messages",
                  key,
                );
                if (previous)
                  services.put("native-messages", key, {
                    ...previous,
                    state: update.state,
                  });
              }
          } catch {
            /* Preserve the last observed platform state while offline. */
          }
        }
        let cooperation: { tasks?: unknown[]; history?: unknown[] } =
          services.get("native-cooperation-cache", action.threadId) ?? {};
        if (services.state === "connected" && services.usesLocalGateway()) {
          try {
            cooperation = await (
              await services.http("/v1/device/native-cooperation", "POST", {
                groupId: binding.request.conversation.spaceId,
                operation: "state",
              })
            ).json();
            services.put(
              "native-cooperation-cache",
              action.threadId,
              cooperation,
            );
          } catch {
            /* Last persisted IM evidence remains readable offline. */
          }
        }
        return {
          version: 1,
          cooperation,
          activity: services
            .list<{ parentThreadId: string }>("native-timeline")
            .filter((e) => e.parentThreadId === action.threadId),
          tasks: services
            .list<Binding>("bindings")
            .filter((b) => b.parentThreadId === action.threadId)
            .flatMap((b) => {
              const task = services.ops.thread(b.threadId);
              return task
                ? [
                    {
                      id: task.id,
                      time: Date.parse(task.createdAt),
                      title: task.title,
                      state: services.taskState(task),
                      running: busy(task),
                      instruction: b.request.text,
                      text: services
                        .finalText(
                          task.id,
                          services.ops.events(task.id).at(-1)?.turnId,
                        )
                        .slice(-8000),
                      visibility: b.privateLocal ? "local" : "group",
                    },
                  ]
                : [];
            }),
          messages: services
            .list<{
              parentThreadId: string;
              id: string;
              text: string;
              state: string;
            }>("native-messages")
            .filter((m) => m.parentThreadId === action.threadId),
        };
      }
      services.checkContext(binding);
      const key = JSON.stringify([action.threadId, action.messageId]);
      const previous = services.get<{
        text: string;
        destination: string;
        threadId?: string;
        state: string;
      }>("native-inputs", key);
      if (previous) {
        if (
          previous.text !== action.text ||
          previous.destination !== action.destination
        )
          throw new Error(services.text("messageIdConflict"));
        if (previous.state === "uncertain")
          throw new Error(
            services.text("deliveryNeedsCheck", undefined, {
              id: previous.threadId ?? services.text("linkedTask"),
            }),
          );
        return previous;
      }
      if (action.destination === "group") {
        const reason = services.fullLocalAccess(binding)
          ? undefined
          : inspectImOutbound(action.text, services.ops.locale?.() ?? "zh-CN");
        if (reason) throw new Error(reason);
        const message = {
          parentThreadId: action.threadId,
          id: action.messageId,
          text: action.text,
          state: "queued",
          time: Date.now(),
        };
        services.put("native-messages", key, message);
        services.reply(
          binding.request,
          action.text,
          action.threadId,
          false,
          "conversation",
          action.messageId,
        );
        const result = {
          text: action.text,
          destination: action.destination,
          state: "queued",
        };
        services.put("native-inputs", key, result);
        return result;
      }
      const id = randomUUID();
      const request = {
        ...binding.request,
        locale: services.ops.locale?.() ?? "zh-CN",
        id: action.messageId,
        messageId: action.messageId,
        text: action.text,
        expiresAt: Date.now() + 30 * 60_000,
      };
      const child: Binding = {
        ...binding,
        threadId: id,
        request,
        parentThreadId: action.threadId,
        privateLocal: true,
        localExecution: true,
      };
      const result = {
        text: action.text,
        destination: action.destination,
        threadId: id,
        state: "uncertain",
      };
      services.put("native-inputs", key, result);
      services.put("bindings", id, child);
      const initialTitle = formatImTaskTitle(
        request.identity.channel,
        action.text.slice(0, 60),
        request.locale ?? services.ops.locale?.() ?? "zh-CN",
      );
      await services.ops.create(
        id,
        binding.projectId,
        services.grant(child).mode,
        initialTitle,
      );
      await services.ops.start(
        id,
        action.text,
        services.grant(child).mode,
        [],
        action.text,
        {
          channel: request.identity.channel,
          initialTitle,
        },
      );
      services.put("bindings", id, { ...child, executionStarted: true });
      services.put("native-inputs", key, { ...result, state: "started" });
      return { ...result, state: "started" };
    }
    if (action.action === "admin") {
      const credential = services.usesLocalGateway()
        ? await services.ensureLocalGateway()
        : action.adminToken
          ? { url: services.config.gatewayUrl, token: action.adminToken }
          : undefined;
      if (!credential)
        throw new Error(services.text("adminCredentialsRequired"));
      return (
        await services.http(
          `/v1/admin/${action.operation}`,
          action.operation === "status" ? "GET" : "PUT",
          action.operation === "status"
            ? undefined
            : action.operation === "refresh-groups"
              ? {}
              : action.configuration,
          credential,
        )
      ).json();
    }
    if (action.action === "unpair") {
      const result = await (
        await services.http("/v1/device/unpair", "POST", action.identity)
      ).json();
      services.identities = services.identities.filter(
        (identity) =>
          imIdentityKey(identity) !== imIdentityKey(action.identity),
      );
      for (const binding of services.list<Binding>("bindings"))
        if (
          !binding.localExecution &&
          imIdentityKey(binding.request.identity) ===
            imIdentityKey(action.identity)
        ) {
          services.cancelOperations(binding.threadId);
          if (
            services.ops.thread(binding.threadId) &&
            busy(services.ops.thread(binding.threadId)!)
          )
            await services.ops.cancel(binding.threadId);
        }
      return result;
    }
    if (action.action === "resolve-pairing") {
      const result = await (
        await services.http("/v1/device/resolve-pairing", "POST", {
          requestId: action.requestId,
          approve: action.approve,
        })
      ).json();
      await services.refreshConnection();
      return result;
    }
    return (
      await services.http("/v1/device/pair", "POST", {
        requireConfirmation: action.requireConfirmation,
      })
    ).json();
  }

  async function previewLegacyIm(path: string) {
    services.legacyImports.clear();
    const configs = readLegacyImSettings(
      await readFile(path, "utf8"),
      services.secure,
      services.ops.locale?.() ?? "zh-CN",
    );
    let legacyBindings: number | undefined;
    let database: DatabaseSync | undefined;
    try {
      database = new DatabaseSync(join(dirname(path), "artemis.sqlite"), {
        readOnly: true,
      });
      if (
        database
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='im_bindings'",
          )
          .get()
      )
        legacyBindings = Number(
          database.prepare("SELECT COUNT(*) AS count FROM im_bindings").get()
            ?.count ?? 0,
        );
    } catch {
      /* A detached settings export may have no adjacent legacy database. */
    } finally {
      database?.close();
    }
    return {
      legacyBindings,
      connections: configs.map((config) => {
        const importId = randomUUID();
        services.legacyImports.set(importId, {
          config,
          expiresAt: Date.now() + 300000,
          gatewayUrl: services.config.gatewayUrl,
        });
        return {
          importId,
          name: config.name,
          appId: config.appId,
          domain: config.domain,
        };
      }),
    };
  }
  const handlers = { manage, previewLegacyIm };
  return handlers;
}

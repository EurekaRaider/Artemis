import { busy } from "./im-runtime-values.js";
import type { Binding, GroupEntry } from "./im-runtime-types.js";

import type { DelegatedTaskResult } from "./im-delegation-waits.js";
import { randomUUID } from "node:crypto";

import {
  type ImAuthorizationOperation,
  imScopeRevision,
  type ImOutboundCandidate,
} from "@artemis/protocol";

import { z } from "zod";
import {
  imConversationKey,
  imRetiredGroupSchema,
  imIdentityKey,
  remoteInvocationSchema,
  requireImGrant,
  type ImReply,
} from "@artemis/protocol";

import type { ImCoordinatorDependencies } from "./im-coordinator-dependencies.js";
export function createImGroupSynchronization(
  services: Pick<
    ImCoordinatorDependencies,
    | "put"
    | "groupEntryKey"
    | "remove"
    | "config"
    | "list"
    | "ops"
    | "retiredThreads"
    | "cancelOperations"
    | "http"
    | "delegationWaits"
    | "get"
    | "closed"
    | "usesLocalGateway"
    | "spaces"
    | "identities"
    | "pendingAudience"
    | "refreshNativeHistory"
    | "channelStatus"
    | "text"
    | "starts"
    | "availableProjects"
    | "secureContext"
    | "grant"
  >,
) {
  async function applyRetiredGroups(raw: unknown): Promise<void> {
    const parsed = z.array(imRetiredGroupSchema).safeParse(raw ?? []);
    if (!parsed.success) return;
    const ids = new Set(parsed.data.flatMap((group) => group.groupIds));
    if (!ids.size) return;
    const audiences = new Set([...ids].map((id) => `space:${id}`));
    for (const group of parsed.data)
      for (const id of group.groupIds) {
        services.put("retired-groups", services.groupEntryKey(id), {
          reason: group.reason,
          retiredAt: group.retiredAt,
        });
        services.remove("group-entries", services.groupEntryKey(id));
      }
    const grants = services.config.grants
      .map((grant) => ({
        ...grant,
        groups: grant.groups.filter((audience) => !audiences.has(audience)),
        ...(grant.security
          ? {
              security: {
                ...grant.security,
                scopes: grant.security.scopes.filter(
                  (scope) => !audiences.has(scope.audience),
                ),
              },
            }
          : {}),
      }))
      .filter(
        (grant, index) =>
          !services.config.grants[index]!.groups.some((audience) =>
            audiences.has(audience),
          ) ||
          grant.groups.length > 0 ||
          !!grant.security?.scopes.length,
      );
    if (JSON.stringify(grants) !== JSON.stringify(services.config.grants)) {
      services.config = { ...services.config, grants };
      services.put("settings", "current", services.config);
    }
    for (const operation of services.list<ImAuthorizationOperation>(
      "group-authorizations",
    ))
      if (
        (operation.group && ids.has(operation.group.id)) ||
        parsed.data.some(
          (group) =>
            imConversationKey(group.conversation) ===
            imConversationKey(operation.command.conversation),
        )
      )
        services.remove("group-authorizations", operation.command.operationId);
    for (const binding of services.list<Binding>("bindings")) {
      if (!ids.has(binding.request.conversation.spaceId ?? "")) continue;
      const thread = services.ops.thread(binding.threadId);
      if (
        services.retiredThreads.has(binding.threadId) &&
        (!thread || !busy(thread))
      )
        continue;
      services.cancelOperations(binding.threadId);
      services.remove("permission-blocks", binding.threadId);
      for (const reply of services.list<ImReply>("outbox"))
        if (reply.taskId === binding.threadId)
          services.remove("outbox", reply.id);
      for (const candidate of services.list<ImOutboundCandidate>(
        "outbound-candidates",
      )) {
        if (candidate.threadId !== binding.threadId) continue;
        services.remove("outbound-candidates", candidate.id);
        services.remove("outbound-bodies", candidate.id);
      }
      if (thread && busy(thread)) await services.ops.cancel(binding.threadId);
      await services.ops.close(binding.threadId);
      services.retiredThreads.add(binding.threadId);
    }
  }

  async function refreshNativeHistory(
    threadId: string,
    groupId: string,
  ): Promise<void> {
    const state = (await (
      await services.http("/v1/device/native-cooperation", "POST", {
        groupId,
        operation: "state",
      })
    ).json()) as {
      tasks: DelegatedTaskResult[];
      history: Array<{
        id: string;
        direction: string;
        envelope: { action: string };
      }>;
    };
    services.put("native-cooperation-cache", threadId, state);
    services.delegationWaits.update(groupId, state.tasks);
    for (const event of state.history) {
      if (services.get("native-observed", event.id)) continue;
      services.put("native-observed", event.id, true);
      if (event.direction !== "incoming") continue;
      if (
        event.envelope.action === "completed" ||
        event.envelope.action === "failed" ||
        event.envelope.action === "rejected"
      )
        services.ops.groupActivity?.(
          threadId,
          threadId,
          event.envelope.action === "completed" ? "completed" : "failed",
        );
    }
  }

  function groupEntryKey(spaceId: string): string {
    return JSON.stringify([services.config.deviceId, spaceId]);
  }

  async function syncGroupConversations(): Promise<void> {
    if (
      !services.config.enabled ||
      !services.ops.ready() ||
      services.closed ||
      !services.usesLocalGateway()
    )
      return;
    const schema = z.object({
      id: z.string(),
      name: z.string(),
      revision: z.string(),
      confirmed: z.literal(true),
      nativeGroup: z.object({
        version: z.literal(1),
        projectId: z.string(),
        enabled: z.literal(true),
      }),
      endpoints: z.array(remoteInvocationSchema.shape.conversation),
      participants: z.array(
        z.object({
          deviceId: z.string(),
          identity: remoteInvocationSchema.shape.identity,
        }),
      ),
    });
    for (const value of services.spaces) {
      const parsed = schema.safeParse(value);
      if (!parsed.success) continue;
      const space = parsed.data;
      const member = space.participants.find(
        (p) =>
          p.deviceId === services.config.deviceId &&
          services.identities.some(
            (i) => imIdentityKey(i) === imIdentityKey(p.identity),
          ),
      );
      const endpoint =
        member &&
        space.endpoints.find(
          (e) => e.connectionId === member.identity.connectionId,
        );
      if (!member || !endpoint) continue;
      const key = services.groupEntryKey(space.id);
      let entry = services.get<GroupEntry>("group-entries", key);
      if (entry && entry.projectId !== space.nativeGroup.projectId) {
        // Historical tasks remain, but a rebind gets a fresh model conversation.
        services.remove("group-entries", key);
        entry = undefined;
      }
      if (services.pendingAudience(`space:${space.id}`)) continue;
      let thread = entry && services.ops.thread(entry.threadId);
      // An explicitly deleted or archived conversation stays that way on refresh/restart.
      if ((entry?.created && !thread) || thread?.archived) continue;
      if (entry?.created)
        await services.refreshNativeHistory(entry.threadId, space.id);
      const currentBinding =
        thread && services.get<Binding>("bindings", thread.id);
      const currentGrant = services.config.grants.find(
        (g) => g.projectId === currentBinding?.projectId,
      );
      const currentScope = currentGrant?.security?.scopes.find(
        (s) => s.audience === `space:${space.id}`,
      );
      const currentRevision =
        currentGrant?.security && currentScope
          ? imScopeRevision(currentGrant.security, currentScope)
          : undefined;
      const channel = services.channelStatus
        .map((c) =>
          z
            .object({
              id: z.string(),
              configuration: z
                .object({ domain: z.string().optional() })
                .passthrough()
                .optional(),
            })
            .passthrough()
            .safeParse(c),
        )
        .find((c) => c.success && c.data.id === endpoint.connectionId);
      const platform =
        member.identity.channel === "feishu" &&
        channel?.success &&
        channel.data.configuration?.domain === "lark"
          ? "Lark"
          : {
              wecom: services.text("wecomBrand"),
              feishu: services.text("feishuBrand"),
              slack: "Slack",
            }[member.identity.channel];
      const title = `${space.name} · ${platform} · ${endpoint.connectionId}`;
      if (thread) services.ops.updateGroup?.(thread.id, title);
      if (
        thread &&
        currentBinding?.security?.revision === currentRevision &&
        !!currentBinding?.security &&
        currentBinding.projectId === space.nativeGroup.projectId &&
        currentBinding.request.expiresAt > Date.now() + 60000 &&
        currentBinding?.request.conversation.spaceRevision === space.revision
      ) {
        if (!entry!.created)
          services.put("group-entries", key, { ...entry, created: true });
        continue;
      }
      if (thread && (busy(thread) || services.starts.has(thread.id))) continue;
      const preview = remoteInvocationSchema.parse({
        version: 1,
        id: `group:${space.id}`,
        deviceId: services.config.deviceId,
        identity: member.identity,
        conversation: {
          ...endpoint,
          spaceId: space.id,
          spaceRevision: space.revision,
        },
        messageId: "group-setup",
        text: "",
        attachments: [],
        expiresAt: Date.now() + 30 * 60_000,
      });
      const projects = services.availableProjects(preview);
      const projectId =
        space.nativeGroup.projectId ??
        (projects.some((p) => p.id === services.config.defaultProjectId)
          ? services.config.defaultProjectId
          : projects.length === 1
            ? projects[0]!.id
            : undefined);
      if (!projectId || !projects.some((p) => p.id === projectId)) continue;
      const grant = requireImGrant(services.config, preview, projectId);
      const request = remoteInvocationSchema.parse(
        await (
          await services.http("/v1/device/group-context", "POST", {
            spaceId: space.id,
          })
        ).json(),
      );
      if (services.closed || services.groupEntryKey(space.id) !== key) return;
      // The parent is a stable group entry; execution always happens in child tasks.
      if (entry) entry = { ...entry, projectId };
      entry ??= { threadId: randomUUID(), projectId, created: false };
      const binding: Binding = {
        threadId: entry.threadId,
        projectId,
        request,
        localExecution: true,
        nativeGroup: true,
        groupName: space.name,
        ...(currentBinding?.targetDeviceIds
          ? { targetDeviceIds: currentBinding.targetDeviceIds }
          : {}),
      };
      binding.security = services.secureContext(binding, "desktop");
      services.grant(binding);
      services.put("group-entries", key, entry);
      services.put("bindings", entry.threadId, binding);
      thread ??= await services.ops.create(
        entry.threadId,
        undefined,
        grant.mode,
        title,
      );
      services.put("group-entries", key, { ...entry, created: true });
    }
  }
  const handlers = {
    applyRetiredGroups,
    refreshNativeHistory,
    groupEntryKey,
    syncGroupConversations,
  };
  return handlers;
}

import { retireGroup } from "../groups/group-retirement.js";

import type { AppLocale } from "@artemis/protocol";
import { normalizeFeishuGroupEvent } from "../channels/feishu/feishu-group-events.js";

import { randomUUID } from "node:crypto";

import {
  imConversationKey,
  imIdentityKey,
  type ChannelEvent,
  type CollaborationSpace,
  type ImGroupRoster,
} from "@artemis/protocol";
import { digest } from "../store.js";

import { SlackAdapter } from "../channels/slack/slack.js";
import { FeishuSocketAdapter } from "../channels/feishu/feishu-socket.js";

import {
  normalizeFeishuApproval,
  type FeishuApprovalCard,
} from "../channels/feishu/feishu-approval.js";
import {
  FeishuAdapter,
  WecomAdapter,
  type ChannelConnection,
} from "../channels/channels.js";
import type { GatewayDependencies } from "./gateway-dependencies.js";
export function createGatewayChannelRuntime(
  services: Pick<
    GatewayDependencies,
    | "store"
    | "router"
    | "startMediaJobs"
    | "invalidateGroupRoster"
    | "adapters"
    | "options"
  >,
) {
  function receiveChannelEvent(event: ChannelEvent): void {
    if (
      services.store.get(
        "retired-groups",
        imConversationKey(event.conversation),
      )
    )
      return;
    if (services.store.get("removed-connections", event.identity.connectionId))
      return;
    services.router.native.observeBot(event);
    if (!services.router.ingest(event)) return;
    if (
      event.identity.channel === "wecom" &&
      event.conversation.kind === "group" &&
      !event.bot
    ) {
      const group = services.router.findSpace(event.conversation);
      const owner = group?.participants[0]?.identity;
      if (
        group &&
        owner?.channel === event.identity.channel &&
        owner.tenantId === event.identity.tenantId &&
        owner.appId === event.identity.appId &&
        event.timestamp >= group.nativeGroup!.enabledAt
      ) {
        const prior = services.store.get<{ roster?: ImGroupRoster }>(
          "native-group-info",
          group.id,
        );
        const members = (prior?.roster?.members ?? []).filter(
          (m) => imIdentityKey(m.identity) !== imIdentityKey(event.identity),
        );
        members.push({
          identity: event.identity,
          name: event.identity.userId,
          kind: "human",
        });
        services.store.put("native-group-info", group.id, {
          ...prior,
          roster: {
            members: members.slice(-10000),
            complete: false,
            error: "partial",
          },
          checkedAt: Date.now(),
        });
      }
    }
    if (
      event.attachments.length &&
      services.store.get("identities", imIdentityKey(event.identity))
    ) {
      services.store.enqueue(
        "media",
        digest(`${event.identity.connectionId}\0${event.messageId}`),
        event.identity.connectionId,
        event,
      );
      services.startMediaJobs();
    }
  }

  function receiveFeishuGroup(
    config: Extract<ChannelConnection, { channel: "feishu" }>,
    value: unknown,
  ): void {
    if (services.store.get("removed-connections", config.id)) return;
    const event = normalizeFeishuGroupEvent(config, value);
    if (!event) return;
    services.store.transaction(() => {
      services.invalidateGroupRoster(config.id, event.chatId);
      if (!event.unavailable && !event.joined) return;
      if (event.unavailable === "dissolved") {
        retireGroup(
          services.store,
          { connectionId: config.id, id: event.chatId, kind: "group" },
          "dissolved",
          event.timestamp,
        );
        return;
      }
      for (const group of services.store.list<CollaborationSpace>(
        "native-groups",
      )) {
        if (
          !group.nativeGroup ||
          event.timestamp < group.nativeGroup.enabledAt ||
          !group.endpoints.some(
            (e) => e.connectionId === config.id && e.id === event.chatId,
          )
        )
          continue;
        const prior = services.store.get<{
          unavailable?: string;
          checkedAt: number;
        }>("native-group-info", group.id);
        const recovery =
          group.nativeGroup.recovery ??
          (!group.nativeGroup.enabled && prior?.unavailable === "removed"
            ? { version: 1 as const, removedAt: prior.checkedAt }
            : undefined);
        // A manual pause stays paused. Replayed membership events cannot undo a rejoin.
        if (
          !group.nativeGroup.enabled &&
          !recovery &&
          !services.store
            .list<{ phase: string; group: CollaborationSpace }>(
              "native-authorizations",
            )
            .some(
              (operation) =>
                operation.phase === "prepared" &&
                operation.group.id === group.id &&
                operation.group.revision === group.revision,
            )
        )
          continue;
        if (
          recovery &&
          (event.timestamp <= (recovery.rejoinedAt ?? recovery.removedAt) ||
            (!event.joined && !recovery.rejoinedAt))
        )
          continue;
        services.store.put("native-groups", group.id, {
          ...group,
          revision: randomUUID(),
          nativeGroup: {
            ...group.nativeGroup,
            enabled: false,
            recovery: event.joined
              ? {
                  version: 1,
                  removedAt: recovery?.removedAt ?? event.timestamp,
                  rejoinedAt: event.timestamp,
                }
              : { version: 1, removedAt: event.timestamp },
          },
        });
        services.store.put("native-group-info", group.id, {
          unavailable: event.unavailable,
          checkedAt: Date.now(),
          next: Date.now() + 60000,
        });
        services.store.delete("space-confirmations", group.id);
      }
    });
  }

  function approvalLocale(
    connectionId: string,
    value: unknown,
  ): AppLocale | undefined {
    const token = (
      value as {
        event?: { action?: { value?: { artemisApprovalToken?: unknown } } };
      }
    )?.event?.action?.value?.artemisApprovalToken;
    if (typeof token !== "string") return undefined;
    return services.store.get<FeishuApprovalCard>(
      "approval-cards",
      `${connectionId}:${token}`,
    )?.locale;
  }

  function receiveFeishuCard(connectionId: string, value: unknown): boolean {
    const raw = value as {
      event?: { action?: { value?: { artemisApprovalToken?: string } } };
    };
    const key = `${connectionId}:${raw?.event?.action?.value?.artemisApprovalToken ?? ""}`;
    const card = services.store.get<FeishuApprovalCard>("approval-cards", key);
    if (
      !card ||
      card.identity.connectionId !== connectionId ||
      !services.router.canDeliver({
        conversation: card.conversation,
        invocationId: card.invocationId,
        text: "",
      })
    )
      return false;
    const event = normalizeFeishuApproval(value, card);
    if (!event) return false;
    services.store.transaction(() => {
      services.router.ingest(event);
      services.store.put("approval-cards", key, { ...card, consumed: true });
    });
    return true;
  }

  function install(config: ChannelConnection): void {
    services.adapters.get(config.id)?.stop();
    const receive = (event: ChannelEvent) => {
      handlers.receiveChannelEvent(event);
    };
    const adapter =
      services.options.adapterFactory?.(config, receive) ??
      (config.channel === "wecom"
        ? new WecomAdapter(config, receive)
        : config.channel === "slack"
          ? new SlackAdapter(
              config,
              receive,
              (channel) => services.invalidateGroupRoster(config.id, channel),
              (channel, reason, timestamp) =>
                retireGroup(
                  services.store,
                  { connectionId: config.id, id: channel, kind: "group" },
                  reason,
                  timestamp,
                ),
            )
          : config.transport === "websocket"
            ? new FeishuSocketAdapter(
                config,
                receive,
                undefined,
                (value) => {
                  return handlers.receiveFeishuCard(config.id, value);
                },
                (value) => handlers.receiveFeishuGroup(config, value),
                (tenantId) => handlers.persistTenantId(config.id, tenantId),
                (value) => handlers.approvalLocale(config.id, value),
              )
            : new FeishuAdapter(config));
    services.adapters.set(config.id, adapter);
    adapter.start();
  }

  function persistTenantId(id: string, tenantId: string): void {
    const entry = services.store.get<{ sealed: string }>("connections", id);
    if (!entry) return;
    const current = services.store.unseal<ChannelConnection>(entry.sealed);
    if (current.tenantId === tenantId) return;
    services.store.put("connections", id, {
      id,
      sealed: services.store.seal({ ...current, tenantId }),
    });
  }
  const handlers = {
    receiveChannelEvent,
    receiveFeishuGroup,
    approvalLocale,
    receiveFeishuCard,
    install,
    persistTenantId,
  };
  return handlers;
}

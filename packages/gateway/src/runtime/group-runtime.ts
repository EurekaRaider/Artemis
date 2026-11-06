import { retireGroup } from "../groups/group-retirement.js";

import { randomUUID } from "node:crypto";

import {
  imConversationKey,
  imIdentityKey,
  type CollaborationSpace,
  type ImIdentity,
  type ImConversation,
  type ImGroupRoster,
} from "@artemis/protocol";

import { ChannelRateLimit, FeishuAdapter } from "../channels/channels.js";
import type { GatewayDependencies } from "./gateway-dependencies.js";
export function createGatewayGroupRuntime(
  services: Pick<
    GatewayDependencies,
    "groupNameRefresh" | "store" | "adapters" | "visibleGroups" | "router"
  >,
) {
  function refreshDiscoveredGroupNames(force = false): Promise<void> {
    if (services.groupNameRefresh)
      return force
        ? services.groupNameRefresh.then(() =>
            handlers.refreshDiscoveredGroupNames(true),
          )
        : services.groupNameRefresh;
    const pending = handlers.queryDiscoveredGroupNames(force).finally(() => {
      services.groupNameRefresh = undefined;
    });
    services.groupNameRefresh = pending;
    return pending;
  }

  async function queryDiscoveredGroupNames(force: boolean): Promise<void> {
    type Observed = {
      conversation: ImConversation;
      identities: ImIdentity[];
      lastSeenAt: number;
      name?: string;
      nameNextCheck?: number;
      nameError?: string;
      nameCheckedAt?: number;
    };
    const candidates = services.store
      .list<Observed>("observed-groups")
      .filter((group) => {
        const adapter = services.adapters.get(group.conversation.connectionId);
        const due =
          force && group.nameError !== "rate-limited"
            ? (group.nameCheckedAt ?? 0) + 5000 <= Date.now()
            : (group.nameNextCheck ?? 0) <= Date.now();
        return (
          !!adapter?.groupInfo && adapter.status().state === "connected" && due
        );
      })
      .slice(0, force ? undefined : 1);
    for (let offset = 0; offset < candidates.length; offset += 3)
      await Promise.all(
        candidates.slice(offset, offset + 3).map(async (group) => {
          const adapter = services.adapters.get(
            group.conversation.connectionId,
          )!;
          const key = imConversationKey(group.conversation);
          services.store.put("observed-groups", key, {
            ...group,
            nameNextCheck: Date.now() + 60000,
            nameCheckedAt: Date.now(),
          });
          try {
            const info = await adapter.groupInfo!(group.conversation);
            if (
              services.adapters.get(group.conversation.connectionId) !== adapter
            )
              return;
            if (
              info.unavailable === "dissolved" ||
              info.unavailable === "archived"
            ) {
              retireGroup(services.store, group.conversation, info.unavailable);
              return;
            }
            const current = services.store.get<Observed>(
              "observed-groups",
              key,
            );
            if (
              current &&
              services.adapters.get(group.conversation.connectionId) === adapter
            ) {
              services.store.put("observed-groups", key, {
                ...current,
                ...(info.name?.trim() ? { name: info.name.trim() } : {}),
                nameError: info.name
                  ? undefined
                  : (info.nameError ?? info.unavailable ?? "lookup-failed"),
                nameNextCheck: Date.now() + 60000,
              });
            }
          } catch (error) {
            const current = services.store.get<Observed>(
              "observed-groups",
              key,
            );
            if (current)
              services.store.put("observed-groups", key, {
                ...current,
                nameError:
                  error instanceof ChannelRateLimit
                    ? "rate-limited"
                    : "lookup-failed",
                nameNextCheck:
                  Date.now() +
                  (error instanceof ChannelRateLimit
                    ? Math.max(60, error.seconds) * 1000
                    : 60000),
              });
          }
        }),
      );
  }

  function invalidateGroupRoster(connectionId: string, channel: string): void {
    for (const group of services.store.list<CollaborationSpace>(
      "native-groups",
    )) {
      if (
        !group.nativeGroup?.enabled ||
        !group.endpoints.some(
          (e) => e.connectionId === connectionId && e.id === channel,
        )
      )
        continue;
      const prior = services.store.get<{ next: number; checkedAt?: number }>(
        "native-group-info",
        group.id,
      );
      // Coalesce event bursts and panel opens without bypassing provider backoff.
      if (prior && prior.next > Date.now() + 60000) continue;
      services.store.put("native-group-info", group.id, {
        ...prior,
        next: Math.max(Date.now(), (prior?.checkedAt ?? 0) + 10000),
      });
    }
  }

  async function refreshMemberPresence(): Promise<void> {
    const groups = services.store
      .list<CollaborationSpace>("native-groups")
      .sort(
        (a, b) =>
          Number((services.visibleGroups.get(b.id) ?? 0) > Date.now()) -
          Number((services.visibleGroups.get(a.id) ?? 0) > Date.now()),
      );
    for (const [connectionId, adapter] of services.adapters) {
      if (!adapter.groupPresence || adapter.status().state !== "connected")
        continue;
      const snapshots = groups.filter(
        (group) =>
          group.nativeGroup?.enabled &&
          group.endpoints[0]?.connectionId === connectionId,
      );
      const people = new Map<string, ImGroupRoster["members"][number]>();
      for (const group of snapshots) {
        const roster = services.store.get<{ roster?: ImGroupRoster }>(
          "native-group-info",
          group.id,
        )?.roster;
        for (const member of roster?.members ?? [])
          if (!people.has(imIdentityKey(member.identity)))
            people.set(imIdentityKey(member.identity), member);
      }
      const members = await adapter.groupPresence([...people.values()]);
      const updates = new Map(
        members.map((member) => [imIdentityKey(member.identity), member]),
      );
      for (const group of snapshots) {
        const current = services.store.get<CollaborationSpace>(
          "native-groups",
          group.id,
        );
        const info = services.store.get<{ roster?: ImGroupRoster }>(
          "native-group-info",
          group.id,
        );
        if (
          current?.revision !== group.revision ||
          services.adapters.get(connectionId) !== adapter ||
          !info?.roster
        )
          continue;
        services.store.put("native-group-info", group.id, {
          ...info,
          roster: {
            ...info.roster,
            members: info.roster.members.map((member) => {
              const update = updates.get(imIdentityKey(member.identity));
              return update
                ? {
                    ...member,
                    presence: update.presence,
                    presenceCheckedAt: update.presenceCheckedAt,
                    presenceError: update.presenceError,
                  }
                : member;
            }),
          },
        });
      }
    }
    for (const [id, until] of services.visibleGroups)
      if (until <= Date.now()) services.visibleGroups.delete(id);
  }

  async function refreshNativeGroupInfo(spaceId?: string): Promise<void> {
    for (const group of services.store.list<CollaborationSpace>(
      "native-groups",
    )) {
      if (spaceId && group.id !== spaceId) continue;
      const endpoint = group.endpoints[0];
      const adapter = endpoint && services.adapters.get(endpoint.connectionId);
      if (
        !group.nativeGroup?.enabled ||
        !adapter?.groupInfo ||
        adapter.status().state !== "connected"
      )
        continue;
      const prior = services.store.get<{
        next: number;
        checkedAt?: number;
        revision?: string;
        roster?: ImGroupRoster;
      }>("native-group-info", group.id);
      if (
        prior &&
        prior.next > Date.now() &&
        (!spaceId ||
          !prior.checkedAt ||
          (prior.revision === group.revision &&
            prior.checkedAt + 10000 > Date.now()) ||
          prior.roster?.error === "rate-limited" ||
          prior.next > Date.now() + 60000)
      )
        continue;
      services.store.put("native-group-info", group.id, {
        ...prior,
        next: Date.now() + 60000,
      });
      try {
        const [info, roster] = await Promise.all([
          adapter.groupInfo(endpoint!),
          adapter.groupMembers?.(endpoint!, false),
        ]);
        // Preserve observations only while the directory is incomplete. A full
        // snapshot must replace historical bots, including removed identities.
        if (
          roster &&
          !roster.complete &&
          endpoint &&
          adapter instanceof FeishuAdapter
        ) {
          const observed = services.store.get<{ roster?: ImGroupRoster }>(
            "native-group-info",
            group.id,
          )?.roster;
          const ids = new Set(roster.members.map((m) => m.identity.userId));
          for (const member of observed?.members ?? []) {
            if (
              member.kind === "bot" &&
              !ids.has(member.identity.userId) &&
              roster.members.length < 10000
            ) {
              roster.members.push(member);
              ids.add(member.identity.userId);
            }
          }
        }
        // Do not commit a late lookup over an authorization edit or a removed adapter.
        const current = services.store.get<CollaborationSpace>(
          "native-groups",
          group.id,
        );
        if (
          !current ||
          current.revision !== group.revision ||
          services.adapters.get(endpoint!.connectionId) !== adapter
        )
          return;
        if (
          info.unavailable === "dissolved" ||
          info.unavailable === "archived"
        ) {
          retireGroup(services.store, endpoint!, info.unavailable);
          return;
        }
        const latestRoster = services.store.get<{ roster?: ImGroupRoster }>(
          "native-group-info",
          group.id,
        )?.roster;
        if (roster && latestRoster) {
          const latest = new Map(
            latestRoster.members.map((m) => [imIdentityKey(m.identity), m]),
          );
          for (const member of roster.members) {
            const fresh = latest.get(imIdentityKey(member.identity));
            if (
              (fresh?.presenceCheckedAt ?? 0) > (member.presenceCheckedAt ?? 0)
            ) {
              member.presence = fresh!.presence;
              member.presenceCheckedAt = fresh!.presenceCheckedAt;
              member.presenceError = fresh!.presenceError;
            }
          }
        }
        services.store.transaction(() => {
          services.store.put("native-group-info", group.id, {
            ...info,
            revision: group.revision,
            ...(roster ? { roster } : {}),
            checkedAt: Date.now(),
            next: Date.now() + 60000,
          });
          services.store.put("native-groups", group.id, {
            ...current,
            ...(info.name ? { name: info.name } : {}),
            ...(info.unavailable
              ? {
                  revision: randomUUID(),
                  nativeGroup: { ...current.nativeGroup, enabled: false },
                }
              : {}),
          });
          if (info.unavailable)
            services.store.delete("space-confirmations", group.id);
        });
        if (!info.unavailable) services.router.native.syncRoster(group.id);
      } catch (error) {
        services.store.put("native-group-info", group.id, {
          ...(prior?.roster
            ? {
                roster: {
                  ...prior.roster,
                  complete: false,
                  error: "unavailable",
                },
              }
            : {}),
          next:
            Date.now() +
            (error instanceof ChannelRateLimit
              ? Math.max(60, error.seconds) * 1000
              : 60000),
        });
      }
      // Bounded work per tick; no full-list burst against a platform API.
      return;
    }
  }
  const handlers = {
    refreshDiscoveredGroupNames,
    queryDiscoveredGroupNames,
    invalidateGroupRoster,
    refreshMemberPresence,
    refreshNativeGroupInfo,
  };
  return handlers;
}

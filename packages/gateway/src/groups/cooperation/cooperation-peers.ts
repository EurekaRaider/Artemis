import { randomUUID } from "node:crypto";
import type {
  ChannelEvent,
  CollaborationSpace,
  ImGroupRoster,
  ImBotPresence,
} from "@artemis/protocol";

import type { CooperationDependencies } from "./cooperation-dependencies.js";
export function createCooperationPeers(
  services: Pick<
    CooperationDependencies,
    | "store"
    | "allowed"
    | "tasks"
    | "now"
    | "group"
    | "frame"
    | "peers"
    | "pendingProbeUntil"
    | "send"
    | "router"
    | "address"
    | "probe"
  >,
) {
  function memberPresence(groupId: string, peerId: string): ImBotPresence {
    const group = services.store.get<CollaborationSpace>(
      "native-groups",
      groupId,
    );
    const authorized =
      group?.nativeGroup?.enabled && services.allowed(group, peerId);
    // Only fresh task activity proves availability; idle peers remain unknown.
    const running =
      authorized &&
      services
        .tasks(groupId)
        .find(
          (t) =>
            t.peer === peerId &&
            t.direction === "outgoing" &&
            ["accepted", "running"].includes(t.state) &&
            t.heartbeatAt !== undefined &&
            t.heartbeatAt <= services.now() &&
            services.now() - t.heartbeatAt < 90000,
        );
    if (running)
      return {
        state: "busy",
        source: "task",
        checkedAt: running.heartbeatAt!,
        expiresAt: running.heartbeatAt! + 90000,
      };
    return {
      state: "unknown",
      source: "peer",
      checkedAt: 0,
      expiresAt: 0,
    };
  }

  function probe(groupId: string, peer?: string): void {
    const group = services.group(groupId);
    const envelope = services.frame(
      group,
      peer ?? "*",
      peer ? "probe" : "hello",
    );
    if (peer && !services.peers(groupId).some((p) => p.id === peer))
      throw new Error("Select an observed bot identity.");
    if (peer && services.pendingProbeUntil(groupId, peer) > services.now())
      return;
    if (peer) envelope.expiresAt = services.now() + 30000;
    services.store.transaction(() => {
      if (peer) {
        const key = JSON.stringify([groupId, peer]);
        const previous = services.store.get<
          number | { attempts: number; nextAt: number }
        >("native-auto-probe", key);
        const attempts = Math.min(
          3,
          (typeof previous === "number" ? 1 : (previous?.attempts ?? 0)) + 1,
        );
        services.store.put("native-auto-probe", key, {
          attempts,
          nextAt: services.now() + (attempts === 1 ? 60000 : 300000),
        });
      }
      services.store.put("native-probes", envelope.id, {
        groupId,
        peer,
        expiresAt: envelope.expiresAt,
      });
      services.send(group, envelope);
    });
  }

  function pendingProbeUntil(groupId: string, peer: string): number {
    return Math.max(
      0,
      ...services.store
        .list<{ groupId: string; peer?: string; expiresAt: number }>(
          "native-probes",
        )
        .filter((probe) => probe.groupId === groupId && probe.peer === peer)
        .map((probe) => probe.expiresAt),
    );
  }

  function authorize(groupId: string, peers: string[]): void {
    const group = services.group(groupId);
    if (
      peers.some(
        (id) => !services.peers(groupId).find((p) => p.id === id)?.verifiedAt,
      )
    )
      throw new Error("Every bot must pass an IM round-trip probe first.");
    if (
      JSON.stringify([...(group.nativeGroup?.allowedBots ?? [])].sort()) ===
      JSON.stringify([...new Set(peers)].sort())
    )
      return;
    services.store.put("native-groups", group.id, {
      ...group,
      revision: randomUUID(),
      nativeGroup: {
        ...group.nativeGroup,
        allowedBots: [...new Set(peers)],
        capability: peers.length ? "events" : "manual",
      },
    });
  }

  function setMemberAssignment(
    groupId: string,
    peer: string,
    allowed: boolean,
  ): void {
    const group = services.group(groupId);
    const peers = new Set(group.nativeGroup?.allowedBots ?? []);
    if (allowed) peers.add(peer);
    else peers.delete(peer);
    services.store.put("native-groups", group.id, {
      ...group,
      nativeGroup: {
        ...group.nativeGroup,
        allowedBots: [...peers],
        capability: peers.size ? "events" : "manual",
      },
    });
  }

  function observeBot(event: ChannelEvent): void {
    if (
      event.identity.channel !== "feishu" ||
      event.conversation.kind !== "group"
    )
      return;
    const group = services.router.findSpace(event.conversation);
    const owner = group?.participants[0]?.identity;
    if (
      !group ||
      !owner ||
      event.identity.channel !== owner.channel ||
      event.identity.tenantId !== owner.tenantId ||
      event.identity.appId !== owner.appId ||
      event.timestamp < group.nativeGroup!.enabledAt ||
      event.timestamp > services.now() + 60000
    )
      return;
    const peers = services.peers(group.id);
    const names = new Map(
      services.store.get<Array<[string, string]>>(
        "native-member-names",
        group.id,
      ) ?? [],
    );
    for (const mention of event.mentions ?? [])
      names.set(mention.userId, mention.name);
    if (event.mentions?.length) {
      services.store.put(
        "native-member-names",
        group.id,
        [...names].slice(-1000),
      );
      for (const peer of peers) peer.name = names.get(peer.id) ?? peer.name;
      services.store.put("native-peers", group.id, peers);
      const info = services.store.get<{ roster?: ImGroupRoster }>(
        "native-group-info",
        group.id,
      );
      if (info?.roster)
        services.store.put("native-group-info", group.id, {
          ...info,
          roster: {
            ...info.roster,
            members: info.roster.members.map((member) => ({
              ...member,
              name: names.get(member.identity.userId) ?? member.name,
            })),
          },
        });
    }
    // Mention names label already observed identities; they do not discover bots
    // or grant verification, assignment permission, or automatic collaboration.
    if (!event.bot || event.identity.userId === services.address(group).sender)
      return;
    const name =
      names.get(event.identity.userId) ??
      peers.find((p) => p.id === event.identity.userId)?.name ??
      event.identity.userId;
    if (!peers.some((p) => p.id === event.identity.userId)) {
      peers.push({ id: event.identity.userId, name });
      services.store.put("native-peers", group.id, peers.slice(-100));
    }
    // Observation is identity evidence only. Permission and correlated proof
    // are still required before either side can dispatch work.
    const prior = services.store.get<{ roster?: ImGroupRoster }>(
      "native-group-info",
      group.id,
    );
    const members = (prior?.roster?.members ?? []).filter(
      (m) => m.identity.userId !== event.identity.userId,
    );
    members.push({
      identity: event.identity,
      name,
      kind: "bot",
    });
    services.store.put("native-group-info", group.id, {
      ...prior,
      roster: {
        members: members.slice(-10000),
        complete: false,
        error: "partial",
      },
    });
  }

  function syncRoster(groupId: string): void {
    const group = services.store.get<CollaborationSpace>(
      "native-groups",
      groupId,
    );
    if (
      !group?.nativeGroup?.enabled ||
      !services.router.findSpace(group.endpoints[0]!)
    )
      return;
    const roster = services.store.get<{ roster?: ImGroupRoster }>(
      "native-group-info",
      groupId,
    )?.roster;
    if (!roster) return;
    const peers = services.peers(groupId);
    for (const member of roster.members) {
      if (member.kind !== "bot" || member.self) continue;
      const peer = peers.find((p) => p.id === member.identity.userId);
      if (peer) peer.name = member.name;
      else peers.push({ id: member.identity.userId, name: member.name });
    }
    services.store.put(
      "native-peers",
      groupId,
      peers
        .filter(
          (p) =>
            !roster.complete ||
            roster.members.some((m) => m.identity.userId === p.id),
        )
        .slice(-100),
    );
    if (!services.store.get("connections", group.endpoints[0]!.connectionId))
      return;
    for (const peer of services.peers(groupId)) {
      // Feishu/Lark communication proof is independent of permission to work.
      // Keep Slack's existing authorization-first discovery unchanged.
      if (
        peer.verifiedAt ||
        (group.participants[0]?.identity.channel !== "feishu" &&
          !group.nativeGroup?.allowedBots?.includes(peer.id))
      )
        continue;
      const key = JSON.stringify([groupId, peer.id]);
      // Retry only discovery, never task delivery. Keep the budget across restarts.
      const previous = services.store.get<
        number | { attempts: number; nextAt: number }
      >("native-auto-probe", key);
      const retry =
        typeof previous === "number"
          ? { attempts: 1, nextAt: previous + 60000 }
          : previous;
      if (retry && (retry.attempts >= 3 || retry.nextAt > services.now()))
        continue;
      services.probe(groupId, peer.id);
    }
  }
  const handlers = {
    memberPresence,
    probe,
    pendingProbeUntil,
    authorize,
    setMemberAssignment,
    observeBot,
    syncRoster,
  };
  return handlers;
}

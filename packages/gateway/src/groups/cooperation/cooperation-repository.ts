import type { Peer, NativeTask } from "./cooperation-types.js";

import type {
  CollaborationSpace,
  RemoteInvocationContext,
} from "@artemis/protocol";

import type { Delivery } from "../../runtime/routing-contracts.js";
import type { ChannelConnection } from "../../channels/channels.js";

import type { CooperationDependencies } from "./cooperation-dependencies.js";
export function createCooperationRepository(
  services: Pick<CooperationDependencies, "store" | "router" | "peers">,
) {
  function task(groupId: string, id: string): NativeTask | undefined {
    return services.store.get<NativeTask>(
      "native-tasks",
      JSON.stringify([groupId, id]),
    );
  }

  function saveTask(task: NativeTask): void {
    services.store.put(
      "native-tasks",
      JSON.stringify([task.groupId, task.id]),
      task,
    );
  }

  function address(group: CollaborationSpace) {
    const stored = services.store.get<{ sealed: string }>(
      "connections",
      group.endpoints[0]!.connectionId,
    );
    if (!stored) throw new Error("Bot connection unavailable.");
    const config = services.store.unseal<ChannelConnection>(stored.sealed);
    return {
      platform:
        config.channel === "feishu" && config.domain === "lark"
          ? ("lark" as const)
          : config.channel,
      tenant: config.tenantId,
      group: group.endpoints[0]!.id,
      sender:
        config.channel === "slack"
          ? config.botUserId
          : config.channel === "feishu"
            ? config.botOpenId
            : config.botId,
    };
  }

  function group(id: string): CollaborationSpace {
    const group = services.store.get<CollaborationSpace>("native-groups", id);
    if (
      !group?.nativeGroup?.enabled ||
      !services.router.findSpace(group.endpoints[0]!)
    )
      throw new Error("Native group authorization is unavailable.");
    return group;
  }

  function peers(groupId: string): Peer[] {
    return services.store.get<Peer[]>("native-peers", groupId) ?? [];
  }

  function tasks(groupId: string): NativeTask[] {
    return services.store
      .list<NativeTask>("native-tasks")
      .filter((t) => t.groupId === groupId)
      .map((t) => ({
        ...t,
        delivery: String(
          services.store.db
            .prepare("SELECT state FROM queue WHERE bucket='outgoing' AND id=?")
            .get(`native:${t.cancelId ?? t.envelope.id}`)?.state ?? "pending",
        ),
      }));
  }

  function sessionKey(
    request: RemoteInvocationContext,
    group: CollaborationSpace,
    peer: string,
  ): string {
    const security = services.store.get<NonNullable<Delivery["security"]>>(
      "invocation-security",
      request.id,
    );
    return JSON.stringify([
      request.deviceId,
      group.id,
      group.revision,
      peer,
      security?.projectId ?? group.nativeGroup?.projectId,
      security?.audience ?? `space:${group.id}`,
      security?.revision ?? null,
    ]);
  }

  function allowed(group: CollaborationSpace, peer: string): boolean {
    return (
      group.nativeGroup?.capability === "events" &&
      !!group.nativeGroup.allowedBots?.includes(peer) &&
      !!services.peers(group.id).find((p) => p.id === peer)?.verifiedAt
    );
  }
  const handlers = {
    task,
    saveTask,
    address,
    group,
    peers,
    tasks,
    sessionKey,
    allowed,
  };
  return handlers;
}

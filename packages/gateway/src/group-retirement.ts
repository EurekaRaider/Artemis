import {
  imConversationKey,
  type CollaborationSpace,
  type ImConversation,
} from "@artemis/protocol";
import { GatewayStore } from "./store.js";

export interface RetiredGroup {
  conversation: ImConversation;
  groupIds: string[];
  deviceIds: string[];
  reason: "dissolved" | "archived";
  retiredAt: number;
}

/** Keep only a routing tombstone and history; remove the group's executable configuration. */
export function retireGroup(
  store: GatewayStore,
  conversation: ImConversation,
  reason: RetiredGroup["reason"],
  timestamp = Date.now(),
): void {
  const key = imConversationKey(conversation);
  store.transaction(() => {
    const prior = store.get<RetiredGroup>("retired-groups", key);
    const groups = store
      .list<CollaborationSpace>("native-groups")
      .filter((group) =>
        group.endpoints.some((endpoint) => imConversationKey(endpoint) === key),
      );
    if (groups.some((group) => (group.nativeGroup?.enabledAt ?? 0) > timestamp))
      return;
    const observed = store.get<{
      identities?: Array<{ connectionId: string; userId: string }>;
    }>("observed-groups", key);
    const deviceIds = new Set(prior?.deviceIds ?? []);
    for (const group of groups)
      for (const participant of group.participants)
        deviceIds.add(participant.deviceId);
    for (const paired of store.list<{
      deviceId: string;
      identity: { connectionId: string; userId: string };
    }>("identities"))
      if (
        observed?.identities?.some(
          (identity) =>
            identity.connectionId === paired.identity.connectionId &&
            identity.userId === paired.identity.userId,
        )
      )
        deviceIds.add(paired.deviceId);
    const groupIds = [
      ...new Set([
        ...(prior?.groupIds ?? []),
        ...groups.map((group) => group.id),
      ]),
    ];
    store.put("retired-groups", key, {
      conversation,
      groupIds,
      deviceIds: [...deviceIds],
      reason: prior?.reason === "dissolved" ? prior.reason : reason,
      retiredAt: prior?.retiredAt ?? timestamp,
    } satisfies RetiredGroup);
    store.delete("observed-groups", key);
    for (const id of groupIds) {
      for (const namespace of [
        "native-groups",
        "native-group-info",
        "space-confirmations",
        "native-peers",
      ])
        store.delete(namespace, id);
      store.db
        .prepare(
          "DELETE FROM state WHERE namespace='native-authorizations' AND json_extract(value,'$.group.id')=?",
        )
        .run(id);
      store.db
        .prepare(
          "DELETE FROM state WHERE namespace IN ('group-denied-senders','native-auto-probe') AND json_extract(id,'$[0]')=?",
        )
        .run(id);
      store.db
        .prepare(
          "DELETE FROM state WHERE namespace IN ('native-probes','native-revocation-cancels') AND json_extract(value,'$.groupId')=?",
        )
        .run(id);
      for (const deviceId of deviceIds) {
        const policy = store.get<{ grants: Array<{ audience: string }> }>(
          "device-security",
          deviceId,
        );
        if (policy)
          store.put("device-security", deviceId, {
            ...policy,
            grants: policy.grants.filter(
              (grant) => grant.audience !== `space:${id}`,
            ),
          });
      }
    }
    store.db
      .prepare(
        "UPDATE queue SET state='cancelled' WHERE state IN ('pending','processing','sending') AND json_extract(payload,'$.conversation.connectionId')=? AND json_extract(payload,'$.conversation.id')=?",
      )
      .run(conversation.connectionId, conversation.id);
  });
}

/** Upgrade the previous implementation, which retained dissolved groups as paused bindings. */
export function retireKnownGroups(store: GatewayStore): void {
  for (const group of store.list<CollaborationSpace>("native-groups")) {
    const reason = store.get<{ unavailable?: string }>(
      "native-group-info",
      group.id,
    )?.unavailable;
    if ((reason === "dissolved" || reason === "archived") && group.endpoints[0])
      retireGroup(store, group.endpoints[0], reason);
  }
}

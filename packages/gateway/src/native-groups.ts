import { randomUUID } from "node:crypto";
import { existsSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { z } from "zod";
import {
  imConversationSchema,
  imConversationKey,
  imIdentitySchema,
  imIdentityKey,
  type CollaborationSpace,
  type ImIdentity,
} from "@artemis/protocol";
import { GatewayStore, digest } from "./store.js";

export const nativeGroupInputSchema = z
  .object({
    conversation: imConversationSchema,
    owner: imIdentitySchema,
    deviceId: z.string().min(1),
    allowedSenders: z.array(imIdentitySchema).max(50).default([]),
    name: z.string().trim().min(1).max(100),
    projectId: z.string().min(1).max(256),
    enabled: z.boolean(),
  })
  .strict();

/** All identity claims must match an authenticated platform event already persisted locally. */
export function saveNativeGroup(
  store: GatewayStore,
  raw: unknown,
): CollaborationSpace {
  const input = nativeGroupInputSchema.parse(raw);
  const { conversation, owner, deviceId } = input;
  const observed = store.get<{ identities?: ImIdentity[] }>(
    "observed-groups",
    imConversationKey(conversation),
  );
  if (
    conversation.kind !== "group" ||
    conversation.spaceId ||
    conversation.spaceRevision ||
    !observed?.identities?.some(
      (i) => imIdentityKey(i) === imIdentityKey(owner),
    )
  )
    throw new Error("The group must be observed from this paired owner first.");
  if (
    conversation.connectionId !== owner.connectionId ||
    store.get<{ deviceId: string }>("identities", imIdentityKey(owner))
      ?.deviceId !== deviceId
  )
    throw new Error("A paired local owner is required.");
  if (
    !store.get<{ revoked: boolean }>("devices", deviceId) ||
    store.get<{ revoked: boolean }>("devices", deviceId)?.revoked
  )
    throw new Error("The owner device is unavailable.");
  const senders = [
    ...new Map(
      [owner, ...input.allowedSenders].map((identity) => [
        imIdentityKey(identity),
        identity,
      ]),
    ).values(),
  ];
  for (const sender of senders) {
    if (
      sender.channel !== owner.channel ||
      sender.connectionId !== owner.connectionId ||
      sender.tenantId !== owner.tenantId ||
      sender.appId !== owner.appId ||
      !observed.identities?.some(
        (i) => imIdentityKey(i) === imIdentityKey(sender),
      ) ||
      store.get<{ deviceId: string }>("identities", imIdentityKey(sender))
        ?.deviceId !== deviceId
    )
      throw new Error(
        "Every sender must be observed and paired to this local device.",
      );
  }
  const id = `native-${digest(JSON.stringify([owner.channel, owner.tenantId, owner.appId, conversation.id]))}`;
  const previous = store.get<CollaborationSpace>("native-groups", id);
  if (
    previous?.nativeGroup?.ownerDeviceId &&
    previous.nativeGroup.ownerDeviceId !== deviceId
  )
    throw new Error(
      "This bot and group already belong to another Artemis instance.",
    );
  const next: CollaborationSpace & { administrators: ImIdentity[] } = {
    id,
    name: input.name,
    revision: previous?.revision ?? randomUUID(),
    endpoints: [conversation],
    participants: senders.map((identity) => ({
      deviceId,
      identity,
      name: identity.userId,
    })),
    administrators: [owner],
    nativeGroup: {
      version: 1,
      ownerDeviceId: deviceId,
      projectId: input.projectId,
      enabled: input.enabled,
      capability: previous?.nativeGroup?.capability ?? "manual",
      ...(previous?.nativeGroup?.allowedBots
        ? { allowedBots: previous.nativeGroup.allowedBots }
        : {}),
      enabledAt:
        previous?.nativeGroup?.enabled && input.enabled
          ? previous.nativeGroup.enabledAt
          : Date.now(),
    },
  };
  if (
    previous &&
    JSON.stringify({ ...previous, revision: "" }) !==
      JSON.stringify({ ...next, revision: "" })
  )
    next.revision = randomUUID();
  store.transaction(() => {
    store.put("native-groups", id, next);
    store.put(
      "space-confirmations",
      id,
      input.enabled ? [imConversationKey(conversation)] : [],
    );
  });
  return next;
}

/** Preserve legacy configuration as a read-only backup, never as an executable route. */
export function retireLegacySpaces(
  store: GatewayStore,
  backupPath?: string,
): void {
  if (!store.list<CollaborationSpace>("spaces").length) return;
  if (backupPath && !existsSync(backupPath)) {
    const temporary = `${backupPath}.${randomUUID()}.tmp`;
    writeFileSync(temporary, "", { flag: "wx", mode: 0o600 });
    try {
      store.db.prepare("VACUUM INTO ?").run(temporary);
      renameSync(temporary, backupPath);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }
  store.transaction(() => {
    for (const space of store.list<CollaborationSpace>("spaces")) {
      // Development snapshots may have used the legacy projection. Move them
      // too, so an older binary cannot treat a native grant as a legacy space.
      if (space.nativeGroup?.version === 1) {
        store.put("native-groups", space.id, space);
        store.delete("spaces", space.id);
        continue;
      }
      store.put("retired-spaces", space.id, space);
      store.delete("spaces", space.id);
      store.delete("space-confirmations", space.id);
      store.db
        .prepare(
          "UPDATE queue SET state='cancelled' WHERE state IN ('pending','processing','sending') AND json_extract(payload,'$.conversation.spaceId')=?",
        )
        .run(space.id);
    }
  });
}

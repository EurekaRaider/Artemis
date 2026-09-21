import { z } from "zod";
import {
  imIdentityKey,
  imConversationKey,
  type CollaborationSpace,
} from "@artemis/protocol";
import { GatewayStore } from "./store.js";
import { nativeGroupInputSchema, saveNativeGroup } from "./native-groups.js";

const commandSchema = z
  .object({
    version: z.literal(1),
    operationId: z.string().uuid(),
    supersedes: z.string().uuid().optional(),
    phase: z.enum(["prepare", "activate"]),
    expectedGroupVersion: z.string().nullable(),
    binding: nativeGroupInputSchema,
  })
  .strict();
interface Record {
  fingerprint: string;
  group: CollaborationSpace;
  phase: "prepared" | "applied" | "superseded";
}
/** Both journal and binding are committed in the same Gateway transaction. */
export function authorizeNativeGroup(store: GatewayStore, raw: unknown) {
  const input = commandSchema.parse(raw);
  if (
    store.get("retired-groups", imConversationKey(input.binding.conversation))
  )
    throw new Error("This group is dissolved or archived.");
  const { phase, ...contents } = input;
  const fingerprint = JSON.stringify(contents);
  return store.transaction(() => {
    const recorded = store.get<Record>(
      "native-authorizations",
      input.operationId,
    );
    if (recorded && recorded.fingerprint !== fingerprint)
      throw new Error(
        "Authorization operation ID conflicts with saved contents.",
      );
    const identity = store.get<{ deviceId: string }>(
      "identities",
      imIdentityKey(input.binding.owner),
    );
    const device = store.get<{ revoked: boolean }>(
      "devices",
      input.binding.deviceId,
    );
    if (
      identity?.deviceId !== input.binding.deviceId ||
      !device ||
      device.revoked
    )
      throw new Error("Authorization identity is no longer paired.");
    if (recorded?.phase === "superseded")
      throw new Error(
        "This authorization was superseded by a new confirmation.",
      );
    if (recorded) {
      const current = store.get<CollaborationSpace>(
        "native-groups",
        recorded.group.id,
      );
      if (current?.revision !== recorded.group.revision)
        throw new Error("Authorization group version conflict.");
      if (phase === "activate" && recorded.phase !== "applied") {
        store.put("native-groups", recorded.group.id, recorded.group);
        store.put(
          "space-confirmations",
          recorded.group.id,
          input.binding.enabled
            ? [imConversationKey(input.binding.conversation)]
            : [],
        );
        recorded.phase = "applied";
        store.put("native-authorizations", input.operationId, recorded);
      }
      return { version: 1, group: recorded.group, phase: recorded.phase };
    }
    if (phase !== "prepare") throw new Error("Prepare authorization first.");
    const current = store
      .list<CollaborationSpace>("native-groups")
      .find((g) =>
        g.endpoints.some(
          (e) =>
            imConversationKey(e) ===
            imConversationKey(input.binding.conversation),
        ),
      );
    if ((current?.revision ?? null) !== input.expectedGroupVersion)
      throw new Error("Authorization group version conflict.");
    if (input.supersedes) {
      const old = store.get<Record>("native-authorizations", input.supersedes);
      if (old) {
        if (old.group.id !== current?.id)
          throw new Error("A replacement must target the same group.");
        store.put("native-authorizations", input.supersedes, {
          ...old,
          phase: "superseded",
        });
      }
    }
    const group = saveNativeGroup(store, input.binding);
    // Reserve the final version now. Activation never rolls that version again.
    store.put("native-groups", group.id, {
      ...group,
      nativeGroup: { ...group.nativeGroup!, enabled: false },
    });
    store.put("space-confirmations", group.id, []);
    const record: Record = { fingerprint, group, phase: "prepared" };
    store.put("native-authorizations", input.operationId, record);
    return { version: 1, group, phase: record.phase };
  });
}

import {
  imConversationKey,
  imIdentityKey,
  type CollaborationSpace,
} from "@artemis/protocol";
import { diagnosticSchema } from "./ImDiagnostics";
import { imChannelLabel, type ImTranslate } from "./ImNavigation";

export function imNativeGroupChoices(
  diagnostics: unknown,
  spaces: unknown[],
  deviceId: string,
  t: ImTranslate,
) {
  const parsed = diagnosticSchema.safeParse(diagnostics);
  const native = spaces
    .filter(
      (s): s is CollaborationSpace =>
        !!s && typeof s === "object" && "nativeGroup" in s,
    )
    .filter((s) => !s.participants.some((p) => p.identity.channel === "wecom"));
  const observed = parsed.success
    ? parsed.data.groups.filter(
        (g) =>
          g.platform !== "wecom" &&
          !g.identities.some((i) => i.channel === "wecom"),
      )
    : [];
  const groups = [
    ...observed,
    ...native
      .filter(
        (s) =>
          !observed.some(
            (g) =>
              imConversationKey(g.conversation) ===
              imConversationKey(s.endpoints[0]!),
          ),
      )
      .map((s) => ({
        conversation: s.endpoints[0]!,
        name: s.name,
        identities: s.participants.map((p) => p.identity),
        lastSeenAt: 0,
        platform: s.participants[0]?.identity.channel,
        nameError: undefined,
      })),
  ];
  function groupLabel(group: (typeof groups)[number]) {
    const channel = group.platform ?? group.identities[0]?.channel;
    const platform =
      channel === "lark"
        ? "Lark"
        : channel
          ? imChannelLabel(channel, t)
          : t("ImNativeGroups.message1");
    const name =
      group.name?.trim() ||
      native.find(
        (item) =>
          imConversationKey(item.endpoints[0]!) ===
          imConversationKey(group.conversation),
      )?.name;
    const duplicate =
      name && groups.some((other) => other !== group && other.name === name);
    return name
      ? `${name} · ${platform}${duplicate ? ` · ${group.conversation.connectionId} · ${group.conversation.id}` : ""}`
      : `${platform} · ${group.conversation.id}`;
  }
  return groups.map((group) => {
    const saved = native.find(
      (space) =>
        imConversationKey(space.endpoints[0]!) ===
        imConversationKey(group.conversation),
    );
    const owner = parsed.success
      ? parsed.data.identities.find(
          (item) =>
            item.deviceId === deviceId &&
            item.identity.connectionId === group.conversation.connectionId &&
            group.identities.some(
              (sender) =>
                imIdentityKey(sender) === imIdentityKey(item.identity),
            ),
        )?.identity
      : undefined;
    return {
      ...group,
      saved,
      owner,
      label: groupLabel(group),
      value: saved
        ? `space:${saved.id}`
        : `native:${imConversationKey(group.conversation)}`,
    };
  });
}

import { useState } from "react";
import {
  imConversationKey,
  imIdentityKey,
  type ImSettings,
  type Project,
  type CollaborationSpace,
} from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";
import { Select, TextField } from "@artemis/ui/forms";
import { InlineNotice } from "@artemis/ui/feedback";
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
      ? `${name} · ${platform}${duplicate ? ` · ${group.conversation.id}` : ""}`
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

export function ImNativeGroups({
  diagnostics,
  settings,
  spaces,
  projects,
  busy,
  t,
  run,
  refresh,
  open,
}: {
  diagnostics: unknown;
  settings: ImSettings;
  spaces: unknown[];
  projects: Project[];
  busy: boolean;
  t: ImTranslate;
  run(action: () => Promise<unknown>): Promise<boolean>;
  refresh(): Promise<void>;
  open?: ((id: string) => Promise<void>) | undefined;
}) {
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const groups = imNativeGroupChoices(
    diagnostics,
    spaces,
    settings.deviceId,
    t,
  );
  const current = groups.find(
    (group) => imConversationKey(group.conversation) === selected,
  );
  const group = current?.saved;
  return (
    <div className="im-field-stack">
      <p>{t("ImNativeGroups.message2")}</p>
      <TextField
        label={t("ImNativeGroups.message3")}
        value={query}
        onValueChange={setQuery}
      />
      <Select
        labelVisibility="visible"
        label={t("ImNativeGroups.message4")}
        value={selected}
        disabled={busy}
        options={[
          { value: "", label: t("ImNativeGroups.message5") },
          ...groups
            .filter(
              (g) =>
                g.label
                  .toLocaleLowerCase()
                  .includes(query.toLocaleLowerCase()) ||
                imConversationKey(g.conversation) === selected,
            )
            .map((g) => ({
              value: imConversationKey(g.conversation),
              label: g.label,
            })),
        ]}
        onValueChange={setSelected}
      />
      {group && (
        <div key={group.id} className="im-field-stack">
          <strong>{group.name}</strong>
          <span>
            {group.nativeGroup?.enabled
              ? group.nativeGroup.capability === "events"
                ? t("ImNativeGroups.message8")
                : t("ImNativeGroups.message7")
              : t("AutomationPage_text.paused")}
          </span>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const status = await window.artemis.getImStatus();
                const task = status.remoteTasks?.find(
                  (task) =>
                    !task.parentThreadId && task.group?.spaceId === group.id,
                );
                if (task) await open?.(task.threadId);
              })
            }
          >
            {t("ImNativeGroups.message9")}
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const member = group.participants[0]!;
                await window.artemis.manageIm({
                  action: "admin",
                  operation: "native-group",
                  configuration: {
                    conversation: group.endpoints[0],
                    owner: member.identity,
                    allowedSenders: group.participants
                      .slice(1)
                      .map((p) => p.identity),
                    deviceId: member.deviceId,
                    name: group.name,
                    projectId: group.nativeGroup!.projectId,
                    enabled: false,
                  },
                });
                await refresh();
              })
            }
          >
            {t("ImNativeGroups.message10")}
          </Button>
        </div>
      )}
      {!groups.length ? <p>{t("ImNativeGroups.message11")}</p> : null}
      {current && (
        <>
          {current?.nameError ? (
            <InlineNotice tone="warning">
              {current.nameError === "missing-scope"
                ? t("ImNativeGroups.message14")
                : current.nameError === "access-denied" ||
                    current.nameError === "removed"
                  ? t("ImNativeGroups.message13")
                  : t("ImNativeGroups.message12")}
            </InlineNotice>
          ) : null}
          {group && (
            <p>
              {
                projects.find(
                  (project) => project.id === group.nativeGroup?.projectId,
                )?.name
              }
            </p>
          )}
        </>
      )}
    </div>
  );
}

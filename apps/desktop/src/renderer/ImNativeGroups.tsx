import { ImGroupPathTree, type GroupPathSelection } from "./ImGroupPathTree";
import { useState } from "react";
import {
  executionGrantSchema,
  IM_SECURITY_VERSION,
  imConversationKey,
  imIdentityKey,
  type ImSettings,
  type Project,
  type CollaborationSpace,
} from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";
import { Select, Checkbox, TextField } from "@artemis/ui/forms";
import { InlineNotice } from "@artemis/ui/feedback";
import { diagnosticSchema } from "./ImDiagnostics";
import { imChannelLabel, type ImTranslate } from "./ImNavigation";

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
  const [projectId, setProjectId] = useState("");
  const [selection, setSelection] = useState<GroupPathSelection>({
    readPaths: [],
    writePaths: [],
    filePaths: [],
  });
  const [query, setQuery] = useState("");
  const [confirmed, setConfirmed] = useState(false);
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
  const current = groups.find(
    (g) => imConversationKey(g.conversation) === selected,
  );
  const owner =
    parsed.success && current
      ? parsed.data.identities.find(
          (i) =>
            i.deviceId === settings.deviceId &&
            i.identity.connectionId === current.conversation.connectionId &&
            current.identities.some(
              (sender) => imIdentityKey(sender) === imIdentityKey(i.identity),
            ),
        )
      : undefined;
  const existing = settings.grants.find((g) => g.projectId === projectId);
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
                groupLabel(g)
                  .toLocaleLowerCase()
                  .includes(query.toLocaleLowerCase()) ||
                imConversationKey(g.conversation) === selected,
            )
            .map((g) => ({
              value: imConversationKey(g.conversation),
              label: groupLabel(g),
            })),
        ]}
        onValueChange={(value) => {
          setSelected(value);
          const saved = native.find(
            (g) => imConversationKey(g.endpoints[0]!) === value,
          );
          const grant = settings.grants.find(
            (g) => g.projectId === saved?.nativeGroup?.projectId,
          );
          const scope = grant?.security?.scopes.find(
            (s) => s.audience === `space:${saved?.id}`,
          );
          setProjectId(saved?.nativeGroup?.projectId ?? "");
          setSelection({
            readPaths: scope?.readPaths ?? [],
            writePaths: scope?.writePaths ?? [],
            filePaths: scope?.filePaths ?? [],
          });
          setConfirmed(false);
        }}
      />
      {native
        .filter((group) => imConversationKey(group.endpoints[0]!) === selected)
        .map((group) => (
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
        ))}
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
          <Select
            labelVisibility="visible"
            label={t("AutomationPage_text.local")}
            value={projectId}
            disabled={busy}
            options={[
              { value: "", label: t("ImNativeGroups.message16") },
              ...projects.map((p) => ({ value: p.id, label: p.name })),
            ]}
            onValueChange={(value) => {
              setProjectId(value);
              setSelection({ readPaths: [], writePaths: [], filePaths: [] });
              setConfirmed(false);
            }}
          />
          <p>
            {existing
              ? t("ImNativeGroups.message18", { value1: existing.mode })
              : t("ImNativeGroups.message17")}
          </p>
          {projectId ? (
            <ImGroupPathTree
              key={projectId}
              projectId={projectId}
              value={selection}
              disabled={busy}
              t={t}
              onChange={(value) => {
                setSelection(value);
                setConfirmed(false);
              }}
            />
          ) : null}
          <Checkbox
            label={t("ImNativeGroups.message19")}
            checked={confirmed}
            onCheckedChange={setConfirmed}
            disabled={busy}
          />
          <Button
            disabled={
              busy ||
              !current ||
              !owner ||
              !projectId ||
              !confirmed ||
              !selection.readPaths.length
            }
            onClick={() =>
              void run(async () => {
                if (!current || !owner || !selection.readPaths.length) return;
                const grant = executionGrantSchema.parse({
                  ...(existing ?? {}),
                  projectId,
                  expiresAt: existing?.expiresAt ?? Date.now() + 30 * 86400000,
                  security: {
                    version: IM_SECURITY_VERSION,
                    revision: "draft",
                    confirmedAt: Date.now(),
                    scopes: [
                      {
                        audience: "owner",
                        ...selection,
                      },
                    ],
                  },
                });
                await window.artemis.manageIm({
                  action: "authorize-native-group",
                  conversation: current.conversation,
                  owner: owner.identity,
                  allowedSenders: [],
                  name: (current.name || groupLabel(current)).slice(0, 100),
                  grant,
                  confirmed: true,
                });
                setConfirmed(false);
                await refresh();
              })
            }
          >
            {t("ImNativeGroups.message20")}
          </Button>
        </>
      )}
    </div>
  );
}

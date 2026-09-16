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
          : t("IM 群", "IM group");
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
      <p>
        {t(
          "选择一个群，设置接收任务的项目和分享范围。启用后，群成员可以直接 @ 机器人，无需与接收方电脑配对。",
          "Choose a group and authorize its project and shared scope. Members can then mention the bot without pairing to its computer.",
        )}
      </p>
      <TextField
        label={t("搜索群", "Search groups")}
        value={query}
        onValueChange={setQuery}
      />
      <Select
        labelVisibility="visible"
        label={t("已发现的群", "Discovered group")}
        value={selected}
        disabled={busy}
        options={[
          { value: "", label: t("选择群", "Choose group") },
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
                  ? t("已启用 · IM 自动协作", "Enabled · IM cooperation")
                  : t("已启用 · 人工派工", "Enabled · Manual assignment")
                : t("已暂停", "Paused")}
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
              {t("打开群对话", "Open group conversation")}
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
              {t("暂停接入，保留历史", "Pause and keep history")}
            </Button>
          </div>
        ))}
      {!groups.length ? (
        <p>
          {t(
            "尚未发现群。请先在群里 @机器人，再刷新。",
            "No groups discovered. Mention your bot in the group, then refresh.",
          )}
        </p>
      ) : null}
      {current && (
        <>
          {current?.nameError ? (
            <InlineNotice tone="warning">
              {current.nameError === "missing-scope"
                ? t(
                    "读取 Slack 群名缺少权限：请在 Slack 应用的 OAuth & Permissions 中添加 channels:read（公开频道）和 groups:read（私有频道），重新安装应用到工作区后刷新群列表。",
                    "Slack channel names require channels:read (public) and groups:read (private). Add these under OAuth & Permissions, reinstall the app to the workspace, then refresh groups.",
                  )
                : current.nameError === "access-denied" ||
                    current.nameError === "removed"
                  ? t(
                      "机器人无法访问该群，请确认它仍在群内且具有访问权限。",
                      "The bot cannot access this group. Check its membership and access.",
                    )
                  : t(
                      "群名暂未查询成功，将自动重试。请检查连接状态与群信息读取权限。",
                      "Group name lookup has not succeeded yet and will retry. Check connection status and group metadata permissions.",
                    )}
            </InlineNotice>
          ) : null}
          <Select
            labelVisibility="visible"
            label={t("本地项目", "Local project")}
            value={projectId}
            disabled={busy}
            options={[
              { value: "", label: t("选择项目", "Choose project") },
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
              ? t(
                  `沿用该项目的 ${existing.mode} 操作权限；其他权限请在项目授权中修改。`,
                  `Uses this project's ${existing.mode} policy. Change other permissions in Project permissions.`,
                )
              : t(
                  "新项目授权默认为 Plan，仅咨询与读取，不允许修改或执行命令。",
                  "New grants default to Plan: advice and reading, without writes or commands.",
                )}
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
            label={t(
              "我确认上述项目范围可用于回复本群所有成员，并允许群成员 @ 此机器人提交任务",
              "I allow this project scope to be shared with all group members and allow members to mention this bot to submit tasks",
            )}
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
            {t("确认并启用群聊", "Confirm and enable group")}
          </Button>
        </>
      )}
    </div>
  );
}

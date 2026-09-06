import { useState } from "react";
import {
  imConversationKey,
  imIdentityKey,
  type ImConnectionStatus,
} from "@artemis/protocol";
import { TextField, Checkbox, Select } from "@artemis/ui/forms";
import { InlineNotice } from "@artemis/ui/feedback";
import { diagnosticSchema } from "./ImDiagnostics";
import { imChannelLabel, type ImTranslate } from "./ImNavigation";

export function ImSpaceBuilder({
  diagnostics,
  value,
  onChange,
  connections,
  busy,
  t,
}: {
  diagnostics: unknown;
  value: string;
  onChange(value: string): void;
  connections: ImConnectionStatus[];
  busy: boolean;
  t: ImTranslate;
}) {
  const [id] = useState(() => `space-${crypto.randomUUID().slice(0, 8)}`);
  const data = diagnosticSchema.safeParse(diagnostics);
  let raw: unknown;
  try {
    raw = value
      ? JSON.parse(value)
      : { id, name: "", endpoints: [], participants: [], administrators: [] };
  } catch {
    raw = undefined;
  }
  const parsed = diagnosticSchema.shape.spaces.element.safeParse(raw);
  if (!parsed.success)
    return (
      <InlineNotice tone="warning">
        {t(
          "请先修正高级 JSON 配置，或清空它以重新使用表单。",
          "Fix the advanced JSON, or clear it to return to the form.",
        )}
      </InlineNotice>
    );
  const draft = parsed.data;
  const update = (patch: Partial<typeof draft>) =>
    onChange(JSON.stringify({ ...draft, ...patch }, null, 2));
  const members = data.success ? data.data.identities : [];
  const groups = data.success
    ? data.data.groups
        .filter((g) => g.conversation.kind === "group")
        .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    : [];
  const connectionName = (connectionId: string) =>
    connections.find((c) => c.id === connectionId)?.name ?? connectionId;
  return (
    <div className="im-space-builder im-field-stack">
      {!data.success && (
        <InlineNotice tone="info">
          {t(
            "群和成员尚未加载，请点击“刷新群和成员”。这里的空表单不代表已保存的空间或账号被删除。",
            "Groups and members have not loaded. Select Refresh groups and members. An empty form does not mean saved spaces or accounts were deleted.",
          )}
        </InlineNotice>
      )}
      <TextField
        size="compact"
        label={t("给这组群起个名字", "Name this group space")}
        placeholder={t(
          "例如：我的项目讨论群",
          "For example: Project discussion",
        )}
        description={t(
          "选择同平台或跨平台的群／频道，统一放入这个空间；成员在各自的 IM 中参与。发给机器人的任务和公开结果会在这些入口之间共享。",
          "Connect groups/channels from the same or different platforms. Members participate from their own IM, sharing bot tasks and public results across these entries.",
        )}
        value={draft.name}
        maxLength={100}
        disabled={busy}
        onValueChange={(name) => update({ name })}
      />
      <h4>{t("选择要接入的群", "Choose groups to connect")}</h4>
      {data.success && !groups.length && (
        <p>
          {t(
            "还没有发现群。请先在目标群 @机器人发送 /help，然后点击上方“刷新群和成员”。Slack 发送 help，不加 /。",
            "No groups found. Mention the bot with /help in your group, then select Refresh groups and members above. Use help without / in Slack.",
          )}
        </p>
      )}
      {groups.map(({ conversation }) => {
        const key = imConversationKey(conversation);
        return (
          <Checkbox
            key={key}
            label={`${connectionName(conversation.connectionId)} · ${conversation.id}`}
            checked={draft.endpoints.some((e) => imConversationKey(e) === key)}
            disabled={busy}
            onCheckedChange={(checked) => {
              const endpoints = checked
                ? [...draft.endpoints, conversation]
                : draft.endpoints.filter((e) => imConversationKey(e) !== key);
              update({
                endpoints,
                administrators: draft.administrators.filter((a) =>
                  endpoints.some((e) => e.connectionId === a.connectionId),
                ),
              });
            }}
          />
        );
      })}
      <p>
        {t(
          "群列表按最近收到消息排序；平台没有提供群名时显示群编号，无需手工查找或填写。",
          "Groups are ordered by recent activity. When the platform provides no name, the group ID is shown; no manual lookup is needed.",
        )}
      </p>
      <h4>
        {t(
          "选择可以参与的账号与电脑",
          "Choose participating accounts and computers",
        )}
      </h4>
      {data.success && !members.length && (
        <p>
          {t(
            "还没有已配对账号。请先到“配对与账号”完成本人绑定，再刷新。",
            "No paired accounts. Complete Pairing & accounts first, then refresh.",
          )}
        </p>
      )}
      {members.map((member) => {
        const key = imIdentityKey(member.identity);
        return (
          <div key={key} className="im-field-stack">
            <Checkbox
              label={`${member.identity.userId} · ${imChannelLabel(member.identity.channel, t)} · ${(data.success && data.data.devices.find((device) => device.id === member.deviceId)?.name) || member.deviceId}`}
              checked={draft.participants.some(
                (p) => imIdentityKey(p.identity) === key,
              )}
              disabled={busy}
              onCheckedChange={(checked) =>
                update({
                  participants: checked
                    ? [
                        ...draft.participants,
                        { ...member, name: member.identity.userId },
                      ]
                    : draft.participants.filter(
                        (p) => imIdentityKey(p.identity) !== key,
                      ),
                  administrators: checked
                    ? draft.administrators
                    : draft.administrators.filter(
                        (a) => imIdentityKey(a) !== key,
                      ),
                })
              }
            />
            {draft.participants.some(
              (p) => imIdentityKey(p.identity) === key,
            ) && (
              <TextField
                label={t(
                  `成员显示名称 · ${member.identity.userId}`,
                  `Member display name · ${member.identity.userId}`,
                )}
                description={t(
                  "用于群成员列表和提示词分工；同名成员仍通过电脑编号区分。",
                  "Used in the member list and assignment prompts; computer IDs distinguish duplicate names.",
                )}
                value={
                  draft.participants.find(
                    (p) => imIdentityKey(p.identity) === key,
                  )!.name
                }
                maxLength={100}
                size="compact"
                disabled={busy}
                onValueChange={(name) =>
                  update({
                    participants: draft.participants.map((p) =>
                      imIdentityKey(p.identity) === key ? { ...p, name } : p,
                    ),
                  })
                }
              />
            )}
          </div>
        );
      })}
      {[...new Set(draft.endpoints.map((e) => e.connectionId))].map(
        (connectionId) => (
          <Select
            labelVisibility="visible"
            key={connectionId}
            label={t(
              `谁来确认群接入 · ${connectionName(connectionId)}`,
              `Who confirms the groups · ${connectionName(connectionId)}`,
            )}
            value={
              draft.administrators.find((a) => a.connectionId === connectionId)
                ? imIdentityKey(
                    draft.administrators.find(
                      (a) => a.connectionId === connectionId,
                    )!,
                  )
                : ""
            }
            options={[
              {
                value: "",
                label: t(
                  "选择一位已勾选且在该群的成员",
                  "Choose a selected member who belongs to the group",
                ),
              },
              ...draft.participants
                .filter((p) => p.identity.connectionId === connectionId)
                .map((p) => ({
                  value: imIdentityKey(p.identity),
                  label: p.name,
                })),
            ]}
            disabled={busy}
            onValueChange={(key) => {
              const member = draft.participants.find(
                (p) => imIdentityKey(p.identity) === key,
              );
              update({
                administrators: [
                  ...draft.administrators.filter(
                    (a) => a.connectionId !== connectionId,
                  ),
                  ...(member ? [member.identity] : []),
                ],
              });
            }}
          />
        ),
      )}
      <p>
        {t(
          "被选中的确认人需要在相应群内发送下一步提供的确认指令。只有群、参与成员和确认人都选好后才能保存。",
          "The designated person sends the confirmation command in each selected group. Choose groups, participants and a confirmer before saving.",
        )}
      </p>
    </div>
  );
}

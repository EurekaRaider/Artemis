import { ImMemberRemoval } from "./ImMemberRemoval";
import { useState } from "react";
import {
  imConversationKey,
  imGroupContextSchema,
  type ImSettings,
  type Project,
} from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";
import { Checkbox, Select, TextField } from "@artemis/ui/forms";
import { InlineNotice } from "@artemis/ui/feedback";
import { diagnosticSchema } from "./ImDiagnostics";
import { imChannelLabel, type ImTranslate } from "./ImNavigation";

function MemberNameEditor({
  member,
  busy,
  rename,
  t,
}: {
  member: { deviceId: string; name: string; deviceName: string };
  busy: boolean;
  rename(deviceId: string, name: string, deviceName: string): Promise<boolean>;
  t: ImTranslate;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(member.name);
  const [computer, setComputer] = useState(member.deviceName);
  if (!editing)
    return (
      <Button
        variant="quiet"
        disabled={busy}
        label={t("重命名：", "Rename: ") + member.name}
        onClick={() => {
          setName(member.name);
          setComputer(member.deviceName);
          setEditing(true);
        }}
      >
        {t("重命名", "Rename")}
      </Button>
    );
  return (
    <div className="im-field-stack im-member-name-editor">
      <TextField
        label={t("成员姓名", "Member name")}
        value={name}
        onValueChange={setName}
        maxLength={100}
        disabled={busy}
      />
      <TextField
        label={t("电脑名称", "Computer name")}
        value={computer}
        onValueChange={setComputer}
        maxLength={100}
        disabled={busy}
      />
      <small>
        {t(
          "作为当前 Artemis 的备注保存，重启后保留；不会修改对方的 IM 账号。",
          "Saved as names in this Artemis, including after restart; the member's IM account stays the same.",
        )}
      </small>
      <div className="im-inline-actions">
        <Button
          disabled={busy || !name.trim() || !computer.trim()}
          onClick={async () => {
            if (await rename(member.deviceId, name.trim(), computer.trim()))
              setEditing(false);
          }}
        >
          {t("保存名称", "Save names")}
        </Button>
        <Button
          variant="quiet"
          disabled={busy}
          onClick={() => setEditing(false)}
        >
          {t("取消", "Cancel")}
        </Button>
      </div>
    </div>
  );
}

export function ImGroupTaskComposer({
  spaces,
  settings,
  projects,
  busy,
  open,
  rename,
  remove,
  canRemove,
  t,
}: {
  spaces: unknown[];
  settings: ImSettings;
  projects: Project[];
  busy: boolean;
  open(spaceId: string, participantIds: string[], projectId: string): void;
  remove(spaceId: string, deviceId: string): Promise<boolean>;
  canRemove: boolean;
  rename(deviceId: string, name: string, deviceName: string): Promise<boolean>;
  t: ImTranslate;
}) {
  const [spaceId, setSpaceId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [deviceIds, setDeviceIds] = useState<string[]>([]);
  const available = spaces.flatMap((value) => {
    const parsed = diagnosticSchema.shape.spaces.element
      .extend({ participants: imGroupContextSchema.shape.members })
      .safeParse(value);
    return parsed.success
      ? [
          {
            ...parsed.data,
            confirmed:
              !!value &&
              typeof value === "object" &&
              "confirmed" in value &&
              value.confirmed === true,
          },
        ]
      : [];
  });
  const space = available.find((s) => s.id === spaceId);
  const members = [
    ...new Map(
      (space?.participants ?? []).map((p) => [p.deviceId, p]),
    ).values(),
  ];
  const authorizedProjects = projects.filter((p) =>
    settings.grants.some(
      (g) =>
        g.projectId === p.id &&
        g.expiresAt > Date.now() &&
        (g.groups.includes(`space:${spaceId}`) ||
          space?.endpoints.some((e) =>
            g.groups.includes(imConversationKey(e)),
          )),
    ),
  );
  const selectedProject =
    authorizedProjects.find((p) => p.id === projectId) ??
    authorizedProjects.find((p) => p.id === settings.defaultProjectId) ??
    (authorizedProjects.length === 1 ? authorizedProjects[0] : undefined);
  const ready =
    space?.confirmed &&
    settings.enabled &&
    selectedProject &&
    deviceIds.length > 0 &&
    deviceIds.every((id) =>
      members.some((m) => m.deviceId === id && m.state !== "unavailable"),
    );
  return (
    <div className="im-field-stack im-group-task-composer">
      <h4>{t("4 · 与成员的 Agent 对话", "4 · Talk to members' Agents")}</h4>
      <p>
        {t(
          "选择成员和电脑，创建后直接进入 Artemis 群协作对话。在输入框中 @成员安排任务，也可以同时给多位成员分配不同工作。",
          "Choose members and computers, then open a group conversation in Artemis. Mention members with @ to assign tasks, including different work for several members at once.",
        )}
      </p>
      <Select
        label={t("协作空间", "Collaboration space")}
        labelVisibility="visible"
        value={spaceId}
        options={[
          { value: "", label: t("选择已保存的空间", "Choose a saved space") },
          ...available.map((s) => ({ value: s.id, label: s.name })),
        ]}
        disabled={busy}
        onValueChange={(value) => {
          setSpaceId(value);
          setDeviceIds([]);
          setProjectId("");
        }}
      />
      {space && !space.confirmed && (
        <InlineNotice tone="warning">
          {t(
            "请先完成所有群的确认，再刷新状态。",
            "Confirm every group, then refresh the status.",
          )}
        </InlineNotice>
      )}
      {space && (
        <>
          <div
            role="group"
            aria-label={t("目标成员与电脑", "Target members and computers")}
          >
            <p>
              {t(
                "选择目标成员与电脑（可多选，最多 16 位）",
                "Choose members and computers (up to 16)",
              )}
            </p>
            {members.map((member) => (
              <div className="im-target-member" key={member.deviceId}>
                <Checkbox
                  label={`${member.name} · ${member.deviceName || t("电脑", "Computer")} · ${imChannelLabel(member.identity.channel, t)}`}
                  checked={deviceIds.includes(member.deviceId)}
                  disabled={
                    busy ||
                    member.state === "unavailable" ||
                    (!deviceIds.includes(member.deviceId) &&
                      deviceIds.length >= 16)
                  }
                  onCheckedChange={(checked) =>
                    setDeviceIds((current) =>
                      checked
                        ? [...current, member.deviceId]
                        : current.filter((id) => id !== member.deviceId),
                    )
                  }
                />
                <ImMemberRemoval
                  name={`${member.name} · ${member.deviceName}`}
                  scope="space"
                  disabled={busy || !canRemove}
                  t={t}
                  remove={async () => {
                    const removed = await remove(spaceId, member.deviceId);
                    if (removed)
                      setDeviceIds((current) =>
                        current.filter((id) => id !== member.deviceId),
                      );
                    return removed;
                  }}
                />
                <MemberNameEditor
                  member={member}
                  busy={busy}
                  rename={rename}
                  t={t}
                />
              </div>
            ))}
          </div>
          <Select
            label={t("本地协作项目", "Local collaboration project")}
            labelVisibility="visible"
            value={selectedProject?.id ?? ""}
            options={[
              {
                value: "",
                label: t("选择已授权项目", "Choose an authorized project"),
              },
              ...authorizedProjects.map((p) => ({
                value: p.id,
                label: p.name,
              })),
            ]}
            disabled={busy}
            onValueChange={setProjectId}
          />
          {!authorizedProjects.length && (
            <InlineNotice tone="warning">
              {t(
                "请先在消息接入的“项目授权”中为这个空间授权项目，再创建对话。",
                "Authorize a project for this space under Message access → Project permissions before creating a conversation.",
              )}
            </InlineNotice>
          )}
        </>
      )}
      <Button
        disabled={busy || !ready}
        onClick={() => {
          if (selectedProject) open(spaceId, deviceIds, selectedProject.id);
        }}
      >
        {t("创建并打开协作对话", "Create and open conversation")}
      </Button>
      <small>
        {t(
          "成员姓名和电脑名称可在上方重命名，保存后长期保留。派发任务需使用 Execute 模式；目标成员按自己的项目授权与审批执行，公开结果会共享到空间内连接的 IM 群。",
          "Rename members and computers above; saved names persist. Use Execute mode to dispatch. Each member works under their own project grants and approvals, and public results are shared with the space's connected IM groups.",
        )}
      </small>
    </div>
  );
}

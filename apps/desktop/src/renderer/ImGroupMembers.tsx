import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ImMemberRemoval } from "./ImMemberRemoval";
import {
  imIdentityKey,
  imGroupMentionTargets,
  type AppLocale,
  type ImGroupContext,
} from "@artemis/protocol";
import { EnvironmentSection } from "@artemis/ui/workflow";
import { Tooltip } from "@artemis/ui/feedback";
import { IconButton } from "@artemis/ui/actions";
import { ArtemisIcon } from "@artemis/ui/icons";
import { imChannelLabel } from "./ImNavigation";

export function ImGroupMembers({
  group,
  locale,
  onMention,
  onRemove,
  removalDisabled = false,
}: {
  group: ImGroupContext;
  locale: AppLocale;
  onMention?: ((token: string) => void) | undefined;
  onRemove?: ((deviceId: string) => Promise<boolean>) | undefined;
  removalDisabled?: boolean | undefined;
}) {
  const t = (cn: string, en: string) => (locale.startsWith("zh") ? cn : en);
  type Person = NonNullable<ImGroupContext["roster"]>["members"][number];
  const [menu, setMenu] = useState<{
    member: Person;
    x: number;
    y: number;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setMenu(null);
    setError("");
    setPermissions({});
  }, [group.spaceId]);
  useEffect(() => setPermissions({}), [group.roster]);

  useEffect(() => {
    if (!group.native || !group.confirmed) return;
    const refresh = () => {
      if (!document.hidden)
        void window.artemis
          .manageIm({
            action: "refresh-group-members",
            spaceId: group.spaceId,
          })
          .catch(() => {});
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [group.native, group.confirmed, group.spaceId]);

  const canAssign = (member: Person) =>
    permissions[imIdentityKey(member.identity)] ?? member.canAssign ?? true;
  const toggleAssignment = async (member: Person) => {
    if (
      saving ||
      group.stale ||
      !group.confirmed ||
      member.owner ||
      member.self ||
      member.kind === "unknown"
    )
      return;
    const key = imIdentityKey(member.identity);
    const allowed = !canAssign(member);
    setSaving(true);
    setError("");
    try {
      await window.artemis.manageIm({
        action: "set-group-member-assignment",
        spaceId: group.spaceId,
        identity: member.identity,
        allowed,
      });
      setPermissions((previous) => ({ ...previous, [key]: allowed }));
      setMenu(null);
    } catch (cause) {
      setError(String(cause));
      setMenu(null);
    } finally {
      setSaving(false);
    }
  };

  if (group.native) {
    const roster = group.roster;
    const channel = group.members[0]?.identity.channel;
    const targets = imGroupMentionTargets(group);
    return (
      <EnvironmentSection
        title={`${t("群协作成员", "Group members")}${roster?.complete ? ` · ${roster.members.length}` : ""}`}
      >
        <div className="environment-setting-copy im-group-members im-native-members">
          {error && <small role="alert">{error}</small>}
          {menu &&
            createPortal(
              <div
                className="file-link-context-backdrop"
                onMouseDown={() => setMenu(null)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenu(null);
                }}
              >
                <div
                  className="file-link-context-menu im-member-permission-menu"
                  role="menu"
                  aria-label={t("成员派工权限", "Member assignment permission")}
                  style={{ left: menu.x, top: menu.y }}
                  onMouseDown={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.stopPropagation();
                      setMenu(null);
                    }
                  }}
                >
                  <button
                    autoFocus
                    aria-label={
                      (permissions[imIdentityKey(menu.member.identity)] ??
                      menu.member.canAssign ??
                      true)
                        ? t(
                            `禁止 ${menu.member.name} 派工`,
                            `Block assignments from ${menu.member.name}`,
                          )
                        : t(
                            `允许 ${menu.member.name} 派工`,
                            `Allow assignments from ${menu.member.name}`,
                          )
                    }
                    role="menuitemcheckbox"
                    aria-checked={
                      permissions[imIdentityKey(menu.member.identity)] ??
                      menu.member.canAssign ??
                      true
                    }
                    disabled={
                      saving ||
                      group.stale ||
                      !group.confirmed ||
                      menu.member.owner ||
                      menu.member.self
                    }
                    onClick={() => toggleAssignment(menu.member)}
                  >
                    {(permissions[imIdentityKey(menu.member.identity)] ??
                    menu.member.canAssign ??
                    true)
                      ? t("禁止派工", "Block assignments")
                      : t("允许派工", "Allow assignments")}
                  </button>
                </div>
              </div>,
              document.body,
            )}

          {(!roster?.complete || group.stale) && (
            <small role="status">
              {roster?.error === "missing-scope"
                ? channel === "feishu"
                  ? t(
                      "群成员信息未完整同步。请开启飞书/Lark 的 im:chat.members:read 权限，发布应用后刷新。",
                      "Member information is incomplete. Enable Feishu/Lark im:chat.members:read, publish the app and refresh.",
                    )
                  : t(
                      "群成员信息未完整同步。请检查 Slack 的 channels:read、groups:read 和 users:read 权限，重新授权后刷新。",
                      "Member information is incomplete. Check Slack channels:read, groups:read and users:read scopes, reauthorize and refresh.",
                    )
                : channel === "wecom"
                  ? t(
                      "企业微信当前仅显示已向机器人发消息的群成员，无法获取完整群目录或在线状态。",
                      "WeCom shows members observed messaging this bot; a full directory and presence are unavailable.",
                    )
                  : channel === "feishu" && roster?.error === "partial"
                    ? t(
                        "飞书/Lark 成员接口不包含机器人；当前目录可能不完整，在线状态未知。",
                        "Feishu/Lark member listings exclude bots; this directory may be incomplete and presence is unknown.",
                      )
                    : t(
                        "群成员信息尚未完整同步，当前列表可能不完整。",
                        "Group members have not fully synced; this list may be incomplete.",
                      )}
            </small>
          )}
          <div
            className="environment-activity-list"
            role="list"
            aria-label={t("协作成员列表", "Collaboration members")}
          >
            {(roster?.members ?? []).map((member) => {
              const target = member.self
                ? targets.find(
                    (value) => value.deviceId === group.executingDeviceId,
                  )
                : undefined;
              const state =
                group.stale || !group.confirmed
                  ? "unknown"
                  : (target?.state ??
                    (member.presenceCheckedAt !== undefined &&
                    Date.now() - member.presenceCheckedAt < 120000
                      ? member.presence
                      : undefined) ??
                    "unknown");
              const status =
                state === "active"
                  ? t("活跃", "Active")
                  : state === "away"
                    ? t("离开", "Away")
                    : state === "online"
                      ? t("在线", "Online")
                      : state === "offline"
                        ? t("离线", "Offline")
                        : state === "unavailable"
                          ? t("不可用", "Unavailable")
                          : t("状态未知", "Status unknown");
              const kind =
                member.kind === "bot"
                  ? t("机器人", "Bot")
                  : member.kind === "human"
                    ? t("成员", "Member")
                    : t("类型未知", "Unknown type");
              const editable =
                !member.owner && !member.self && member.kind !== "unknown";
              return (
                <div
                  className="environment-setting-row"
                  role="listitem"
                  key={imIdentityKey(member.identity)}
                  tabIndex={editable ? 0 : undefined}
                  onContextMenu={(event) => {
                    if (!editable) return;
                    event.preventDefault();
                    setMenu({
                      member,
                      x: Math.max(
                        8,
                        Math.min(event.clientX, window.innerWidth - 176),
                      ),
                      y: Math.max(
                        8,
                        Math.min(event.clientY, window.innerHeight - 60),
                      ),
                    });
                  }}
                  onKeyDown={(event) => {
                    if (
                      editable &&
                      (event.key === "ContextMenu" ||
                        (event.shiftKey && event.key === "F10"))
                    ) {
                      event.preventDefault();
                      const bounds =
                        event.currentTarget.getBoundingClientRect();
                      setMenu({
                        member,
                        x: Math.max(
                          8,
                          Math.min(bounds.left, window.innerWidth - 176),
                        ),
                        y: Math.max(
                          8,
                          Math.min(bounds.bottom, window.innerHeight - 60),
                        ),
                      });
                    }
                  }}
                >
                  <span className="environment-setting-copy">
                    <strong
                      className="im-member-heading"
                      title={`${member.name} · ${kind}`}
                    >
                      <Tooltip label={status}>
                        <span
                          data-state={state}
                          tabIndex={0}
                          className="im-member-kind"
                          role="img"
                          aria-label={kind}
                        >
                          <ArtemisIcon
                            name={member.kind === "bot" ? "bot" : "agents"}
                            width={14}
                            height={14}
                          />
                        </span>
                      </Tooltip>
                      <span>{member.name}</span>

                      {member.self && (
                        <span className="im-member-executor">
                          {t("本任务执行者", "Executes this task")}
                        </span>
                      )}
                    </strong>
                  </span>
                  {editable && (
                    <Tooltip
                      label={
                        canAssign(member)
                          ? t(
                              "允许派工，点击禁止",
                              "Assignments allowed; click to block",
                            )
                          : t(
                              "已禁止派工，点击允许",
                              "Assignments blocked; click to allow",
                            )
                      }
                    >
                      <button
                        type="button"
                        className="im-member-permission-toggle"
                        data-allowed={canAssign(member)}
                        aria-label={
                          canAssign(member)
                            ? t(
                                `禁止 ${member.name} 派工`,
                                `Block assignments from ${member.name}`,
                              )
                            : t(
                                `允许 ${member.name} 派工`,
                                `Allow assignments from ${member.name}`,
                              )
                        }
                        aria-pressed={!canAssign(member)}
                        disabled={saving || group.stale || !group.confirmed}
                        onClick={() => toggleAssignment(member)}
                      >
                        <ArtemisIcon
                          name={canAssign(member) ? "send" : "block"}
                          width={12}
                          height={12}
                        />
                      </button>
                    </Tooltip>
                  )}
                  {target && onMention && (
                    <IconButton
                      className="im-member-action im-member-mention"
                      icon={<span aria-hidden="true">@</span>}
                      label={`@ ${member.name}`}
                      disabled={
                        !group.confirmed ||
                        group.stale ||
                        target.state === "unavailable"
                      }
                      onClick={() => onMention(target.token)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </EnvironmentSection>
    );
  }

  return (
    <EnvironmentSection title={t("群协作成员", "Group collaboration members")}>
      <div className="environment-setting-copy im-group-members">
        {group.stale && (
          <small role="status">
            {t(
              "连接状态暂不可用，成员信息为上次同步结果。",
              "Connection status is unavailable; showing the last synced members.",
            )}
          </small>
        )}
        {!group.confirmed && (
          <small>
            {t(
              "空间待确认或已不可访问",
              "Space awaiting confirmation or no longer accessible",
            )}
          </small>
        )}
        {!imGroupMentionTargets(group).length && (
          <small>
            {t(
              "暂无目标成员，请在设置中选择成员并打开协作对话。",
              "No target members. Select members and open a conversation in Settings.",
            )}
          </small>
        )}
        <div
          className="environment-activity-list"
          role="list"
          aria-label={t("协作成员列表", "Collaboration members")}
        >
          {imGroupMentionTargets(group).map((member) => {
            const state =
              group.stale || !group.confirmed ? "unknown" : member.state;
            const status =
              state === "unknown"
                ? t("状态未知", "Status unknown")
                : state === "unavailable"
                  ? t("账号或电脑已不可用", "Account or computer unavailable")
                  : state === "online"
                    ? t("电脑在线", "Computer online")
                    : t("电脑离线或暂停", "Computer offline or paused");
            return (
              <div
                key={imIdentityKey(member.identity)}
                className="environment-setting-row"
                role="listitem"
              >
                <span className="environment-setting-copy">
                  <strong
                    className="im-member-heading"
                    title={`${member.name} · ${imChannelLabel(member.identity.channel, t)} · ${member.deviceName || member.deviceId}`}
                  >
                    <Tooltip label={status}>
                      <span
                        className="im-thread-computers im-member-computer"
                        data-state={state === "online" ? "online" : "offline"}
                        role="img"
                        aria-label={status}
                        tabIndex={0}
                      >
                        <ArtemisIcon name="monitor" width={14} height={14} />
                      </span>
                    </Tooltip>
                    <span>{member.name}</span>
                    <span className="im-member-device">
                      {member.deviceName || member.deviceId}
                    </span>
                    {member.deviceId === group.executingDeviceId && (
                      <span className="im-member-executor">
                        {t("本任务执行者", "Executes this task")}
                      </span>
                    )}
                  </strong>
                </span>
                {onRemove && (
                  <ImMemberRemoval
                    name={`${member.name} · ${member.deviceName}`}
                    compact
                    scope="conversation"
                    disabled={removalDisabled}
                    remove={() => onRemove(member.deviceId)}
                    t={t}
                  />
                )}
                {onMention && (
                  <Tooltip
                    label={t(`提及 ${member.name}`, `Mention ${member.name}`)}
                    align="end"
                  >
                    <IconButton
                      className="im-member-action im-member-mention"
                      icon={
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.7"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <circle cx="12" cy="12" r="4" />
                          <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
                        </svg>
                      }
                      label={`@ ${member.name}`}
                      disabled={
                        !group.confirmed || member.state === "unavailable"
                      }
                      onClick={() => onMention(member.token)}
                    />
                  </Tooltip>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </EnvironmentSection>
  );
}

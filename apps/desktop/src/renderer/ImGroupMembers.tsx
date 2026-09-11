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

import { ImMemberRemoval } from "./ImMemberRemoval";
import {
  imIdentityKey,
  imGroupMentionTargets,
  type AppLocale,
  type ImGroupContext,
} from "@artemis/protocol";
import { EnvironmentSection } from "@artemis/ui/workflow";
import { Button } from "@artemis/ui/actions";
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
        <strong>{group.name}</strong>
        <small>
          {group.targetDeviceIds
            ? t(
                "本对话的目标成员与电脑",
                "Target members and computers for this conversation",
              )
            : t("已加入此 Artemis 空间的成员", "Members of this Artemis space")}
        </small>
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
          {imGroupMentionTargets(group).map((member) => (
            <div
              key={imIdentityKey(member.identity)}
              className="environment-setting-row"
              role="listitem"
            >
              <span className="environment-setting-copy">
                <strong>{member.name}</strong>
                <small title={member.deviceId}>
                  {imChannelLabel(member.identity.channel, t)} ·{" "}
                  {member.deviceName || member.deviceId}
                </small>
                <small>
                  {group.stale || member.state === "unknown"
                    ? t("状态未知", "Status unknown")
                    : member.state === "unavailable"
                      ? t(
                          "账号或电脑已不可用",
                          "Account or computer unavailable",
                        )
                      : member.state === "online"
                        ? t("电脑在线", "Computer online")
                        : t("电脑离线或暂停", "Computer offline or paused")}
                </small>
                {member.deviceId === group.executingDeviceId && (
                  <small>{t("本任务执行者", "Executes this task")}</small>
                )}
              </span>
              {onRemove && (
                <ImMemberRemoval
                  name={`${member.name} · ${member.deviceName}`}
                  scope="conversation"
                  disabled={removalDisabled}
                  remove={() => onRemove(member.deviceId)}
                  t={t}
                />
              )}
              {onMention && (
                <Button
                  variant="quiet"
                  label={`@ ${member.name}`}
                  disabled={!group.confirmed || member.state === "unavailable"}
                  onClick={() => onMention(member.token)}
                >
                  @
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>
    </EnvironmentSection>
  );
}

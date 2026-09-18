import { uiTranslator } from "../shared/ui-text.js";
import { useEffect, useRef, useState } from "react";
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
  managePermissions = false,
}: {
  group: ImGroupContext;
  locale: AppLocale;
  onMention?: ((token: string) => void) | undefined;
  onRemove?: ((deviceId: string) => Promise<boolean>) | undefined;
  removalDisabled?: boolean | undefined;
  managePermissions?: boolean;
}) {
  const t = uiTranslator(locale);
  type Person = NonNullable<ImGroupContext["roster"]>["members"][number];
  const currentSpace = useRef(group.spaceId);
  currentSpace.current = group.spaceId;
  const [verification, setVerification] = useState<
    Record<string, { until?: number; verifiedAt?: number }>
  >({});
  const [now, setNow] = useState(Date.now);
  const verificationState = (member: Person) => {
    const local = verification[member.identity.userId];
    if (local?.verifiedAt || member.verifiedAt) return "verified";
    return (local?.until ?? member.verificationPendingUntil ?? 0) > now
      ? "verifying"
      : "unverified";
  };
  const verifying = !!group.roster?.members.some(
    (member) => verificationState(member) === "verifying",
  );
  useEffect(() => {
    if (!verifying || group.stale || !group.confirmed) return;
    let cancelled = false;
    let fetching = false;
    const timer = window.setInterval(async () => {
      setNow(Date.now());
      if (fetching) return;
      fetching = true;
      try {
        const result = (await window.artemis.manageIm({
          action: "native-cooperation",
          groupId: group.spaceId,
          operation: "state",
        })) as { peers?: { id: string; verifiedAt?: number }[] };
        if (!cancelled)
          setVerification((previous) => {
            const next = { ...previous };
            for (const peer of result.peers ?? []) {
              if (peer.verifiedAt)
                next[peer.id] = { verifiedAt: peer.verifiedAt };
            }
            return next;
          });
      } catch {
        // The bounded wait still expires if the gateway becomes unavailable.
      } finally {
        fetching = false;
      }
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [verifying, group.spaceId, group.stale, group.confirmed]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setError("");
    setPermissions({});
    setVerification({});
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
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSaving(false);
    }
  };

  const retryVerification = async (member: Person) => {
    if (
      saving ||
      group.stale ||
      !group.confirmed ||
      verificationState(member) === "verifying"
    )
      return;
    const spaceId = group.spaceId;
    const peer = member.identity.userId;
    setError("");
    setNow(Date.now());
    setVerification((previous) => ({
      ...previous,
      [peer]: { until: Date.now() + 30000 },
    }));
    try {
      await window.artemis.manageIm({
        action: "native-cooperation",
        groupId: spaceId,
        operation: "probe",
        peer,
      });
    } catch (cause) {
      if (currentSpace.current !== spaceId) return;
      setVerification((previous) => ({ ...previous, [peer]: { until: 0 } }));
      setError(String(cause));
    }
  };

  if (group.native) {
    const roster = group.roster;
    const channel = group.members[0]?.identity.channel;
    const targets = imGroupMentionTargets(group);
    return (
      <EnvironmentSection
        title={`${t("ImGroupMembers.message28")}${roster?.complete ? ` · ${roster.members.length}` : ""}`}
      >
        <div className="environment-setting-copy im-group-members im-native-members">
          {error && <small role="alert">{error}</small>}
          {(!roster?.complete || group.stale) && (
            <small role="status">
              {roster?.error === "missing-scope"
                ? channel === "feishu"
                  ? t("ImGroupMembers.message5")
                  : t("ImGroupMembers.message4")
                : channel === "wecom"
                  ? t("ImGroupMembers.message3")
                  : channel === "feishu" && roster?.error === "partial"
                    ? t("ImGroupMembers.message2")
                    : t("ImGroupMembers.message1")}
            </small>
          )}
          <div
            className="environment-activity-list"
            role="list"
            aria-label={t("ImGroupMembers.message27")}
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
                  ? t("EnvironmentPanel_labels.active")
                  : state === "away"
                    ? t("ImGroupMembers.message10")
                    : state === "online"
                      ? t("ImGroupMembers.message9")
                      : state === "offline"
                        ? t("ImGroupMembers.message8")
                        : state === "unavailable"
                          ? t("ImGroupMembers.message7")
                          : t("ImGroupMembers.message6");
              const kind =
                member.kind === "bot"
                  ? t("ImGroupMembers.message14")
                  : member.kind === "human"
                    ? t("ImGroupMembers.message13")
                    : t("ImGroupMembers.message12");
              const editable =
                !member.owner && !member.self && member.kind !== "unknown";
              return (
                <div
                  className="environment-setting-row"
                  role="listitem"
                  key={imIdentityKey(member.identity)}
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
                      {member.kind === "bot" && !member.self && (
                        <span className="im-member-device" aria-live="polite">
                          {verificationState(member) === "verified"
                            ? t("ImGroupMembers.message17")
                            : verificationState(member) === "verifying"
                              ? t("ImGroupMembers.message16")
                              : t("ImGroupMembers.message15")}
                        </span>
                      )}

                      {member.self && (
                        <span className="im-member-executor">
                          {t("ImGroupMembers.message18")}
                        </span>
                      )}
                    </strong>
                  </span>
                  {managePermissions &&
                    editable &&
                    member.kind === "bot" &&
                    verificationState(member) !== "verified" && (
                      <Tooltip
                        label={
                          verificationState(member) === "verifying"
                            ? t("ImGroupMembers.message22")
                            : t("ImGroupMembers.message19")
                        }
                        align="end"
                      >
                        <button
                          type="button"
                          className="im-member-permission-toggle"
                          aria-label={
                            verificationState(member) === "verifying"
                              ? t("ImGroupMembers.message16")
                              : t("ImGroupMembers.message19")
                          }
                          disabled={
                            saving ||
                            group.stale ||
                            !group.confirmed ||
                            verificationState(member) === "verifying"
                          }
                          onClick={() => retryVerification(member)}
                        >
                          <ArtemisIcon name="refresh" width={12} height={12} />
                        </button>
                      </Tooltip>
                    )}
                  {managePermissions && editable && (
                    <Tooltip
                      label={
                        canAssign(member)
                          ? t("ImGroupMembers.message26")
                          : t("ImGroupMembers.message25")
                      }
                    >
                      <button
                        type="button"
                        className="im-member-permission-toggle"
                        data-allowed={canAssign(member)}
                        aria-label={
                          canAssign(member)
                            ? t("ImGroupMembers.message24", {
                                value1: member.name,
                              })
                            : t("ImGroupMembers.message23", {
                                value1: member.name,
                              })
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
    <EnvironmentSection title={t("ImGroupMembers.message39")}>
      <div className="environment-setting-copy im-group-members">
        {group.stale && (
          <small role="status">{t("ImGroupMembers.message29")}</small>
        )}
        {!group.confirmed && <small>{t("ImGroupMembers.message30")}</small>}
        {!imGroupMentionTargets(group).length && (
          <small>{t("ImGroupMembers.message31")}</small>
        )}
        <div
          className="environment-activity-list"
          role="list"
          aria-label={t("ImGroupMembers.message27")}
        >
          {imGroupMentionTargets(group).map((member) => {
            const state =
              group.stale || !group.confirmed ? "unknown" : member.state;
            const status =
              state === "unknown"
                ? t("ImGroupMembers.message6")
                : state === "unavailable"
                  ? t("ImGroupMembers.message34")
                  : state === "online"
                    ? t("ImGroupMembers.message33")
                    : t("ImGroupMembers.message32");
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
                        {t("ImGroupMembers.message18")}
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
                    label={t("ImGroupMembers.message37", {
                      value1: member.name,
                    })}
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

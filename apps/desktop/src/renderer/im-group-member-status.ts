import {
  imIdentityKey,
  type ImGroupContext,
  type ImGroupRoster,
  type ImStatus,
  type AppLocale,
} from "@artemis/protocol";
import { uiText, type UiMessageKey } from "../shared/ui-text.js";

type Member = ImGroupRoster["members"][number];
export type MemberState =
  | "online"
  | "busy"
  | "waiting-approval"
  | "offline"
  | "active"
  | "away"
  | "unknown";
export function imMemberState(
  member: Member,
  group: Pick<ImGroupContext, "stale" | "confirmed"> | undefined,
  now: number,
): MemberState {
  if (group && (group.stale || !group.confirmed)) return "unknown";
  if (member.kind === "bot") {
    const evidence = member.botPresence;
    return evidence && evidence.checkedAt <= now && evidence.expiresAt > now
      ? evidence.state
      : "unknown";
  }
  if (member.presenceError) return "unknown";
  const age = now - (member.presenceCheckedAt ?? 0);
  return member.presenceCheckedAt !== undefined && age >= 0 && age < 60000
    ? (member.presence ?? "unknown")
    : "unknown";
}
export function imMemberLabel(state: MemberState, locale: AppLocale): string {
  const labels: Record<MemberState, UiMessageKey> = {
    online: "ImPresence.available",
    busy: "ImPresence.executing",
    "waiting-approval": "ImPresence.waiting",
    offline: "ImPresence.disconnected",
    active: "EnvironmentPanel_labels.active",
    away: "ImGroupMembers.message10",
    unknown: "ImGroupMembers.message6",
  };
  return uiText(locale, labels[state]);
}
export function imMemberTooltip(
  member: Member,
  state: MemberState,
  locale: AppLocale,
): string {
  const time =
    member.kind === "bot"
      ? member.botPresence?.checkedAt
      : member.presenceCheckedAt;
  const source =
    member.kind === "bot"
      ? member.botPresence?.source === "local"
        ? "ImPresence.local"
        : member.botPresence?.source === "task"
          ? "ImPresence.task"
          : "ImPresence.peer"
      : "ImPresence.platform";
  const reason =
    member.presenceError === "missing-scope"
      ? "ImGroupMembers.message4"
      : member.presenceError === "rate-limited"
        ? "ImPresence.limited"
        : "ImPresence.unknown";
  return [
    imMemberLabel(state, locale),
    uiText(locale, source),
    time
      ? uiText(locale, "ImPresence.updated", {
          time: new Date(time).toLocaleTimeString(locale),
        })
      : undefined,
    state === "unknown" ? uiText(locale, reason) : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}
export function imGroupMemberStatus(
  member: Member,
  status: ImStatus,
  spaceId: string | undefined,
  now: number,
): MemberState {
  if (!status.settings.enabled || status.state !== "connected")
    return "unknown";
  const tasks = spaceId
    ? (status.remoteTasks ?? []).filter(
        (task) =>
          task.group?.spaceId === spaceId && task.currentGroupEntry !== false,
      )
    : [];
  const group = tasks.find((task) => !task.parentThreadId)?.group;
  if (group && (group.stale || !group.confirmed)) return "unknown";
  // Compatibility for older desktop snapshots, restricted to the local bot.
  if (
    member.kind === "bot" &&
    member.self &&
    !member.botPresence &&
    group &&
    !group.native
  ) {
    const device = group.members.find(
      (candidate) => candidate.deviceId === group.executingDeviceId,
    );
    if (device?.state === "offline") return "offline";
    if (device?.state === "online")
      return tasks.some((task) => task.running === true) ? "busy" : "online";
  }
  const current = group?.roster?.members.find(
    (person) =>
      imIdentityKey(person.identity) === imIdentityKey(member.identity),
  );
  return imMemberState(current ?? member, group, now);
}

import {
  imIdentityKey,
  type ImGroupRoster,
  type ImStatus,
} from "@artemis/protocol";

export function imGroupMemberStatus(
  member: ImGroupRoster["members"][number],
  status: ImStatus,
  spaceId: string | undefined,
  now: number,
): "online" | "busy" | "offline" | "unknown" {
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
  // Desktop liveness describes bots executing work, never a person's IM presence.
  if (member.kind === "bot" && group) {
    const device = group.members.find((candidate) =>
      member.self
        ? candidate.deviceId === group.executingDeviceId
        : imIdentityKey(candidate.identity) === imIdentityKey(member.identity),
    );
    if (device?.state === "offline") return "offline";
    if (device?.state === "online") {
      return member.self && tasks.some((task) => task.running === true)
        ? "busy"
        : "online";
    }
  }
  const age = now - (member.presenceCheckedAt ?? 0);
  if (
    member.presenceCheckedAt !== undefined &&
    age >= 0 &&
    age < 120000 &&
    member.presence === "active"
  )
    return "online";
  // Away is not evidence of either busy or offline; expired/missing data is unknown.
  return "unknown";
}

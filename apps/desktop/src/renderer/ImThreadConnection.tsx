import { uiText } from "../shared/ui-text.js";
import { useEffect, useState } from "react";
import type {
  AppLocale,
  ImConnectionStatus,
  ImGroupContext,
  ImStatus,
} from "@artemis/protocol";
import { ArtemisIcon } from "@artemis/ui/icons";
import { imGroupMentionTargets } from "@artemis/protocol";

type ThreadConnection = {
  permissionBlock?: string;
  delegationWaits?: NonNullable<
    ImStatus["remoteTasks"]
  >[number]["delegationWaits"];
  parentThreadId?: string;
  channel?: string;
  connectionState: ImConnectionStatus["state"] | "unknown";
  group?: ImGroupContext;
};
const unknownConnection: ThreadConnection = { connectionState: "unknown" };

export function useImThreadStatus() {
  const [statuses, setStatuses] = useState<Record<string, ThreadConnection>>(
    {},
  );
  useEffect(() => {
    let mounted = true;
    let pending = false;
    const refresh = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const status = await window.artemis.getImStatus();
        if (mounted) {
          const next = Object.fromEntries(
            (status.remoteTasks ?? []).map((task) => [
              task.threadId,
              {
                channel: task.channel,
                delegationWaits: task.delegationWaits,
                ...(task.permissionBlock
                  ? { permissionBlock: task.permissionBlock }
                  : {}),
                ...(task.parentThreadId
                  ? { parentThreadId: task.parentThreadId }
                  : {}),
                connectionState: task.connectionState ?? "unknown",
                ...(task.kind === "group" && task.group
                  ? { group: task.group }
                  : {}),
              },
            ]),
          );
          setStatuses((current) =>
            Object.keys(current).length === Object.keys(next).length &&
            Object.entries(next).every(
              ([id, value]) =>
                current[id]?.parentThreadId === value.parentThreadId &&
                current[id]?.channel === value.channel &&
                current[id]?.permissionBlock === value.permissionBlock &&
                JSON.stringify(current[id]?.delegationWaits) ===
                  JSON.stringify(value.delegationWaits) &&
                current[id]?.connectionState === value.connectionState &&
                JSON.stringify(current[id]?.group) ===
                  JSON.stringify(value.group),
            )
              ? current
              : next,
          );
        }
      } catch {
        // Keep known IM identities during a temporary status lookup failure.
        if (mounted)
          setStatuses((current) =>
            Object.fromEntries(
              Object.entries(current).map(([id, value]) => [
                id,
                {
                  ...value,
                  ...unknownConnection,
                  ...(value.group
                    ? { group: { ...value.group, stale: true } }
                    : {}),
                },
              ]),
            ),
          );
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    const unsubscribe = window.artemis.onImTaskCreated?.((thread) => {
      setStatuses((current) => ({
        ...current,
        [thread.id]: unknownConnection,
      }));
      void refresh();
    });
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      mounted = false;
      window.clearInterval(timer);
      unsubscribe?.();
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return statuses;
}

export function ImThreadConnection({
  status,
  locale,
}: {
  status: ThreadConnection;
  locale: AppLocale;
}) {
  const channel =
    status.channel === "slack"
      ? "Slack"
      : status.channel === "feishu" || status.channel === "lark"
        ? uiText(locale, "ImNavigation.message1")
        : status.channel === "wecom"
          ? uiText(locale, "ImNavigation.message2")
          : "IM";
  const state =
    status.group?.native && !status.group.confirmed
      ? "disabled"
      : status.connectionState;
  const label = {
    connected: uiText(locale, "ImNavigation.message12"),
    connecting: uiText(locale, "ImNavigation.message11"),
    error: uiText(locale, "ImThreadConnection.inline1"),
    disabled: uiText(
      locale,
      "CustomAgentsSettingsSection_labels.disabledBadge",
    ),
    unknown: uiText(locale, "ImGroupMembers.message6"),
  }[state];
  const summary = `${channel} · ${uiText(locale, "ImThreadConnection.inline2")}：${label}`;
  const group = status.group;
  const members = group ? imGroupMentionTargets(group) : [];
  const computerState =
    !group || group.stale || !group.confirmed
      ? "unknown"
      : members.some((member) => member.state === "online")
        ? "online"
        : members.length > 0 &&
            (!group.targetDeviceIds ||
              group.targetDeviceIds.every((id) =>
                members.some((member) => member.deviceId === id),
              )) &&
            members.every((member) => member.state === "offline")
          ? "offline"
          : "unknown";
  const computerLabel =
    computerState === "online"
      ? uiText(locale, "ImThreadConnection.inline5")
      : computerState === "offline"
        ? uiText(locale, "ImThreadConnection.inline4")
        : uiText(locale, "ImThreadConnection.inline3");
  return (
    <span className="im-thread-indicators">
      {group && (
        <span
          className="im-thread-group"
          role="img"
          aria-label={uiText(locale, "ImThreadConnection.inline6")}
          title={uiText(locale, "ImThreadConnection.inline6")}
        >
          <ArtemisIcon name="agents" width={16} height={16} />
        </span>
      )}
      <span
        aria-label={summary}
        className="im-thread-connection"
        data-state={state}
        role="img"
        title={summary}
      >
        <ArtemisIcon
          name={
            state === "error"
              ? "alert"
              : state === "connecting"
                ? "clock"
                : state === "disabled"
                  ? "unlink"
                  : state === "unknown"
                    ? "info"
                    : "message"
          }
          width={14}
          height={14}
        />
      </span>
      {group && !group.native && (
        <span
          className="im-thread-computers"
          data-state={computerState}
          role="img"
          aria-label={computerLabel}
          title={computerLabel}
        >
          <ArtemisIcon name="monitor" width={14} height={14} />
        </span>
      )}
    </span>
  );
}

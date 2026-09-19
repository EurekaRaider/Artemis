import { uiText } from "../shared/ui-text.js";
import { useEffect, useState } from "react";
import type {
  AppLocale,
  ImConnectionStatus,
  ImGroupContext,
  ImStatus,
} from "@artemis/protocol";
import { imGroupMentionTargets } from "@artemis/protocol";
import { ArtemisIcon } from "@artemis/ui/icons";

type ThreadConnection = {
  permissionBlock?: string;
  delegationWaits?: NonNullable<
    ImStatus["remoteTasks"]
  >[number]["delegationWaits"];
  parentThreadId?: string;
  channel?: string;
  connectionState: ImConnectionStatus["state"] | "unknown" | "removed";
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
    removed: uiText(locale, "ImThreadConnection.removedBadge"),
    unknown: uiText(locale, "ImGroupMembers.message6"),
  }[state];
  const summary = `${channel} · ${uiText(locale, "ImThreadConnection.inline2")}：${label}`;
  const group = status.group;
  return (
    <span className="im-thread-indicators">
      {/* 图标始终表达会话类型（单聊/群聊）；连接状态只通过颜色与悬浮文案区分。 */}
      <span
        aria-label={summary}
        className="im-thread-connection"
        data-state={state}
        role="img"
        title={summary}
      >
        <ArtemisIcon
          name={group ? "agents" : "message"}
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

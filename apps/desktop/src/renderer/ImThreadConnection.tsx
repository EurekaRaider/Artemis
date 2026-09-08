import { useEffect, useState } from "react";
import type {
  AppLocale,
  ImConnectionStatus,
  ImGroupContext,
} from "@artemis/protocol";
import { ArtemisIcon } from "@artemis/ui/icons";
import { imGroupMentionTargets } from "@artemis/protocol";

type ThreadConnection = {
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
                current[id]?.channel === value.channel &&
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
  const zh = locale.startsWith("zh");
  const channel =
    status.channel === "slack"
      ? "Slack"
      : status.channel === "feishu" || status.channel === "lark"
        ? zh
          ? "飞书 / Lark"
          : "Feishu / Lark"
        : status.channel === "wecom"
          ? zh
            ? "企业微信"
            : "WeCom"
          : "IM";
  const state = status.connectionState;
  const label = {
    connected: zh ? "已连接" : "Connected",
    connecting: zh ? "连接中" : "Connecting",
    error: zh ? "连接异常" : "Connection error",
    disabled: zh ? "已停用" : "Disabled",
    unknown: zh ? "状态未知" : "Status unknown",
  }[state];
  const summary = `${channel} · ${zh ? "IM 连接" : "IM connection"}：${label}`;
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
      ? zh
        ? "群协作电脑：有成员在线"
        : "Group computers: members online"
      : computerState === "offline"
        ? zh
          ? "群协作电脑：所有成员离线"
          : "Group computers: all members offline"
        : zh
          ? "群协作电脑：状态未知"
          : "Group computers: status unknown";
  return (
    <span className="im-thread-indicators">
      {group && (
        <span
          className="im-thread-group"
          role="img"
          aria-label={zh ? "群协作对话" : "Group collaboration conversation"}
          title={zh ? "群协作对话" : "Group collaboration conversation"}
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
      {group && (
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

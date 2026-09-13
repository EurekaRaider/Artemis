import type { AppLocale, Thread } from "@artemis/protocol";
import { taskNotificationCopy } from "../shared/task-notification-copy.js";

export function ThreadStatusIndicator({
  thread,
  locale,
}: {
  thread: Thread;
  locale: AppLocale;
}) {
  const unread = thread.notification?.unread === true;
  const copy = taskNotificationCopy(locale);
  const label = unread
    ? `${thread.notification?.kind ? copy.titles[thread.notification.kind] : ""} · ${copy.unread}`
    : undefined;
  return (
    <span
      className="thread-status-indicator"
      title={label}
      aria-label={label}
      role={unread ? "img" : undefined}
    >
      {thread.status !== "idle" && (
        <span aria-hidden="true" className={`status-dot ${thread.status}`} />
      )}
      {unread && thread.status !== "failed" && (
        <span aria-hidden="true" className="thread-unread-dot" />
      )}
    </span>
  );
}

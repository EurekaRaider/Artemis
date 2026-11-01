import { RunningArc, ArtemisIcon } from "@artemis/ui/icons";
import { uiText } from "../../shared/i18n/ui-text.js";
import type {
  AgentEvent,
  AppLocale,
  Thread,
  ThreadViewState,
} from "@artemis/protocol";
import { statusText } from "../../shared/i18n/status-text.js";

export function ThreadStatusIndicator({
  thread,
  locale,
  events = [],
  historyState,
}: {
  thread: Thread;
  locale: AppLocale;
  events?: readonly AgentEvent[] | undefined;
  historyState?: ThreadViewState | undefined;
}) {
  let status: string | undefined;
  if (thread.status === "running") {
    status = historyState?.activity?.phase === "queued" ? "queued" : "running";
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]!;
      if (historyState && event.seq <= historyState.lastSeq) break;
      if (event.payload.type === "turn.activity") {
        status = event.payload.phase === "queued" ? "queued" : "running";
        break;
      }
      if (
        ["turn.started", "turn.completed", "turn.failed"].includes(
          event.payload.type,
        )
      ) {
        status = "running";
        break;
      }
    }
  } else if (thread.status === "waiting-approval") {
    status =
      thread.notification?.kind === "input-required"
        ? "waiting-user-input"
        : "waiting-approval";
  } else if (thread.status === "failed") {
    status = "failed";
  } else if (
    thread.notification?.unread &&
    thread.notification.kind === "completed"
  ) {
    status = "completed";
  }
  const label = status ? statusText(locale, status) : undefined;
  return (
    <span
      className="thread-status-indicator"
      title={label}
      aria-label={label}
      role={status ? "img" : undefined}
    >
      {!status && !thread.projectId && (
        <ArtemisIcon name="chat" width={16} height={16} aria-hidden="true" />
      )}
      {status && (
        <span aria-hidden="true" className={`status-dot ${status}`}>
          {status === "running" ? (
            <RunningArc />
          ) : status === "queued" ? (
            <ArtemisIcon name="clock" />
          ) : status === "failed" ? (
            <ArtemisIcon name="alert" />
          ) : null}
        </span>
      )}
    </span>
  );
}

export function ThreadWaitingBadge({
  thread,
  locale,
}: {
  thread: Thread;
  locale: AppLocale;
}) {
  if (thread.status !== "waiting-approval") return null;
  const label = uiText(locale, "Review02.waitingDecision");
  return (
    <span className="thread-waiting-badge" title={label}>
      {label}
    </span>
  );
}

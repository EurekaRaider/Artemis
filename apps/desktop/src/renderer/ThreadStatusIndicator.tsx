import { uiText } from "../shared/ui-text.js";
import type {
  AgentEvent,
  AppLocale,
  Thread,
  ThreadViewState,
} from "@artemis/protocol";
import { statusText } from "../shared/status-text.js";

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
  } else if (thread.notification?.unread) {
    if (thread.status === "failed") status = "failed";
    else if (thread.notification.kind === "completed") status = "completed";
  }
  const label = status ? statusText(locale, status) : undefined;
  return (
    <span
      className="thread-status-indicator"
      title={label}
      aria-label={label}
      role={status ? "img" : undefined}
    >
      {status && <span aria-hidden="true" className={`status-dot ${status}`} />}
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
  const label =
    thread.notification?.kind === "input-required"
      ? uiText(locale, "App_copy.waitingSelection")
      : statusText(locale, "waiting-approval");
  return (
    <span className="thread-waiting-badge" title={label}>
      {label}
    </span>
  );
}

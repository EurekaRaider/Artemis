import { streamRevision } from "./stream-snapshot.js";
import {
  createThreadViewState,
  reduceAgentEventBatch,
} from "@artemis/protocol";
import { threadPresentationStatus } from "./thread-presentation.js";
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
  events,
  historyState,
}: {
  thread: Thread;
  locale: AppLocale;
  events?: readonly AgentEvent[] | undefined;
  historyState?: ThreadViewState | undefined;
}) {
  const presentation = sidebarPresentation(thread, events, historyState);
  const status =
    presentation === "idle" ||
    (presentation === "completed" && !thread.notification?.unread)
      ? undefined
      : presentation;
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
  events,
  historyState,
}: {
  thread: Thread;
  locale: AppLocale;
  events?: readonly AgentEvent[] | undefined;
  historyState?: ThreadViewState | undefined;
}) {
  const status = sidebarPresentation(thread, events, historyState);
  if (status !== "waiting-approval" && status !== "waiting-user-input")
    return null;
  const label = uiText(locale, "Review02.waitingDecision");
  return (
    <span className="thread-waiting-badge" title={label}>
      {label}
    </span>
  );
}

const NO_EVENTS: readonly AgentEvent[] = [];
const presentations = new WeakMap<
  Thread,
  {
    revision: symbol;
    history: ThreadViewState | undefined;
    status: ReturnType<typeof threadPresentationStatus>;
  }
>();
function sidebarPresentation(
  thread: Thread,
  events = NO_EVENTS,
  historyState?: ThreadViewState,
) {
  const revision = streamRevision(events);
  const previous = presentations.get(thread);
  if (previous && previous.history === historyState) {
    if (previous.revision === revision.id) return previous.status;
    // Text clears queued activity. Once running, more text cannot change the badge.
    if (
      previous.status === "running" &&
      previous.revision === revision.textParent
    ) {
      presentations.set(thread, { ...previous, revision: revision.id });
      return previous.status;
    }
  }
  const state = historyState
    ? reduceAgentEventBatch(
        historyState,
        events.filter((event) => event.seq > historyState.lastSeq),
      )
    : events.length
      ? reduceAgentEventBatch(
          {
            ...createThreadViewState(thread.id, thread.mode),
            status: thread.status,
          },
          [...events],
        )
      : undefined;
  const status = threadPresentationStatus(thread, state);
  presentations.set(thread, {
    revision: revision.id,
    history: historyState,
    status,
  });
  return status;
}

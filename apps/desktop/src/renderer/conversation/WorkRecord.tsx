import { useEffect, useState, type ReactNode } from "react";
import type {
  AppLocale,
  ChildAgentState,
  TurnViewState,
} from "@artemis/protocol";
import { ArtemisIcon, RunningArc } from "@artemis/ui/icons";
import { TurnExecutionDisclosure } from "@artemis/ui/conversation";
import { uiText } from "../../shared/i18n/ui-text.js";
import { UI_COPY } from "../../shared/i18n/ui-copy.js";
import { formatWorkedDuration } from "./turn-timeline.js";
import type { groupTimelineActivities } from "./tool-activity-groups.js";

/** Presentation only: entry order and lazy history ownership stay with Timeline. */
export function WorkRecord({
  turn,
  locale,
  entries,
  childAgents,
  children,
}: {
  turn: TurnViewState;
  locale: AppLocale;
  entries: ReturnType<typeof groupTimelineActivities>;
  childAgents: Record<string, ChildAgentState>;
  children: ReactNode | (() => ReactNode);
}) {
  const running = turn.status === "running";
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  const duration =
    running && turn.startedAt
      ? Math.max(0, now - Date.parse(turn.startedAt))
      : turn.durationMs;
  const steps = entries.filter(
    (entry) =>
      entry.kind === "tool-group" ||
      (entry.kind === "entry" &&
        entry.entry.startsWith("child:") &&
        (!childAgents[entry.entry.slice(6)]?.parentAgentId ||
          childAgents[entry.entry.slice(6)]?.parentAgentId === "parent")),
  ).length;
  const label = running
    ? uiText(locale, "WorkRecord.working")
    : turn.status === "cancelled"
      ? UI_COPY.App_copy_9734[locale].cancelled
      : UI_COPY.App_copy[locale].workedFor;
  const time = formatWorkedDuration(duration);
  return (
    <TurnExecutionDisclosure
      key={`${turn.id}:${turn.status}`}
      className={`turn-execution-details work-record ${turn.status}`}
      open={running || turn.status === "failed"}
      label={`${label} ${time}`}
      summary={
        <>
          {running ? (
            <RunningArc size={16} />
          ) : (
            <ArtemisIcon
              width={16}
              height={16}
              name={
                turn.status === "failed"
                  ? "alert"
                  : turn.status === "cancelled"
                    ? "stop"
                    : "check"
              }
            />
          )}
          <span>
            {label} {time}
          </span>
          <small>
            · {uiText(locale, "WorkRecord.steps", { count: steps })}
            {turn.status === "completed" && turn.changeSet?.files.length
              ? ` · ${uiText(locale, "WorkRecord.files", { count: turn.changeSet.files.length })}`
              : ""}
          </small>
          <ArtemisIcon
            className="work-record-chevron"
            width={14}
            height={14}
            name="chev-right"
          />
        </>
      }
    >
      {() => (
        <div className="turn-execution-entries">
          {typeof children === "function" ? children() : children}
        </div>
      )}
    </TurnExecutionDisclosure>
  );
}

export function AgentElapsed({ child }: { child: ChildAgentState }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (child.status !== "running") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [child.status]);
  if (!child.startedAt) return null;
  const seconds = Math.max(
    0,
    Math.floor(
      ((child.status === "running"
        ? now
        : Date.parse(
            child.updatedAt ?? child.lastActivityAt ?? child.startedAt,
          )) -
        Date.parse(child.startedAt)) /
        1000,
    ),
  );
  return (
    <span>
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
    </span>
  );
}

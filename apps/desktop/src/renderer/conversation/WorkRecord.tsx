import { useEffect, useState, type ReactNode } from "react";
import type {
  AppLocale,
  ChildAgentState,
  TurnViewState,
  AgentEvent,
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
  changedFileCount = turn.changeSet?.files.length ?? 0,
  locale,
  entries,
  childAgents,
  children,
}: {
  turn: TurnViewState;
  changedFileCount?: number;
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
  const time = formatWorkedDuration(duration, locale);
  const summary = (
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
      <span>{label}</span>
      <small>
        {time}
        {steps > 0
          ? ` · ${uiText(locale, "WorkRecord.steps", { count: steps })}`
          : ""}
        {changedFileCount > 0
          ? ` · ${uiText(locale, "WorkRecord.files", { count: changedFileCount })}`
          : ""}
      </small>
      {steps > 0 && (
        <ArtemisIcon
          className="work-record-chevron"
          width={14}
          height={14}
          name="chev-right"
        />
      )}
    </>
  );
  if (steps === 0)
    return (
      <div className={`work-record ${turn.status}`}>
        <div className="work-record-summary" aria-label={`${label} ${time}`}>
          {summary}
        </div>
        {typeof children === "function" ? children() : children}
      </div>
    );
  return (
    <TurnExecutionDisclosure
      key={`${turn.id}:${turn.status}`}
      className={`turn-execution-details work-record ${turn.status}`}
      open={running || turn.status === "failed"}
      label={`${label} ${time}`}
      summary={summary}
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

export function turnChangedFileCount(
  events: readonly AgentEvent[],
  turn: TurnViewState,
): number {
  if (turn.changeSet) return turn.changeSet.files.length;
  return new Set(
    events.flatMap((event) =>
      event.turnId === turn.id && event.payload.type === "file.changed"
        ? [event.payload.path]
        : [],
    ),
  ).size;
}
export function turnUsageLabel(
  events: readonly AgentEvent[],
  turnId: string,
  locale: AppLocale,
): string {
  const usages = events.flatMap((event) =>
    event.turnId === turnId && event.payload.type === "assistant.usage"
      ? [event.payload]
      : [],
  );
  if (!usages.length) return "";
  const total = usages.reduce((sum, usage) => sum + usage.totalTokens, 0);
  const read = usages.reduce((sum, usage) => sum + usage.cacheReadTokens, 0);
  const input = usages.reduce(
    (sum, usage) =>
      sum + usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens,
    0,
  );
  return [
    usages.at(-1)?.modelId,
    `${new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(total)} tokens`,
    input > 0 && usages.some((usage) => usage.cacheReadReported)
      ? uiText(locale, "Review01.cacheHit", {
          percent: Math.round((read / input) * 100),
        })
      : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

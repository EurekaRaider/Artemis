import { uiText } from "../../shared/i18n/ui-text.js";
import { GOAL_RESOURCES } from "../../shared/i18n/goal-resources.js";
import { useEffect, useState } from "react";
import { Tooltip } from "@artemis/ui/feedback";
import type { AppLocale, ThreadGoal } from "@artemis/protocol";
import { Button, IconButton } from "@artemis/ui/actions";
import { ArtemisIcon } from "@artemis/ui/icons";

const GOAL_OBJECTIVE_PREVIEW_MARKER = "\n\nObjective preview:\n";

export function displayGoalObjective(objective: string): string {
  const previewIndex = objective.indexOf(GOAL_OBJECTIVE_PREVIEW_MARKER);
  return previewIndex < 0
    ? objective
    : objective.slice(previewIndex + GOAL_OBJECTIVE_PREVIEW_MARKER.length);
}

export function formatGoalProgress(
  goal: ThreadGoal,
  locale: AppLocale,
  clockMs: number,
): string {
  if (
    goal.tokenBudget !== undefined &&
    (goal.status === "active" || goal.status === "budgetLimited")
  ) {
    const formatter = new Intl.NumberFormat(locale, {
      maximumFractionDigits: 1,
      notation: "compact",
    });
    return `${formatter.format(goal.tokensUsed)} / ${formatter.format(goal.tokenBudget)}`;
  }
  const updatedAt = Date.parse(goal.updatedAt);
  const liveSeconds =
    goal.status === "active" && Number.isFinite(updatedAt)
      ? Math.max(0, (clockMs - updatedAt) / 1_000)
      : 0;
  const total = Math.max(0, Math.floor(goal.timeUsedSeconds + liveSeconds));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  const unit = (value: number, name: "hour" | "minute" | "second") =>
    new Intl.NumberFormat(locale, {
      style: "unit",
      unit: name,
      unitDisplay: "narrow",
    }).format(value);
  if (hours > 0)
    return `${unit(hours, "hour")} ${unit(minutes, "minute")} ${unit(seconds, "second")}`;
  if (minutes > 0)
    return `${unit(minutes, "minute")} ${unit(seconds, "second")}`;
  return unit(seconds, "second");
}

export function GoalBar({
  clockMs,
  disabled,
  goal,
  locale,
  onClear,
  onEdit,
  onPause,
  onResume,
}: {
  clockMs: number;
  disabled?: boolean;
  goal: ThreadGoal;
  locale: AppLocale;
  onClear(): void;
  onEdit(): void;
  onPause(): void;
  onResume(): void;
}) {
  const copy = GOAL_RESOURCES[locale];
  const objective = displayGoalObjective(goal.objective);
  const resumable = ["paused", "blocked", "usageLimited"].includes(goal.status);
  const progress = formatGoalProgress(goal, locale, clockMs);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [fullObjective, setFullObjective] = useState<string>();
  const [loadFailed, setLoadFailed] = useState(false);
  const managed = goal.objective.includes(GOAL_OBJECTIVE_PREVIEW_MARKER);
  useEffect(() => {
    setFullObjective(undefined);
    setLoadFailed(false);
    if (!previewOpen || !managed) return;
    let cancelled = false;
    void window.artemis.getThreadGoalObjective(goal.threadId).then(
      (result) => {
        if (cancelled) return;
        if (result.goalId === goal.goalId) setFullObjective(result.objective);
        else setLoadFailed(true);
      },
      () => {
        if (!cancelled) setLoadFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [previewOpen, managed, goal.threadId, goal.goalId, goal.objective]);
  const preview = !managed
    ? objective
    : (fullObjective ??
      (loadFailed ? copy.previewFailed : copy.previewLoading));
  const status =
    goal.status === "active"
      ? copy.running
      : goal.status === "paused"
        ? copy.statusPaused
        : copy[goal.status];
  return (
    <section
      aria-busy={disabled || undefined}
      aria-label={copy[goal.status]}
      className="goal-bar"
      data-goal-state={goal.status}
      onMouseEnter={() => setPreviewOpen(true)}
      onMouseLeave={() => setPreviewOpen(false)}
      onFocus={() => setPreviewOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setPreviewOpen(false);
      }}
    >
      <Tooltip
        label={preview || copy[goal.status]}
        align="end"
        className="goal-objective-tooltip"
      >
        <Button
          align="start"
          className="goal-bar-main"
          disabled={disabled}
          title={`${copy.edit}: ${objective}`}
          onClick={onEdit}
          variant="quiet"
        >
          <ArtemisIcon className="goal-bar-icon" name="target" />
          <span className="goal-bar-objective">{objective}</span>
          {goal.status === "active" &&
          goal.tokenBudget !== undefined &&
          goal.tokenBudget > 0 ? (
            <span className="goal-bar-budget">
              <progress
                max={goal.tokenBudget}
                value={Math.min(goal.tokensUsed, goal.tokenBudget)}
              />
              {Math.min(
                100,
                Math.round((goal.tokensUsed / goal.tokenBudget) * 100),
              )}
              %
            </span>
          ) : null}
          {goal.status === "complete" ? (
            <ArtemisIcon name="check-circle" className="goal-bar-complete" />
          ) : (
            <span className="goal-bar-status">{status}</span>
          )}
          {goal.status === "active" && goal.tokenBudget === undefined && (
            <span className="goal-bar-progress">{progress}</span>
          )}
        </Button>
      </Tooltip>
      <div className="goal-bar-actions">
        {goal.status === "active" && (
          <IconButton
            disabled={disabled}
            icon={<ArtemisIcon name="pause" />}
            iconSize="sm"
            label={copy.pause}
            onClick={onPause}
            title={copy.pause}
          />
        )}
        {resumable && (
          <IconButton
            disabled={disabled}
            icon={<ArtemisIcon name="play" />}
            iconSize="sm"
            label={copy.resume}
            onClick={onResume}
            title={copy.resume}
          />
        )}
        {goal.status === "budgetLimited" && (
          <Button disabled={disabled} onClick={onEdit} variant="quiet">
            {uiText(locale, "Review02.addBudget")}
          </Button>
        )}
        <IconButton
          className="goal-bar-secondary"
          disabled={disabled}
          icon={<ArtemisIcon name="edit" />}
          iconSize="sm"
          label={copy.edit}
          onClick={onEdit}
          title={copy.edit}
        />
        <IconButton
          disabled={disabled}
          className={
            goal.status === "complete" ? undefined : "goal-bar-secondary"
          }
          icon={
            <ArtemisIcon
              name={goal.status === "complete" ? "close" : "trash"}
            />
          }
          iconSize="sm"
          label={copy.clear}
          onClick={onClear}
          title={copy.clear}
        />
      </div>
    </section>
  );
}

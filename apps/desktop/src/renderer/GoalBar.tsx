import {
  PauseCircleIcon,
  PencilSimpleLineIcon,
  PlayCircleIcon,
  TargetIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import type { AppLocale, ThreadGoal } from "@artemis/protocol";

const LABELS = {
  en: {
    active: "Pursuing goal",
    paused: "Paused goal",
    blocked: "Goal stalled",
    usageLimited: "Goal usage limited",
    budgetLimited: "Goal limited",
    complete: "Goal achieved",
    pause: "Pause goal",
    resume: "Resume goal",
    edit: "Edit goal",
    clear: "Clear goal",
  },
  "zh-CN": {
    active: "进行中的目标",
    paused: "已暂停的目标",
    blocked: "目标已停滞",
    usageLimited: "目标使用受限",
    budgetLimited: "目标受限",
    complete: "已达成目标",
    pause: "暂停目标",
    resume: "继续目标",
    edit: "编辑目标",
    clear: "清除目标",
  },
} as const;

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
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
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
  const copy = locale.startsWith("zh") ? LABELS["zh-CN"] : LABELS.en;
  const objective = displayGoalObjective(goal.objective);
  const resumable = ["paused", "blocked", "usageLimited"].includes(goal.status);
  return (
    <section
      aria-busy={disabled || undefined}
      aria-label={copy[goal.status]}
      className="goal-bar"
    >
      <button
        aria-label={copy.edit}
        className="goal-bar-main"
        disabled={disabled}
        onClick={onEdit}
        title={objective}
        type="button"
      >
        <TargetIcon aria-hidden="true" size={14} weight="regular" />
        <strong>{copy[goal.status]}</strong>
        <span className="goal-bar-objective">
          {objective}
          <span aria-hidden="true"> •</span>
        </span>
        <span className="goal-bar-progress">
          {formatGoalProgress(goal, locale, clockMs)}
        </span>
      </button>
      <div className="goal-bar-actions">
        <button
          aria-label={copy.clear}
          disabled={disabled}
          onClick={onClear}
          title={copy.clear}
          type="button"
        >
          <TrashIcon aria-hidden="true" size={14} />
        </button>
        {goal.status === "active" && (
          <button
            aria-label={copy.pause}
            disabled={disabled}
            onClick={onPause}
            title={copy.pause}
            type="button"
          >
            <PauseCircleIcon aria-hidden="true" size={14} />
          </button>
        )}
        {resumable && (
          <button
            aria-label={copy.resume}
            disabled={disabled}
            onClick={onResume}
            title={copy.resume}
            type="button"
          >
            <PlayCircleIcon aria-hidden="true" size={14} />
          </button>
        )}
        <button
          aria-label={copy.edit}
          disabled={disabled}
          onClick={onEdit}
          title={copy.edit}
          type="button"
        >
          <PencilSimpleLineIcon aria-hidden="true" size={14} />
        </button>
      </div>
    </section>
  );
}

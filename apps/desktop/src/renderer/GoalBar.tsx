import { useEffect, useState } from "react";
import { Tooltip } from "@artemis/ui/feedback";
import { PauseIcon, PlayIcon } from "@phosphor-icons/react";
import type { AppLocale, ThreadGoal } from "@artemis/protocol";
import {
  Badge,
  Button,
  IconButton,
  type ActionTone,
} from "@artemis/ui/actions";
import { ArtemisIcon } from "@artemis/ui/icons";

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

const GOAL_TONES = {
  active: "info",
  paused: "neutral",
  blocked: "danger",
  usageLimited: "warning",
  budgetLimited: "warning",
  complete: "success",
} as const satisfies Readonly<Record<ThreadGoal["status"], ActionTone>>;

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
  const tone = GOAL_TONES[goal.status];
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
  const chinese = locale.startsWith("zh");
  const preview = !managed
    ? objective
    : (fullObjective ??
      (loadFailed
        ? chinese
          ? "无法载入完整目标，请点击编辑重试。"
          : "Unable to load the full goal. Open the editor to retry."
        : chinese
          ? "正在载入完整目标…"
          : "Loading full goal…"));
  const status =
    goal.status === "active"
      ? chinese
        ? "运行中"
        : "Running"
      : goal.status === "paused"
        ? chinese
          ? "已暂停"
          : "Paused"
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
          label={`${status} ${objective} ${progress} — ${copy.edit}`}
          onClick={onEdit}
          variant="quiet"
        >
          <ArtemisIcon className="goal-bar-icon" name="target" />
          <Badge className="goal-bar-status" tone={tone}>
            {status}
          </Badge>
          <span className="goal-bar-objective">{objective}</span>
          <span className="goal-bar-progress">{progress}</span>
        </Button>
      </Tooltip>
      <div className="goal-bar-actions">
        {goal.status === "active" && (
          <IconButton
            disabled={disabled}
            icon={<PauseIcon weight="regular" />}
            iconSize="sm"
            label={copy.pause}
            onClick={onPause}
            title={copy.pause}
          />
        )}
        {resumable && (
          <IconButton
            disabled={disabled}
            icon={<PlayIcon weight="regular" />}
            iconSize="sm"
            label={copy.resume}
            onClick={onResume}
            title={copy.resume}
          />
        )}
        <IconButton
          disabled={disabled}
          icon={<ArtemisIcon name="edit" />}
          iconSize="sm"
          label={copy.edit}
          onClick={onEdit}
          title={copy.edit}
        />
        <IconButton
          disabled={disabled}
          icon={<ArtemisIcon name="trash" />}
          iconSize="sm"
          label={copy.clear}
          onClick={onClear}
          title={copy.clear}
        />
      </div>
    </section>
  );
}

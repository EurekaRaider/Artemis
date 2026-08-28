import type { AppLocale, ThreadGoal } from "@artemis/protocol";

const LABELS = {
  en: {
    title: "Goal",
    active: "Pursuing",
    paused: "Paused",
    blocked: "Stalled",
    usageLimited: "Usage limited",
    budgetLimited: "Budget reached",
    complete: "Achieved",
    tokens: "tokens",
    elapsed: "elapsed",
    pause: "Pause",
    resume: "Resume",
    edit: "Edit",
    clear: "Clear",
  },
  "zh-CN": {
    title: "目标",
    active: "执行中",
    paused: "已暂停",
    blocked: "已阻塞",
    usageLimited: "用量受限",
    budgetLimited: "预算已用尽",
    complete: "已完成",
    tokens: "Token",
    elapsed: "已用时间",
    pause: "暂停",
    resume: "继续",
    edit: "编辑",
    clear: "清除",
  },
} as const;

function compactNumber(value: number, locale: AppLocale): string {
  return new Intl.NumberFormat(locale, { notation: "compact" }).format(value);
}

function elapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function GoalBar({
  goal,
  locale,
  onClear,
  onEdit,
  onPause,
  onResume,
}: {
  goal: ThreadGoal;
  locale: AppLocale;
  onClear(): void;
  onEdit(): void;
  onPause(): void;
  onResume(): void;
}) {
  const copy = locale.startsWith("zh") ? LABELS["zh-CN"] : LABELS.en;
  const resumable = ["paused", "blocked", "usageLimited"].includes(goal.status);
  return (
    <section className="goal-bar" aria-label={copy.title}>
      <span className={`goal-status-dot ${goal.status}`} aria-hidden="true" />
      <div className="goal-bar-copy">
        <div className="goal-bar-heading">
          <strong>{copy.title}</strong>
          <span>{copy[goal.status]}</span>
        </div>
        <p title={goal.objective}>{goal.objective}</p>
        <small>
          {compactNumber(goal.tokensUsed, locale)}
          {goal.tokenBudget === undefined
            ? ""
            : ` / ${compactNumber(goal.tokenBudget, locale)}`}{" "}
          {copy.tokens}
          <span aria-hidden="true"> · </span>
          {elapsed(goal.timeUsedSeconds)} {copy.elapsed}
        </small>
      </div>
      <div className="goal-bar-actions">
        {goal.status === "active" && (
          <button onClick={onPause} type="button">
            {copy.pause}
          </button>
        )}
        {resumable && (
          <button onClick={onResume} type="button">
            {copy.resume}
          </button>
        )}
        <button onClick={onEdit} type="button">
          {copy.edit}
        </button>
        <button onClick={onClear} type="button">
          {copy.clear}
        </button>
      </div>
    </section>
  );
}

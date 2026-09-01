import { useEffect, useState } from "react";
import type { AppLocale } from "@artemis/protocol";
import { TaskPlan as TaskPlanPattern } from "@artemis/ui/patterns";

import { taskPlanPatternView } from "./agent-pattern-adapters.js";
import { isTaskPlanCompleted, type TaskPlan } from "./task-plan.js";

interface TaskPlanProgressProps {
  locale: AppLocale;
  plan: TaskPlan;
}

export function TaskPlanProgress({ locale, plan }: TaskPlanProgressProps) {
  const [expanded, setExpanded] = useState(false);
  const [visible, setVisible] = useState(true);
  const view = taskPlanPatternView(plan, locale);
  const completed = isTaskPlanCompleted(plan);

  useEffect(() => {
    setVisible(true);
    if (!completed) return;
    setExpanded(false);
    const timeout = window.setTimeout(() => setVisible(false), 2_500);
    return () => window.clearTimeout(timeout);
  }, [completed, plan]);

  if (!visible) return null;

  return (
    <TaskPlanPattern
      className="task-plan-progress"
      collapseLabel={view.collapseLabel}
      currentStepId={view.currentStepId}
      expandLabel={view.expandLabel}
      expanded={expanded}
      label={view.label}
      onExpandedChange={setExpanded}
      progressLabel={view.progressLabel}
      state={view.state}
      steps={view.steps}
      stepsLabel={view.stepsLabel}
    />
  );
}

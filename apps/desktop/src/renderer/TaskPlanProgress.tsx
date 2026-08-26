import { useEffect, useId, useRef, useState } from "react";
import type { AppLocale } from "@artemis/protocol";

import { legacyLocale } from "../shared/locales.js";
import { localizedCopy } from "../shared/i18n-resources.js";
import {
  isTaskPlanCompleted,
  type TaskPlan,
  type TaskPlanStepStatus,
} from "./task-plan.js";

interface TaskPlanProgressProps {
  locale: AppLocale;
  plan: TaskPlan;
}

const HOVER_INTENT_MILLISECONDS = 175;

const statusLabels = {
  en: {
    pending: "Not started",
    in_progress: "In progress",
    completed: "Completed",
    failed: "Failed",
  },
  "zh-CN": {
    pending: "尚未开始",
    in_progress: "正在进行",
    completed: "已完成",
    failed: "失败",
  },
} as const;

const planLabels = {
  en: {
    progress: "Step {{current}} of {{total}}",
    taskSteps: "Task steps",
  },
  "zh-CN": {
    progress: "第 {{current}} / {{total}} 步",
    taskSteps: "任务步骤",
  },
} as const;

function StepMarker({
  locale,
  status,
}: {
  locale: TaskPlanProgressProps["locale"];
  status: TaskPlanStepStatus;
}) {
  return (
    <span
      aria-label={
        localizedCopy(locale, "common", statusLabels[legacyLocale(locale)])[
          status
        ]
      }
      className={`task-step-marker ${status}`}
      role="img"
    >
      {status === "completed" && (
        <svg aria-hidden="true" fill="none" viewBox="0 0 16 16">
          <path
            d="m4.1 8.2 2.5 2.5 5.4-5.6"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.7"
          />
        </svg>
      )}
      {status === "failed" && <span aria-hidden="true">!</span>}
    </span>
  );
}

function visibleStepStatus(
  status: TaskPlanStepStatus,
  current: boolean,
): TaskPlanStepStatus {
  return current && status === "pending" ? "in_progress" : status;
}

export function TaskPlanProgress({ locale, plan }: TaskPlanProgressProps) {
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number | undefined>(undefined);
  const detailsId = useId();
  const current = plan.steps[plan.currentIndex] ?? plan.steps[0];
  const t = localizedCopy(locale, "app", planLabels[legacyLocale(locale)]);
  const number = new Intl.NumberFormat(locale);
  const progressLabel = t.progress
    .replace("{{current}}", number.format(plan.currentIndex + 1))
    .replace("{{total}}", number.format(plan.steps.length));

  const cancelScheduledOpen = () => {
    if (openTimer.current === undefined) return;
    window.clearTimeout(openTimer.current);
    openTimer.current = undefined;
  };
  const scheduleOpen = () => {
    cancelScheduledOpen();
    openTimer.current = window.setTimeout(() => {
      openTimer.current = undefined;
      setOpen(true);
    }, HOVER_INTENT_MILLISECONDS);
  };

  useEffect(
    () => () => {
      if (openTimer.current !== undefined) {
        window.clearTimeout(openTimer.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const completed = isTaskPlanCompleted(plan);
  useEffect(() => {
    setVisible(true);
    if (!completed) return;
    setOpen(false);
    const timeout = window.setTimeout(() => setVisible(false), 2_500);
    return () => window.clearTimeout(timeout);
  }, [completed, plan]);

  if (!visible) return null;

  return (
    <div
      className="task-plan-progress"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          cancelScheduledOpen();
          setOpen(false);
        }
      }}
      onPointerLeave={() => {
        cancelScheduledOpen();
        setOpen(false);
      }}
      ref={root}
    >
      {open && (
        <ol aria-label={t.taskSteps} className="task-plan-list" id={detailsId}>
          {plan.steps.map((step, index) => {
            const status = visibleStepStatus(
              step.status,
              index === plan.currentIndex,
            );
            return (
              <li
                className={`task-plan-step ${status}`}
                key={`${index}:${step.step}`}
              >
                <StepMarker locale={locale} status={status} />
                <span>{step.step}</span>
              </li>
            );
          })}
        </ol>
      )}
      <button
        aria-controls={detailsId}
        aria-expanded={open}
        className="task-plan-trigger"
        onClick={() => {
          cancelScheduledOpen();
          setOpen(true);
        }}
        onFocus={() => {
          cancelScheduledOpen();
          setOpen(true);
        }}
        onPointerEnter={scheduleOpen}
        onPointerLeave={cancelScheduledOpen}
        type="button"
      >
        <StepMarker
          locale={locale}
          status={visibleStepStatus(current?.status ?? "pending", true)}
        />
        <span>{progressLabel}</span>
      </button>
    </div>
  );
}

import type {
  ApprovalScope,
  ApprovalState,
  AppLocale,
  ToolState,
} from "@artemis/protocol";
import type {
  PatternState,
  TaskPlanStep as TaskPlanPatternStep,
} from "@artemis/ui/patterns";

import { localizedCopy } from "../shared/i18n-resources.js";
import { legacyLocale } from "../shared/locales.js";
import {
  formatBashTranscript,
  summarizeToolGroup,
  toolActivityKind,
  type ToolActivityKind,
} from "./tool-presentation.js";
import { isTaskPlanCompleted, type TaskPlan } from "./task-plan.js";

const taskPlanStatusLabels = {
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

const taskPlanLabels = {
  en: {
    collapse: "Collapse",
    expand: "Expand",
    progress: "Step {{current}} of {{total}}",
    taskSteps: "Task steps",
  },
  "zh-CN": {
    collapse: "收起",
    expand: "展开",
    progress: "第 {{current}} / {{total}} 步",
    taskSteps: "任务步骤",
  },
} as const;

export interface TaskPlanPatternView {
  readonly collapseLabel: string;
  readonly currentStepId: string;
  readonly expandLabel: string;
  readonly label: string;
  readonly progressLabel: string;
  readonly state: Extract<PatternState, "active" | "completed" | "failed">;
  readonly statusLabel: string;
  readonly steps: readonly TaskPlanPatternStep[];
  readonly stepsLabel: string;
}

export function taskPlanPatternView(
  plan: TaskPlan,
  locale: AppLocale,
): TaskPlanPatternView {
  const copy = localizedCopy(
    locale,
    "app",
    taskPlanLabels[legacyLocale(locale)],
  );
  const statusCopy = localizedCopy(
    locale,
    "common",
    taskPlanStatusLabels[legacyLocale(locale)],
  );
  const number = new Intl.NumberFormat(locale);
  const progressLabel = copy.progress
    .replace("{{current}}", number.format(plan.currentIndex + 1))
    .replace("{{total}}", number.format(plan.steps.length));
  const steps = plan.steps.map((step, index) => {
    const status =
      index === plan.currentIndex && step.status === "pending"
        ? "in_progress"
        : step.status;
    return {
      id: `${index}:${step.step}`,
      label: step.step,
      status,
      statusLabel: statusCopy[status],
    } satisfies TaskPlanPatternStep;
  });
  const state = isTaskPlanCompleted(plan)
    ? "completed"
    : plan.steps.some((step) => step.status === "failed")
      ? "failed"
      : "active";
  return {
    collapseLabel: copy.collapse,
    currentStepId:
      steps[plan.currentIndex]?.id ?? steps[0]?.id ?? "missing-task-step",
    expandLabel: copy.expand,
    label: progressLabel,
    progressLabel,
    state,
    statusLabel: statusCopy[state === "active" ? "in_progress" : state],
    steps,
    stepsLabel: copy.taskSteps,
  };
}

export type ApprovalPatternActionId =
  "deny" | "approve-project" | "approve-session" | "approve-once";

export interface ApprovalPatternAction {
  readonly approved: boolean;
  readonly id: ApprovalPatternActionId;
  readonly recommended: boolean;
  readonly scope: ApprovalScope;
}

export interface ApprovalPatternView {
  readonly actions: readonly ApprovalPatternAction[];
  readonly actorLabel?: string | undefined;
  readonly detail: string;
  readonly reason?: string | undefined;
  readonly state: "pending";
  readonly title: string;
}

export function approvalPatternView(
  approval: ApprovalState,
  actorLabel?: string,
): ApprovalPatternView {
  const actions: ApprovalPatternAction[] = [
    {
      approved: false,
      id: "deny",
      recommended: approval.modelRecommendation === "deny",
      scope: "once",
    },
  ];
  const appendApprovalAction = (
    scope: ApprovalScope,
    id: ApprovalPatternActionId,
  ) => {
    if (!approval.allowedScopes.includes(scope)) return;
    actions.push({
      approved: true,
      id,
      recommended:
        scope === "once" && approval.modelRecommendation === "approve",
      scope,
    });
  };
  appendApprovalAction("project", "approve-project");
  appendApprovalAction("session", "approve-session");
  appendApprovalAction("once", "approve-once");
  return {
    actions,
    ...(actorLabel ? { actorLabel } : {}),
    detail: approval.command ?? approval.paths.join(", "),
    ...(approval.modelReason ? { reason: approval.modelReason } : {}),
    state: "pending",
    title: approval.summary,
  };
}

export interface ToolActivityPatternView {
  readonly actualStatus: "running" | "completed" | "failed";
  readonly bashTranscript?: string | undefined;
  readonly fileActivity: boolean;
  readonly kind: ToolActivityKind;
  readonly state: Extract<PatternState, "running" | "completed" | "failed">;
  readonly statusLabel: string;
  readonly summary: string;
}

export function toolActivityPatternView(
  tools: readonly ToolState[],
  active: boolean,
  locale: AppLocale,
): ToolActivityPatternView {
  const actualStatus = tools.some((tool) => tool.status === "running")
    ? "running"
    : tools.some((tool) => tool.status === "failed")
      ? "failed"
      : "completed";
  const representative =
    [...tools].reverse().find((tool) => tool.status === "running") ??
    [...tools]
      .reverse()
      .find((tool) => toolActivityKind(tool.name, tool.input) === "search") ??
    tools.at(-1);
  const kind = representative
    ? toolActivityKind(representative.name, representative.input)
    : "generic";
  const copy = localizedCopy(
    locale,
    "app",
    {
      en: {
        running: "Running",
        completed: "Completed",
        failed: "Failed",
      },
      "zh-CN": {
        running: "正在运行",
        completed: "已完成",
        failed: "失败",
      },
    }[legacyLocale(locale)],
  );
  return {
    actualStatus,
    ...(kind === "bash" ? { bashTranscript: formatBashTranscript(tools) } : {}),
    fileActivity: kind === "read" || kind === "write" || kind === "search",
    kind,
    state: active && actualStatus === "completed" ? "running" : actualStatus,
    statusLabel: copy[actualStatus],
    summary: summarizeToolGroup(tools, locale),
  };
}

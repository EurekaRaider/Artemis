import type { AgentEvent } from "@artemis/protocol";

export type TaskPlanStepStatus =
  "pending" | "in_progress" | "completed" | "failed";

export interface TaskPlanStep {
  step: string;
  status: TaskPlanStepStatus;
}

export interface TaskPlan {
  currentIndex: number;
  steps: TaskPlanStep[];
}

export function isTaskPlanCompleted(plan: TaskPlan): boolean {
  return (
    plan.steps.length > 0 &&
    plan.steps.every((step) => step.status === "completed")
  );
}

function parseSteps(input: unknown): TaskPlanStep[] | undefined {
  if (!input || typeof input !== "object" || !("steps" in input)) {
    return undefined;
  }
  const rawSteps = (input as { steps?: unknown }).steps;
  if (!Array.isArray(rawSteps) || rawSteps.length < 1 || rawSteps.length > 12) {
    return undefined;
  }

  const steps: TaskPlanStep[] = [];
  for (const raw of rawSteps) {
    if (!raw || typeof raw !== "object") return undefined;
    const step = (raw as { step?: unknown }).step;
    const status = (raw as { status?: unknown }).status;
    if (
      typeof step !== "string" ||
      !step.trim() ||
      step.length > 200 ||
      (status !== "pending" &&
        status !== "in_progress" &&
        status !== "completed")
    ) {
      return undefined;
    }
    steps.push({ step: step.trim(), status });
  }
  if (steps.filter((step) => step.status === "in_progress").length > 1) {
    return undefined;
  }
  return steps;
}

export function deriveTaskPlan(
  events: AgentEvent[],
  turnActive: boolean,
): TaskPlan | undefined {
  if (!turnActive) return undefined;
  const latestTurnIndex = events.findLastIndex(
    (event) => event.payload.type === "turn.started",
  );
  const latestTurn = events[latestTurnIndex];
  if (!latestTurn) return undefined;

  const failedToolCalls = new Set<string>();
  let turnFailed = false;
  for (let index = events.length - 1; index >= latestTurnIndex; index -= 1) {
    const event = events[index]!;
    if (
      event.payload.type === "turn.completed" &&
      event.payload.reason === "cancelled" &&
      (event.turnId === latestTurn.turnId || event.turnId === undefined)
    ) {
      return undefined;
    }
    if (event.turnId !== latestTurn.turnId) continue;
    if (event.payload.type === "turn.failed") {
      turnFailed = true;
      continue;
    }
    if (event.payload.type === "tool.completed" && event.payload.isError) {
      failedToolCalls.add(event.payload.toolCallId);
      continue;
    }
    if (
      event.payload.type !== "tool.started" ||
      event.payload.toolName !== "update_plan" ||
      failedToolCalls.has(event.payload.toolCallId)
    ) {
      continue;
    }
    const parsed = parseSteps(event.payload.input);
    if (!parsed) continue;
    const steps = turnFailed
      ? parsed.map((step) =>
          step.status === "in_progress"
            ? ({ ...step, status: "failed" } as TaskPlanStep)
            : step,
        )
      : parsed;
    const activeIndex = steps.findIndex(
      (step) => step.status === "in_progress" || step.status === "failed",
    );
    const pendingIndex = steps.findIndex((step) => step.status === "pending");
    const currentIndex = Math.max(
      0,
      activeIndex >= 0
        ? activeIndex
        : pendingIndex >= 0
          ? pendingIndex
          : steps.length - 1,
    );
    return { currentIndex, steps };
  }
  return undefined;
}

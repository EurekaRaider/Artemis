import type { OpenThreadRequest } from "../runtime-types.js";

import { randomUUID } from "node:crypto";

import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import type { AgentRuntimeDependencies } from "../agent-runtime-dependencies.js";
export function createSessionPlanTools(
  request: OpenThreadRequest,
  services: Pick<
    AgentRuntimeDependencies,
    "threads" | "broker" | "requireActiveThread"
  >,
) {
  let submittedPlanTurn: string | undefined;
  const submitPlanTool = defineTool({
    name: "submit_plan",
    label: "Submit complete plan",
    description:
      "Submit the complete final plan for user confirmation and end this Plan turn. Include objective, steps, interfaces, acceptance criteria, assumptions and defaults. For a review, put findings first. Set actionable=false only when there is nothing to execute.",
    parameters: Type.Object({
      title: Type.String({ minLength: 1, maxLength: 200 }),
      markdown: Type.String({ minLength: 1, maxLength: 100000 }),
      actionable: Type.Optional(Type.Boolean()),
    }),
    execute: async (_id, params) => {
      const hosted = services.threads.get(request.threadId);
      if (hosted?.currentMode !== "plan" || !hosted.currentTurnId)
        throw new Error("submit_plan requires the main Agent in Plan mode.");
      const result = await services.broker.request({
        kind: "plan.submit",
        approvalId: randomUUID(),
        threadId: request.threadId,
        turnId: hosted.currentTurnId,
        mode: "plan",
        title: params.title,
        markdown: params.markdown,
        actionable: params.actionable ?? true,
      });
      if (!result.approved)
        throw new Error(result.error ?? "Plan submission failed");
      submittedPlanTurn = hosted.currentTurnId;
      hosted.adapter?.stopAfterTools();
      return {
        content: [
          {
            type: "text" as const,
            text: "Plan saved. Waiting for the user's explicit choice.",
          },
        ],
        details: result.data,
      };
    },
  });
  let planUpdateTurn: string | undefined;
  let consecutivePlanUpdates = 0;
  let stoppedPlanLoopTurn: string | undefined;
  const updatePlanTool = defineTool({
    name: "update_plan",
    label: "Update task steps",
    description:
      "Publish the current progress for a task with multiple meaningful steps. Use pending, in_progress, and completed statuses, with at most one step in progress.",
    parameters: Type.Object({
      explanation: Type.Optional(
        Type.String({
          maxLength: 500,
          description: "Optional short reason for this plan update.",
        }),
      ),
      steps: Type.Array(
        Type.Object({
          step: Type.String({
            minLength: 1,
            maxLength: 200,
            description: "A concise, verifiable task step.",
          }),
          status: Type.Union([
            Type.Literal("pending"),
            Type.Literal("in_progress"),
            Type.Literal("completed"),
          ]),
        }),
        { minItems: 1, maxItems: 12 },
      ),
    }),
    execute: async (_toolCallId, params) => {
      const hosted = services.requireActiveThread(request.threadId);
      if (consecutivePlanUpdates >= 8) {
        stoppedPlanLoopTurn = hosted.currentTurnId;
        hosted.adapter?.stopAfterTools();
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "PLAN_UPDATE_LOOP: stopped after eight consecutive plan updates without a task action. The requested task is not complete. Inspect the failed tool call before continuing; do not replay the plan loop.",
            },
          ],
          details: {},
        };
      }
      const steps = params.steps.map((item) => ({
        step: item.step.trim(),
        status: item.status,
      }));
      if (steps.some((item) => !item.step)) {
        throw new Error("Task steps cannot be empty.");
      }
      if (steps.filter((item) => item.status === "in_progress").length > 1) {
        throw new Error("Only one task step may be in progress.");
      }
      return {
        content: [
          {
            type: "text",
            text: `Updated ${steps.length} task step${steps.length === 1 ? "" : "s"}. Continue with the next task action; update again only when progress changes.`,
          },
        ],
        details: {
          ...(params.explanation
            ? { explanation: params.explanation.trim() }
            : {}),
          steps,
        },
      };
    },
  });
  return {
    submitPlanTool,
    updatePlanTool,
    get submittedPlanTurn() {
      return submittedPlanTurn;
    },
    set submittedPlanTurn(value: typeof submittedPlanTurn) {
      submittedPlanTurn = value;
    },
    get planUpdateTurn() {
      return planUpdateTurn;
    },
    set planUpdateTurn(value: typeof planUpdateTurn) {
      planUpdateTurn = value;
    },
    get consecutivePlanUpdates() {
      return consecutivePlanUpdates;
    },
    set consecutivePlanUpdates(value: typeof consecutivePlanUpdates) {
      consecutivePlanUpdates = value;
    },
    get stoppedPlanLoopTurn() {
      return stoppedPlanLoopTurn;
    },
    set stoppedPlanLoopTurn(value: typeof stoppedPlanLoopTurn) {
      stoppedPlanLoopTurn = value;
    },
  };
}

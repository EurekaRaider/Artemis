import { type OpenThreadRequest } from "../runtime-types.js";

import { isExecutionMode } from "@artemis/protocol";

import { randomUUID } from "node:crypto";

import { defineTool } from "@earendil-works/pi-coding-agent";

import { Type } from "@sinclair/typebox";

import type { BrokerToolContext } from "./broker-tool-context.js";
export function createGoalTools(
  request: OpenThreadRequest,
  context: Pick<BrokerToolContext, "threads" | "broker">,
) {
  const getGoalTool = defineTool({
    name: "get_goal",
    label: "Read persistent Goal",
    description:
      "Read the current thread Goal, including lifecycle status, Token budget, used and remaining Tokens, and elapsed time.",
    parameters: Type.Object({}, { additionalProperties: false }),
    execute: async () => {
      const hosted = context.threads.get(request.threadId);
      if (!hosted?.currentTurnId || !hosted.currentMode) {
        throw new Error("No active turn is available for Goal access.");
      }
      const result = await context.broker.request({
        kind: "goal.get",
        approvalId: randomUUID(),
        threadId: request.threadId,
        turnId: hosted.currentTurnId,
        mode: hosted.currentMode,
      });
      if (!result.approved) {
        throw new Error(result.error ?? "The Goal could not be read.");
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result.data ?? { goal: null }, null, 2),
          },
        ],
        details: result.data,
      };
    },
  });

  const createGoalTool = defineTool({
    name: "create_goal",
    label: "Create persistent Goal",
    description:
      "Create a thread Goal only when the user or system explicitly asked for one. Never infer a Goal from an ordinary task, and set a Token budget only when the user explicitly supplied it.",
    parameters: Type.Object(
      {
        objective: Type.String({ minLength: 1, maxLength: 100_000 }),
        token_budget: Type.Optional(Type.Integer({ minimum: 1 })),
      },
      { additionalProperties: false },
    ),
    execute: async (_toolCallId, params) => {
      const hosted = context.threads.get(request.threadId);
      if (!hosted?.currentTurnId || !isExecutionMode(hosted.currentMode)) {
        throw new Error(
          "Goal creation requires an active Work or Codemode turn.",
        );
      }
      const result = await context.broker.request({
        kind: "goal.create",
        approvalId: randomUUID(),
        threadId: request.threadId,
        turnId: hosted.currentTurnId,
        objective: params.objective.trim(),
        ...(params.token_budget ? { tokenBudget: params.token_budget } : {}),
        mode: hosted.currentMode,
      });
      if (!result.approved) {
        throw new Error(result.error ?? "The Goal could not be created.");
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result.data, null, 2),
          },
        ],
        details: result.data,
      };
    },
  });

  const updateGoalTool = defineTool({
    name: "update_goal",
    label: "Complete or block Goal",
    description:
      "Mark an active Goal complete only after concrete evidence proves every required outcome. Mark it blocked only after the same blocker has prevented meaningful progress in three consecutive Goal turns. The model cannot pause, resume, clear, or budget-limit a Goal.",
    parameters: Type.Object(
      {
        status: Type.Union([Type.Literal("complete"), Type.Literal("blocked")]),
        blocker: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
      },
      { additionalProperties: false },
    ),
    execute: async (_toolCallId, params) => {
      const hosted = context.threads.get(request.threadId);
      if (!hosted?.currentTurnId || !isExecutionMode(hosted.currentMode)) {
        throw new Error(
          "Goal updates require an active Work or Codemode turn.",
        );
      }
      if (params.status === "blocked" && !params.blocker?.trim()) {
        throw new Error("A blocked Goal update requires the repeated blocker.");
      }
      const result = await context.broker.request({
        kind: "goal.update",
        approvalId: randomUUID(),
        threadId: request.threadId,
        turnId: hosted.currentTurnId,
        status: params.status,
        ...(params.blocker ? { blocker: params.blocker.trim() } : {}),
        mode: hosted.currentMode,
      });
      if (!result.approved) {
        throw new Error(result.error ?? "The Goal could not be updated.");
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result.data, null, 2),
          },
        ],
        details: result.data,
      };
    },
  });
  return { getGoalTool, createGoalTool, updateGoalTool };
}

import { z } from "zod";
import { artifactEventSchema } from "../artifact.js";
import { proposedPlanSchema, planAcceptanceSchema } from "./plans.js";
import { taskNotificationStateSchema } from "./notifications.js";
import {
  userMessagePayloadSchema,
  turnStartedPayloadSchema,
  turnActivityPayloadSchema,
  messageSupersededPayloadSchema,
  messageDeltaPayloadSchema,
  turnCompletedPayloadSchema,
  turnFailedPayloadSchema,
} from "./messages.js";
import {
  toolStartedPayloadSchema,
  toolUpdatedPayloadSchema,
  toolCompletedPayloadSchema,
} from "./tools.js";
import {
  approvalRequestedPayloadSchema,
  approvalResolvedPayloadSchema,
} from "./approvals.js";
import {
  userInputMultiQuestionRequestedPayloadSchema,
  userInputSingleQuestionRequestedPayloadSchema,
  userInputMultiQuestionResolvedPayloadSchema,
  userInputSingleQuestionResolvedPayloadSchema,
} from "./user-input.js";
import {
  fileChangedPayloadSchema,
  turnChangeSetUpdatedPayloadSchema,
  terminalOutputPayloadSchema,
} from "./files.js";
import {
  childAgentPayloadSchema,
  customAgentRoutePayloadSchema,
  agentTeamStatusPayloadSchema,
  agentTeamMessagePayloadSchema,
} from "./agents.js";
import {
  mcpToolUsedPayloadSchema,
  taskSourceAddedPayloadSchema,
} from "./sources.js";
import {
  contextUsagePayloadSchema,
  assistantUsagePayloadSchema,
} from "./usage.js";
import {
  threadGoalUpdatedPayloadSchema,
  threadGoalClearedPayloadSchema,
} from "./goals.js";
import {
  queueUpdatedPayloadSchema,
  queueRecoveredPayloadSchema,
} from "./queue.js";
import { PROTOCOL_VERSION } from "./core.js";

export const agentPayloadSchema = z.discriminatedUnion("type", [
  proposedPlanSchema.extend({ type: z.literal("plan.proposed") }),
  planAcceptanceSchema.extend({
    type: z.literal("plan.accepted"),
    executionTurnId: z.string().min(1),
  }),
  z.object({
    type: z.literal("plan.superseded"),
    planId: z.string().min(1),
    revision: z.number().int().positive(),
  }),
  z
    .object({ type: z.literal("artifact.event"), event: artifactEventSchema })
    .strict(),
  z
    .object({
      type: z.literal("im.group.activity"),
      taskId: z.string().min(1),
      phase: z.enum([
        "assigned",
        "completed",
        "failed",
        "input-required",
        "approval-required",
      ]),
    })
    .strict(),
  z.object({
    type: z.literal("thread.notification.updated"),
    state: taskNotificationStateSchema,
    threadStatus: z
      .enum(["idle", "running", "waiting-approval", "failed"])
      .optional(),
  }),
  userMessagePayloadSchema,
  turnStartedPayloadSchema,
  turnActivityPayloadSchema,
  messageSupersededPayloadSchema,
  messageDeltaPayloadSchema,
  toolStartedPayloadSchema,
  toolUpdatedPayloadSchema,
  toolCompletedPayloadSchema,
  approvalRequestedPayloadSchema,
  approvalResolvedPayloadSchema,
  z.discriminatedUnion("kind", [
    userInputMultiQuestionRequestedPayloadSchema,
    userInputSingleQuestionRequestedPayloadSchema,
  ]),
  z.discriminatedUnion("kind", [
    userInputMultiQuestionResolvedPayloadSchema,
    userInputSingleQuestionResolvedPayloadSchema,
  ]),
  fileChangedPayloadSchema,
  turnChangeSetUpdatedPayloadSchema,
  terminalOutputPayloadSchema,
  childAgentPayloadSchema,
  customAgentRoutePayloadSchema,
  agentTeamStatusPayloadSchema,
  agentTeamMessagePayloadSchema,
  mcpToolUsedPayloadSchema,
  taskSourceAddedPayloadSchema,
  contextUsagePayloadSchema,
  assistantUsagePayloadSchema,
  threadGoalUpdatedPayloadSchema,
  threadGoalClearedPayloadSchema,
  queueUpdatedPayloadSchema,
  queueRecoveredPayloadSchema,
  turnCompletedPayloadSchema,
  turnFailedPayloadSchema,
]);

export type AgentPayload = z.infer<typeof agentPayloadSchema>;

export const agentEventSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  eventId: z.string().min(1),
  threadId: z.string().min(1),
  turnId: z.string().optional(),
  seq: z.number().int().nonnegative(),
  timestamp: z.string().datetime({ offset: true }),
  payload: agentPayloadSchema,
});

export type AgentEvent = z.infer<typeof agentEventSchema>;

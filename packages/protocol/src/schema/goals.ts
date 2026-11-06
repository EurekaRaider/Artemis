import { z } from "zod";

export const threadGoalStatusSchema = z.enum([
  "active",
  "paused",
  "blocked",
  "usageLimited",
  "budgetLimited",
  "complete",
]);

export type ThreadGoalStatus = z.infer<typeof threadGoalStatusSchema>;

export const threadGoalSchema = z.object({
  threadId: z.string().min(1),
  goalId: z.string().min(1),
  objective: z.string().trim().min(1).max(4_000),
  status: threadGoalStatusSchema,
  tokenBudget: z.number().int().positive().optional(),
  tokensUsed: z.number().int().nonnegative(),
  timeUsedSeconds: z.number().nonnegative(),
  revision: z.number().int().positive(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export type ThreadGoal = z.infer<typeof threadGoalSchema>;

export const threadGoalUpdatedPayloadSchema = z.object({
  type: z.literal("thread.goal.updated"),
  goal: threadGoalSchema,
});

export const threadGoalClearedPayloadSchema = z.object({
  type: z.literal("thread.goal.cleared"),
  goalId: z.string().min(1),
  revision: z.number().int().positive(),
});

import { z } from "zod";
import { planAcceptanceSchema } from "./plans.js";
import {
  promptAttachmentSchema,
  promptAttachmentsSchema,
  type PromptAttachment,
} from "./attachments.js";
import { runModeSchema, type RunMode } from "./core.js";
import { workspaceTargetSchema } from "./workspace.js";
import { modelSelectionSchema } from "./models.js";
import { threadGoalStatusSchema } from "./goals.js";

export const threadCommandSchema = z.discriminatedUnion("type", [
  planAcceptanceSchema.extend({
    type: z.literal("plan.accept"),
    threadId: z.string().min(1),
  }),
  z.object({
    type: z.literal("plan.revise"),
    threadId: z.string().min(1),
    text: z.string().trim().min(1).max(100_000),
    attachments: z.array(promptAttachmentSchema).optional(),
  }),
  z.object({
    type: z.literal("thread.create"),
    projectId: z.string().min(1).optional(),
    mode: runModeSchema,
    target: workspaceTargetSchema,
  }),
  z.object({
    type: z.literal("thread.model.set"),
    threadId: z.string().min(1),
    selection: modelSelectionSchema,
    contextWindow: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("thread.archive"),
    threadId: z.string().min(1),
    archived: z.boolean(),
  }),
  z.object({
    type: z.literal("thread.delete"),
    threadId: z.string().min(1),
  }),
  z.object({
    type: z.literal("thread.rename"),
    threadId: z.string().min(1),
    title: z.string().trim().min(1).max(160),
  }),
  z
    .object({
      type: z.literal("thread.goal.set"),
      threadId: z.string().min(1),
      objective: z.string().trim().min(1).max(100_000).optional(),
      status: threadGoalStatusSchema.optional(),
      tokenBudget: z.number().int().positive().nullable().optional(),
      expectedGoalId: z.string().min(1).optional(),
      expectedRevision: z.number().int().positive().optional(),
    })
    .refine(
      (command) =>
        command.objective !== undefined ||
        command.status !== undefined ||
        command.tokenBudget !== undefined,
      { message: "A Goal mutation must set at least one field." },
    ),
  z.object({
    type: z.literal("thread.goal.pause"),
    threadId: z.string().min(1),
  }),
  z.object({
    type: z.literal("thread.goal.resume"),
    threadId: z.string().min(1),
  }),
  z.object({
    type: z.literal("thread.goal.clear"),
    threadId: z.string().min(1),
  }),
  z.object({
    type: z.literal("thread.fork"),
    threadId: z.string().min(1),
    entryId: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("thread.compact"),
    threadId: z.string().min(1),
    instructions: z.string().trim().min(1).max(4_000).optional(),
  }),
  z.object({ type: z.literal("turn.cancel"), threadId: z.string().min(1) }),
  z.object({
    type: z.enum(["turn.queue.clear", "turn.queue.steer"]),
    threadId: z.string().min(1),
  }),
  z.object({
    type: z.literal("turn.queue.steer-item"),
    threadId: z.string().min(1),
    followUpIndex: z.number().int().nonnegative(),
    expectedFollowUp: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    type: z.literal("turn.queue.replace"),
    threadId: z.string().min(1),
    expectedFollowUp: z.array(z.string().min(1)).min(1),
    followUp: z.array(
      z.object({
        sourceIndex: z.number().int().nonnegative(),
        text: z.string().trim().min(1),
      }),
    ),
  }),
  z.object({
    type: z.literal("turn.steer"),
    threadId: z.string().min(1),
    text: z.string().trim().min(1),
    attachments: promptAttachmentsSchema.optional(),
  }),
  z.object({
    type: z.literal("turn.follow-up"),
    threadId: z.string().min(1),
    text: z.string().trim().min(1),
    attachments: promptAttachmentsSchema.optional(),
  }),
]);

export type ThreadCommand = z.infer<typeof threadCommandSchema>;

export const worktreeCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("worktree.branchize"),
    threadId: z.string().min(1),
    branchName: z.string().trim().min(1).max(200),
  }),
  z.object({
    type: z.literal("worktree.cleanup"),
    threadId: z.string().min(1),
    force: z.boolean(),
  }),
  z.object({
    type: z.literal("worktree.handoff"),
    threadId: z.string().min(1),
    destination: z.enum(["local", "managed-worktree"]),
  }),
]);

export type WorktreeCommand = z.infer<typeof worktreeCommandSchema>;

export interface TurnStartCommand {
  threadId: string;
  text: string;
  mode: RunMode;
  attachments?: PromptAttachment[];
}

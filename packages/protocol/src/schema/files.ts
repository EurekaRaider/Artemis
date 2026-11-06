import { z } from "zod";

export const fileChangedPayloadSchema = z.object({
  type: z.literal("file.changed"),
  path: z.string().min(1),
  operation: z.enum(["create", "update", "delete"]),
});

export const turnChangeFileSchema = z.object({
  path: z.string().min(1),
  status: z.enum(["added", "modified", "deleted"]),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  binary: z.boolean(),
});

export type TurnChangeFile = z.infer<typeof turnChangeFileSchema>;

export const turnChangeSetUpdatedPayloadSchema = z.object({
  type: z.literal("turn.change-set.updated"),
  status: z.enum(["ready", "undone", "unavailable"]),
  files: z.array(turnChangeFileSchema),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  undoAvailable: z.boolean(),
  message: z.string().trim().min(1).max(1_000).optional(),
});

export type TurnChangeSetUpdatedPayload = z.infer<
  typeof turnChangeSetUpdatedPayloadSchema
>;

export const terminalOutputPayloadSchema = z.object({
  type: z.literal("terminal.output"),
  terminalId: z.string().min(1),
  data: z.string(),
});

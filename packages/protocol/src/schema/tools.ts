import { z } from "zod";

export const toolStartedPayloadSchema = z.object({
  type: z.literal("tool.started"),
  parentToolCallId: z.string().min(1).optional(),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  input: z.unknown().optional(),
});

export type ToolStartedPayload = z.infer<typeof toolStartedPayloadSchema>;

export const toolUpdatedPayloadSchema = z.object({
  type: z.literal("tool.updated"),
  toolCallId: z.string().min(1),
  output: z.string(),
});

export const toolCompletedPayloadSchema = z.object({
  type: z.literal("tool.completed"),
  structuredContent: z.unknown().optional(),
  images: z
    .array(
      z.object({
        data: z.string(),
        mimeType: z.enum([
          "image/png",
          "image/jpeg",
          "image/webp",
          "image/gif",
        ]),
      }),
    )
    .optional(),
  toolCallId: z.string().min(1),
  output: z.string().optional(),
  isError: z.boolean(),
});

import { z } from "zod";
import { promptAttachmentsSchema } from "./attachments.js";

export const queueUpdatedPayloadSchema = z.object({
  type: z.literal("queue.updated"),
  steering: z.array(z.string()),
  followUp: z.array(z.string()),
});

export type QueueUpdatedPayload = z.infer<typeof queueUpdatedPayloadSchema>;

export const queueRecoveredPayloadSchema = z.object({
  type: z.literal("queue.recovered"),
  messages: z.array(z.string().min(1)).min(1),
  items: z
    .array(
      z.object({
        text: z.string().min(1),
        attachments: promptAttachmentsSchema.optional(),
      }),
    )
    .min(1)
    .optional(),
});

export type QueueRecoveredPayload = z.infer<typeof queueRecoveredPayloadSchema>;

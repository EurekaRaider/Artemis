import { z } from "zod";
import { runModeSchema } from "./core.js";

export const userMessagePayloadSchema = z.object({
  type: z.literal("user.message"),
  messageId: z.string().min(1),
  text: z.string(),
});

export const turnStartedPayloadSchema = z.object({
  type: z.literal("turn.started"),
  mode: runModeSchema,
  model: z.string().optional(),
});

export const turnActivityPayloadSchema = z.object({
  type: z.literal("turn.activity"),
  phase: z.enum([
    "queued",
    "requesting-model",
    "thinking",
    "reconnecting",
    "recovered",
    "interrupted",
  ]),
  queueDepth: z.number().int().nonnegative().optional(),
  toolCount: z.number().int().nonnegative().optional(),
  kind: z
    .enum([
      "connection",
      "stream-stalled",
      "rate-limit",
      "provider",
      "process-restart",
    ])
    .optional(),
  attempt: z.number().int().positive().optional(),
  maxAttempts: z.number().int().positive().optional(),
  delayMs: z.number().int().nonnegative().optional(),
  attemptId: z.string().min(1).optional(),
});

export type TurnActivityPayload = z.infer<typeof turnActivityPayloadSchema>;

export const messageSupersededPayloadSchema = z.object({
  type: z.literal("message.superseded"),
  messageId: z.string().min(1),
  attemptId: z.string().min(1),
});

export const messageDeltaPayloadSchema = z.object({
  type: z.literal("message.part.delta"),
  partId: z.string().min(1),
  partType: z.enum(["text", "thinking"]),
  delta: z.string(),
});

export const turnCompletedPayloadSchema = z.object({
  composerPrediction: z
    .string()
    .min(1)
    .refine((value) => Array.from(value).length <= 120)
    .optional(),
  type: z.literal("turn.completed"),
  reason: z.enum(["completed", "cancelled"]),
  finalPartId: z.string().min(1).optional(),
  durationMs: z.number().int().nonnegative().optional(),
  backgroundProcessesRunning: z.boolean().optional(),
});

export const turnFailedPayloadSchema = z.object({
  type: z.literal("turn.failed"),
  message: z.string().min(1),
  code: z.string().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  backgroundProcessesRunning: z.boolean().optional(),
});

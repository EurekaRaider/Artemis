import { z } from "zod";
import { contextWindowSchema } from "./models.js";

export const contextUsagePayloadSchema = z.object({
  type: z.literal("context.usage"),
  tokens: z.number().int().nonnegative().nullable(),
  contextWindow: contextWindowSchema,
  compacting: z.boolean(),
  compactionResult: z
    .object({
      status: z.enum(["completed", "failed", "cancelled"]),
      error: z.string().optional(),
    })
    .optional(),
  estimated: z.boolean().optional(),
  source: z
    .enum(["provider", "local-estimate", "compaction-estimate"])
    .optional(),
  providerInputTokens: z.number().int().nonnegative().optional(),
  breakdown: z
    .object({
      systemPromptTokens: z.number().int().nonnegative(),
      systemToolTokens: z.number().int().nonnegative(),
      mcpToolTokens: z.number().int().nonnegative(),
      customAgentTokens: z.number().int().nonnegative(),
      memoryFileTokens: z.number().int().nonnegative(),
      skillTokens: z.number().int().nonnegative(),
      messageTokens: z.number().int().nonnegative(),
      freeSpaceTokens: z.number().int().nonnegative(),
      autocompactBufferTokens: z.number().int().nonnegative(),
    })
    .optional(),
  footprint: z
    .object({
      textBytes: z.number().int().nonnegative(),
      imageBytes: z.number().int().nonnegative(),
      imageCount: z.number().int().nonnegative(),
      toolSchemaBytes: z.number().int().nonnegative(),
      largestToolResultBytes: z.number().int().nonnegative(),
    })
    .optional(),
});

export type ContextUsagePayload = z.infer<typeof contextUsagePayloadSchema>;

export const assistantUsagePayloadSchema = z.object({
  type: z.literal("assistant.usage"),
  providerId: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  cacheReadReported: z.boolean().optional(),
  cacheWriteReported: z.boolean().optional(),
  cachePolicy: z.enum(["disabled", "short", "long", "explicit-30m"]).optional(),
  cachePolicyReason: z
    .enum([
      "explicitly-disabled",
      "official-gpt-5.6",
      "official-gpt-5.5",
      "official-legacy-first-turn",
      "official-legacy-persistent",
      "child-agent",
      "non-official-endpoint",
      "unsupported-model",
    ])
    .optional(),
  cacheKeyFingerprint: z.string().length(16).optional(),
  systemPromptFingerprint: z.string().length(16).optional(),
  toolSchemaFingerprint: z.string().length(16).optional(),
  stablePrefixTokens: z.number().int().nonnegative().optional(),
  cacheKeyRequestsPerMinute: z.number().int().nonnegative().optional(),
  cacheKeyRateWarning: z.boolean().optional(),
});

export type AssistantUsagePayload = z.infer<typeof assistantUsagePayloadSchema>;

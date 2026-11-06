import { z } from "zod";

export const contextWindowSchema = z.number().int().min(1_024).max(10_000_000);

export const providerThinkingLevelSchema = z.enum([
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

export const modelAdvancedOptionsSchema = z
  .object({
    virtualRoutes: z
      .array(
        z.object({
          providerId: z.string().min(1),
          modelId: z.string().min(1),
          thinkingLevel: z
            .enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"])
            .optional(),
        }),
      )
      .min(1)
      .max(16)
      .optional(),
    samplingParams: z.record(z.string(), z.json()).optional(),
    samplingParamsByThinkingLevel: z
      .partialRecord(
        z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]),
        z.record(z.string(), z.json()),
      )
      .optional(),
    thinkingLevelMap: z
      .partialRecord(
        z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]),
        z.string().nullable(),
      )
      .optional(),
    promptCache: z
      .object({
        short: z.number().positive().optional(),
        long: z.number().positive().optional(),
      })
      .optional(),
    cacheWarming: z.enum(["off", "streaming", "idle"]).optional(),
    compaction: z
      .object({
        enabled: z.boolean().optional(),
        reserveTokens: z.number().int().positive().optional(),
        keepRecentTokens: z.number().int().positive().optional(),
      })
      .optional(),
    inputLimits: z
      .object({
        maxRequestBytes: z.number().int().positive().optional(),
        images: z
          .object({
            maxPerMessage: z.number().int().positive().optional(),
            maxPerRequest: z.number().int().positive().optional(),
            resize: z
              .object({
                maxWidth: z.number().int().positive().optional(),
                maxHeight: z.number().int().positive().optional(),
                maxBytes: z.number().int().positive().optional(),
                jpegQuality: z.number().min(1).max(100).optional(),
              })
              .optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .strict();

export const providerModelSchema = modelAdvancedOptionsSchema.extend({
  id: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u),
  name: z.string().trim().min(1).max(160),
  reasoning: z.boolean(),
  highestThinkingLevel: providerThinkingLevelSchema.optional(),
  input: z
    .array(z.enum(["text", "image"]))
    .min(1)
    .max(2)
    .refine((input) => input.includes("text"), {
      message: "Provider models must accept text input",
    }),
  contextWindow: contextWindowSchema,
  maxTokens: z.number().int().min(1).max(1_000_000),
});

export type ProviderModel = z.infer<typeof providerModelSchema>;

export const providerConnectionSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9._-]*$/u),
  name: z.string().trim().min(1).max(80),
  baseUrl: z
    .string()
    .trim()
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        (url.protocol === "http:" || url.protocol === "https:") &&
        !url.username &&
        !url.password
      );
    }, "Provider Base URL must use HTTP(S) without embedded credentials"),
  api: z.enum(["openai-completions", "openai-responses"]).optional(),
  models: z.array(providerModelSchema).min(1).max(32),
});

export type ProviderConnection = z.infer<typeof providerConnectionSchema>;

export const thinkingLevelSchema = z.enum([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

export type ThinkingLevel = z.infer<typeof thinkingLevelSchema>;

export const modelSelectionSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  thinkingLevel: thinkingLevelSchema,
  ultraMode: z.boolean().optional(),
});

export type ModelSelection = z.infer<typeof modelSelectionSchema>;

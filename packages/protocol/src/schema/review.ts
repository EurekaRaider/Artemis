import { z } from "zod";

export const reviewScopeSchema = z.enum([
  "turn",
  "last-turn",
  "unstaged",
  "staged",
  "branch",
]);

export type ReviewScope = z.infer<typeof reviewScopeSchema>;

export const reviewActionSchema = z.enum(["stage", "unstage", "revert"]);

export type ReviewAction = z.infer<typeof reviewActionSchema>;

export const reviewQuerySchema = z
  .object({
    threadId: z.string().min(1),
    scope: reviewScopeSchema,
    turnId: z.string().min(1).optional(),
    baseRef: z.string().trim().min(1).max(200).optional(),
  })
  .superRefine((value, context) => {
    if (value.scope === "turn" && !value.turnId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["turnId"],
        message: "Turn review requires a turnId.",
      });
    }
  });

export type ReviewQuery = z.infer<typeof reviewQuerySchema>;

export const reviewMutationInputSchema = z
  .object({
    threadId: z.string().min(1),
    scope: reviewScopeSchema,
    turnId: z.string().min(1).optional(),
    baseRef: z.string().trim().min(1).max(200).optional(),
    action: reviewActionSchema,
    target: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("file"),
        id: z.string().regex(/^[a-f0-9]{64}$/),
      }),
      z.object({
        kind: z.literal("hunk"),
        id: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    ]),
  })
  .superRefine((value, context) => {
    if (value.scope === "turn" && !value.turnId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["turnId"],
        message: "Turn review requires a turnId.",
      });
    }
  });

export type ReviewMutationInput = z.infer<typeof reviewMutationInputSchema>;

import { z } from "zod";

export const proposedPlanSchema = z.object({
  planId: z.string().min(1),
  revision: z.number().int().positive(),
  sourceTurnId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  markdown: z.string().trim().min(1).max(100_000),
  actionable: z.boolean(),
});

export type ProposedPlan = z.infer<typeof proposedPlanSchema>;

export const planAcceptanceSchema = z.object({
  planId: z.string().min(1),
  revision: z.number().int().positive(),
  mode: z.enum(["work", "codemode"]),
});

export type PlanAcceptance = z.infer<typeof planAcceptanceSchema>;

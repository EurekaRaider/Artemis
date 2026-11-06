import { z } from "zod";

export const approvalScopeSchema = z.enum(["once", "session", "project"]);

export type ApprovalScope = z.infer<typeof approvalScopeSchema>;

export const riskLevelSchema = z.enum(["low", "medium", "high", "critical"]);

export type RiskLevel = z.infer<typeof riskLevelSchema>;

export const modelRiskLevelSchema = z.enum(["low", "medium", "high"]);

export type ModelRiskLevel = z.infer<typeof modelRiskLevelSchema>;

export const modelApprovalDecisionSchema = z.object({
  risk: modelRiskLevelSchema,
  explicitUserRequest: z.boolean(),
  reason: z.string().trim().min(1).max(500),
});

export type ModelApprovalDecision = z.infer<typeof modelApprovalDecisionSchema>;

export const approvalRequestedPayloadSchema = z.object({
  type: z.literal("approval.requested"),
  approvalId: z.string().min(1),
  nonce: z.string().min(16),
  summary: z.string().min(1),
  command: z.string().optional(),
  paths: z.array(z.string()).default([]),
  network: z.array(z.string()).default([]),
  risk: riskLevelSchema,
  allowedScopes: z.array(approvalScopeSchema).min(1),
  source: z.enum(["user", "model", "policy", "automation"]).optional(),
  modelRecommendation: z.enum(["approve", "deny"]).optional(),
  modelReason: z.string().trim().min(1).max(500).optional(),
  actorAgentId: z.string().min(1).optional(),
});

export type ApprovalRequestedPayload = z.infer<
  typeof approvalRequestedPayloadSchema
>;

export const approvalResolvedPayloadSchema = z
  .object({
    type: z.literal("approval.resolved"),
    approvalId: z.string().min(1),
    nonce: z.string().min(16),
    approved: z.boolean(),
    skipped: z.literal(true).optional(),
    feedback: z.string().trim().min(1).max(2_000).optional(),
    scope: approvalScopeSchema,
    source: z.enum(["user", "model", "policy", "automation"]).optional(),
  })
  .superRefine((value, context) => {
    if (
      ((value.skipped || value.feedback) &&
        (value.approved || value.scope !== "once")) ||
      (value.skipped && value.feedback)
    ) {
      context.addIssue({
        code: "custom",
        message: "Skip and feedback cannot grant approval or be combined",
      });
    }
  });

export const approvalResolutionSchema = z
  .object({
    approvalId: z.string().min(1),
    nonce: z.string().min(16),
    approved: z.boolean(),
    skipped: z.literal(true).optional(),
    feedback: z.string().trim().min(1).max(2_000).optional(),
    scope: approvalScopeSchema,
    source: z.enum(["user", "model", "policy", "automation"]).optional(),
  })
  .superRefine((value, context) => {
    if (
      ((value.skipped || value.feedback) &&
        (value.approved || value.scope !== "once")) ||
      (value.skipped && value.feedback)
    ) {
      context.addIssue({
        code: "custom",
        message: "Skip and feedback cannot grant approval or be combined",
      });
    }
  });

export type ApprovalResolution = z.infer<typeof approvalResolutionSchema>;

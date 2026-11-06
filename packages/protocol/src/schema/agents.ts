import { z } from "zod";

export const childAgentPayloadSchema = z.object({
  type: z.literal("child-agent.status"),
  agentId: z.string().min(1),
  label: z.string().min(1),
  teamId: z.string().min(1).optional(),
  parentAgentId: z.string().min(1).optional(),
  depth: z.number().int().min(1).max(5).optional(),
  subtreeStatus: z
    .enum(["leaf", "running", "blocked", "ready", "integrated"])
    .optional(),
  directChildCount: z.number().int().min(0).max(8).optional(),
  role: z.string().trim().min(1).max(120).optional(),
  dependsOnAgentIds: z.array(z.string().min(1)).max(8).optional(),
  writePaths: z.array(z.string().min(1).max(1_024)).max(32).optional(),
  required: z.boolean().optional(),
  coordinationStatus: z
    .enum(["waiting-dependency", "working", "blocked", "ready-for-integration"])
    .optional(),
  task: z
    .string()
    .max(32 * 1024)
    .optional(),
  status: z.enum([
    "queued",
    "running",
    "blocked",
    "cancelling",
    "completed",
    "failed",
    "cancelled",
  ]),
  health: z.enum(["healthy", "suspect", "stalled"]).optional(),
  startedAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  lastActivityAt: z.string().datetime().optional(),
  currentTool: z.string().min(1).optional(),
  currentToolStartedAt: z.string().datetime().optional(),
  attempt: z.number().int().positive().optional(),
  activity: z
    .string()
    .max(64 * 1024)
    .optional(),
  activityDelta: z
    .string()
    .max(8 * 1024)
    .optional(),
  output: z
    .string()
    .max(64 * 1024)
    .optional(),
  error: z
    .string()
    .max(4 * 1024)
    .optional(),
  /**
   * Custom sub-agent instance identity (D#152): which definition/revision
   * this instance runs, its resolved model, and the invocation id for
   * explicit user references. Metadata only — never the instructions.
   */
  customAgent: z
    .object({
      definitionId: z.string().min(1),
      definitionRevision: z.number().int().positive(),
      name: z.string().min(1),
      providerId: z.string().min(1),
      modelId: z.string().min(1),
      invocationSource: z.enum([
        "user-explicit",
        "model-explicit",
        "model-automatic",
      ]),
      invocationId: z.string().min(1).optional(),
    })
    .optional(),
});

export type ChildAgentPayload = z.infer<typeof childAgentPayloadSchema>;

/**
 * Routing audit record (D#152 PR5): one durable event per custom-agent
 * dispatch decision — acceptance, P1 correction, trigger advisory,
 * free-role fallback, and catalog overflow. invocationSource (who asked)
 * and selectionBasis (why this definition) are recorded separately so a
 * model's semantic choice is never miscounted as a deterministic user
 * invocation. Never carries instructions or task text.
 */
export const customAgentRoutePayloadSchema = z.object({
  type: z.literal("custom-agent.route"),
  schemaVersion: z.literal(1),
  decision: z.enum([
    "accepted",
    "reference-required",
    "advisory",
    "free-role",
    "catalog-disabled",
  ]),
  invocationSource: z.enum([
    "user-explicit",
    "model-explicit",
    "model-automatic",
    "none",
  ]),
  selectionBasis: z.enum([
    "explicit-id",
    "role-exact",
    "trigger-words",
    "none",
  ]),
  parentAgentId: z.string().min(1),
  projectId: z.string().min(1).nullable(),
  /** Stable hash of the turn catalog's sorted definitionId@revision pairs. */
  catalogId: z.string().min(1),
  catalogSize: z.number().int().nonnegative(),
  candidates: z
    .array(
      z.object({
        definitionId: z.string().min(1),
        revision: z.number().int().positive(),
        name: z.string().min(1),
      }),
    )
    .max(32),
  selectedDefinitionId: z.string().min(1).optional(),
  selectedRevision: z.number().int().positive().optional(),
  instanceId: z.string().min(1).optional(),
  /** A CustomAgentErrorCode when the decision rejected the request. */
  errorCode: z.string().min(1).optional(),
  model: z
    .object({
      providerId: z.string().min(1),
      modelId: z.string().min(1),
    })
    .optional(),
  capabilities: z.array(z.string().min(1)).max(64).optional(),
});

export type CustomAgentRoutePayload = z.infer<
  typeof customAgentRoutePayloadSchema
>;

export const agentTeamStatusPayloadSchema = z.object({
  type: z.literal("agent-team.status"),
  teamId: z.string().min(1),
  mission: z.string().trim().min(1).max(2_000),
  status: z.enum([
    "forming",
    "running",
    "blocked",
    "integrating",
    "completed",
    "aborted",
  ]),
  memberAgentIds: z.array(z.string().min(1)).max(64),
  requiredAgentIds: z.array(z.string().min(1)).max(64),
  maxMembers: z.number().int().min(2).max(64),
  maxDepth: z.number().int().min(1).max(5).optional(),
  spawnBudgetRemaining: z.number().int().min(0).max(128).optional(),
  updatedAt: z.string().datetime(),
  error: z
    .string()
    .trim()
    .min(1)
    .max(4 * 1024)
    .optional(),
});

export type AgentTeamStatusPayload = z.infer<
  typeof agentTeamStatusPayloadSchema
>;

export const agentTeamMessagePayloadSchema = z.object({
  type: z.literal("agent-team.message"),
  teamId: z.string().min(1),
  messageId: z.string().min(1),
  sequence: z.number().int().positive(),
  fromAgentId: z.string().min(1),
  recipient: z.string().min(1),
  kind: z.enum(["finding", "request", "blocker", "handoff"]),
  content: z
    .string()
    .trim()
    .min(1)
    .max(8 * 1024),
  createdAt: z.string().datetime(),
});

export type AgentTeamMessagePayload = z.infer<
  typeof agentTeamMessagePayloadSchema
>;

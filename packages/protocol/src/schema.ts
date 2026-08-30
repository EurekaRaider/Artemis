import { z } from "zod";

export const PROTOCOL_VERSION = 4 as const;

export const runModeSchema = z.enum(["execute", "plan", "review"]);
export type RunMode = z.infer<typeof runModeSchema>;

export const approvalPolicySchema = z.enum([
  "ask",
  "agent",
  "full-access",
  "custom",
]);
export type ApprovalPolicy = z.infer<typeof approvalPolicySchema>;

export const APP_LOCALES = [
  "en",
  "zh-CN",
  "zh-TW",
  "ja",
  "ko",
  "es",
  "fr",
  "de",
  "pt-BR",
  "it",
  "ru",
  "ar",
  "hi",
  "id",
] as const;

export const appLocaleSchema = z.enum(APP_LOCALES);
export type AppLocale = z.infer<typeof appLocaleSchema>;

export const appLanguageSchema = z.union([
  z.literal("system"),
  appLocaleSchema,
]);
export type AppLanguage = z.infer<typeof appLanguageSchema>;

export const appThemeSchema = z.enum(["system", "light", "dark"]);
export type AppTheme = z.infer<typeof appThemeSchema>;

export const windowsShellPreferenceSchema = z.enum([
  "auto",
  "powershell7",
  "windows-powershell",
]);
export type WindowsShellPreference = z.infer<
  typeof windowsShellPreferenceSchema
>;

export const shellProfileModeSchema = z.enum([
  "environment",
  "full",
  "disabled",
]);
export type ShellProfileMode = z.infer<typeof shellProfileModeSchema>;

export const shellRuntimeConfigurationSchema = z.object({
  windowsPreference: windowsShellPreferenceSchema,
  profileMode: shellProfileModeSchema,
});
export type ShellRuntimeConfiguration = z.infer<
  typeof shellRuntimeConfigurationSchema
>;

export const DEFAULT_SHELL_RUNTIME_CONFIGURATION: ShellRuntimeConfiguration = {
  windowsPreference: "auto",
  profileMode: "environment",
};

export const contextWindowSchema = z.number().int().min(1_024).max(10_000_000);

const providerThinkingLevelSchema = z.enum([
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

const providerModelSchema = z.object({
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

export const promptImageSchema = z.object({
  name: z.string().trim().min(1).max(255),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
  data: z
    .string()
    .min(1)
    .max(14_000_000)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/u),
});
export type PromptImage = z.infer<typeof promptImageSchema>;
export const MAX_PROMPT_IMAGES = 4;
export const promptImagesSchema = z
  .array(promptImageSchema)
  .max(MAX_PROMPT_IMAGES);

export const promptFileSchema = z.object({
  type: z.literal("file"),
  name: z.string().trim().min(1).max(255),
  mimeType: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/u),
  content: z.string().max(200_000),
});
export type PromptFile = z.infer<typeof promptFileSchema>;
export const promptAttachmentSchema = z.union([
  promptImageSchema,
  promptFileSchema,
]);
export type PromptAttachment = z.infer<typeof promptAttachmentSchema>;
export const MAX_PROMPT_ATTACHMENTS = 10;
export const promptAttachmentsSchema = z
  .array(promptAttachmentSchema)
  .max(MAX_PROMPT_ATTACHMENTS)
  .superRefine((attachments, context) => {
    const imageCount = attachments.filter(
      (attachment) => !("type" in attachment),
    ).length;
    if (imageCount > MAX_PROMPT_IMAGES) {
      context.addIssue({
        code: "custom",
        message: `Attach no more than ${MAX_PROMPT_IMAGES} images.`,
      });
    }
    const fileCharacters = attachments.reduce(
      (total, attachment) =>
        total + ("type" in attachment ? attachment.content.length : 0),
      0,
    );
    if (fileCharacters > 400_000) {
      context.addIssue({
        code: "custom",
        message: "Attached file contents exceed the 400,000 character limit.",
      });
    }
  });

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

export const workspaceTargetSchema = z.enum([
  "local",
  "managed-worktree",
  "permanent-worktree",
]);
export type WorkspaceTarget = z.infer<typeof workspaceTargetSchema>;

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
    .enum(["connection", "stream-stalled", "rate-limit", "provider"])
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

export const toolStartedPayloadSchema = z.object({
  type: z.literal("tool.started"),
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
  toolCallId: z.string().min(1),
  output: z.string().optional(),
  isError: z.boolean(),
});

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

export const approvalResolvedPayloadSchema = z.object({
  type: z.literal("approval.resolved"),
  approvalId: z.string().min(1),
  nonce: z.string().min(16),
  approved: z.boolean(),
  scope: approvalScopeSchema,
  source: z.enum(["user", "model", "policy", "automation"]).optional(),
});

export const MAX_USER_INPUT_QUESTIONS = 3;
export const USER_INPUT_MIN_OPTIONS = 2;
export const USER_INPUT_MAX_OPTIONS = 3;
export const USER_INPUT_QUESTION_ID_MAX_LENGTH = 200;

export const userInputOptionSchema = z.object({
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(240),
  recommended: z.boolean(),
});
export type UserInputOption = z.infer<typeof userInputOptionSchema>;

const userInputOptionsSchema = z
  .array(userInputOptionSchema)
  .min(USER_INPUT_MIN_OPTIONS)
  .max(USER_INPUT_MAX_OPTIONS)
  .superRefine((options, context) => {
    if (options.filter((option) => option.recommended).length !== 1) {
      context.addIssue({
        code: "custom",
        message: "Exactly one user-input option must be recommended",
      });
    }
    const labels = new Set(options.map((option) => option.label));
    if (labels.size !== options.length) {
      context.addIssue({
        code: "custom",
        message: "User-input option labels must be unique",
      });
    }
  });

export const userInputSingleQuestionRequestedPayloadSchema = z
  .object({
    type: z.literal("user-input.requested"),
    kind: z.literal("single-question").optional(),
    requestId: z.string().min(1),
    nonce: z.string().min(16),
    header: z.string().trim().min(1).max(12),
    question: z.string().trim().min(1).max(1_000),
    options: userInputOptionsSchema,
    expiresAt: z.string().datetime({ offset: true }),
    // Declared so the superRefine below can observe the key. Strip (not
    // strict) semantics keep legacy logs replayable: rows persisted by older
    // builds may carry keys this schema no longer knows, and the single
    // write-side gate (store appendEventsCore) already strips unknown keys
    // when events are first persisted.
    questions: z.unknown().optional(),
  })
  .superRefine((payload, context) => {
    // Routing-hole guard: a payload carrying multi-question content must not
    // be silently accepted as single-question with its questions array
    // stripped.
    if (payload.questions !== undefined) {
      context.addIssue({
        code: "custom",
        message:
          "Single-question user-input requests must not carry a questions array",
      });
    }
  });
export const userInputRequestedPayloadSchema =
  userInputSingleQuestionRequestedPayloadSchema;
export type UserInputRequestedPayload = Omit<
  z.infer<typeof userInputRequestedPayloadSchema>,
  "kind" | "questions"
>;

export const userInputQuestionSchema = z.object({
  questionId: z.string().min(1).max(USER_INPUT_QUESTION_ID_MAX_LENGTH),
  question: z.string().trim().min(1).max(1_000),
  options: userInputOptionsSchema,
  expiresAt: z.string().datetime({ offset: true }),
});
export type UserInputQuestion = z.infer<typeof userInputQuestionSchema>;

export const userInputMultiQuestionRequestedPayloadSchema = z
  .object({
    type: z.literal("user-input.requested"),
    kind: z.literal("multi-question"),
    requestId: z.string().min(1),
    nonce: z.string().min(16),
    header: z.string().trim().min(1).max(12),
    questions: z
      .array(userInputQuestionSchema)
      .min(1)
      .max(MAX_USER_INPUT_QUESTIONS),
  })
  .superRefine((payload, context) => {
    const questionIds = payload.questions.map(
      (question) => question.questionId,
    );
    if (new Set(questionIds).size !== questionIds.length) {
      context.addIssue({
        code: "custom",
        message: "User-input question IDs must be unique within a request",
      });
    }
  });
export type UserInputMultiQuestionRequestedPayload = z.infer<
  typeof userInputMultiQuestionRequestedPayloadSchema
>;

export const userInputSingleQuestionResolvedPayloadSchema = z.object({
  type: z.literal("user-input.resolved"),
  kind: z.literal("single-question").optional(),
  requestId: z.string().min(1),
  nonce: z.string().min(16),
  answer: z.string().max(2_000),
  selectedOption: z
    .number()
    .int()
    .min(0)
    .max(USER_INPUT_MAX_OPTIONS - 1)
    .optional(),
  source: z.enum(["user", "timeout", "cancelled"]),
});
export const userInputResolvedPayloadSchema =
  userInputSingleQuestionResolvedPayloadSchema;
export type UserInputResolvedPayload = Omit<
  z.infer<typeof userInputResolvedPayloadSchema>,
  "kind"
>;

export const userInputMultiQuestionResolvedPayloadSchema = z
  .object({
    type: z.literal("user-input.resolved"),
    kind: z.literal("multi-question"),
    requestId: z.string().min(1),
    nonce: z.string().min(16),
    questionId: z.string().min(1).max(USER_INPUT_QUESTION_ID_MAX_LENGTH),
    selectedOption: z.string().trim().min(1).max(80).optional(),
    customAnswer: z.string().trim().min(1).max(2_000).optional(),
    source: z.enum(["user", "timeout", "cancelled"]),
  })
  .superRefine((payload, context) => {
    if (
      (payload.selectedOption === undefined) ===
      (payload.customAnswer === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Resolve one multi-question item with one offered option label or one custom answer",
      });
    }
  });
export type UserInputMultiQuestionResolvedPayload = z.infer<
  typeof userInputMultiQuestionResolvedPayloadSchema
>;

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
});
export type ChildAgentPayload = z.infer<typeof childAgentPayloadSchema>;

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

export const mcpToolUsedPayloadSchema = z.object({
  type: z.literal("mcp.tool.used"),
  toolCallId: z.string().min(1).max(200),
  serverId: z.string().min(1).max(200),
  serverName: z.string().min(1).max(200),
  toolName: z.string().min(1).max(200),
  agentId: z.string().min(1).max(200),
});
export type McpToolUsedPayload = z.infer<typeof mcpToolUsedPayloadSchema>;

const taskSourceHttpUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password
    );
  }, "Task source URL must use HTTP(S) without embedded credentials");

const taskAttachmentSourceAddedPayloadSchema = z.object({
  type: z.literal("task.source.added"),
  sourceId: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(120),
  kind: z.enum(["file", "image"]),
});

const taskWebSearchSourceAddedPayloadSchema = z.object({
  type: z.literal("task.source.added"),
  sourceId: z.string().min(1).max(200),
  kind: z.literal("web-search"),
  query: z.string().trim().min(1).max(500),
  engine: z.string().trim().min(1).max(120),
  resultCount: z.number().int().min(0).max(10),
  searchUrl: taskSourceHttpUrlSchema,
  links: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(500),
        url: taskSourceHttpUrlSchema,
      }),
    )
    .max(10),
});

export const taskSourceAddedPayloadSchema = z.discriminatedUnion("kind", [
  taskAttachmentSourceAddedPayloadSchema,
  taskWebSearchSourceAddedPayloadSchema,
]);
export type TaskSourceAddedPayload = z.infer<
  typeof taskSourceAddedPayloadSchema
>;

export const contextUsagePayloadSchema = z.object({
  type: z.literal("context.usage"),
  tokens: z.number().int().nonnegative().nullable(),
  contextWindow: contextWindowSchema,
  compacting: z.boolean(),
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

export const threadGoalStatusSchema = z.enum([
  "active",
  "paused",
  "blocked",
  "usageLimited",
  "budgetLimited",
  "complete",
]);
export type ThreadGoalStatus = z.infer<typeof threadGoalStatusSchema>;

export const threadGoalSchema = z.object({
  threadId: z.string().min(1),
  goalId: z.string().min(1),
  objective: z.string().trim().min(1).max(4_000),
  status: threadGoalStatusSchema,
  tokenBudget: z.number().int().positive().optional(),
  tokensUsed: z.number().int().nonnegative(),
  timeUsedSeconds: z.number().nonnegative(),
  revision: z.number().int().positive(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type ThreadGoal = z.infer<typeof threadGoalSchema>;

export const threadGoalUpdatedPayloadSchema = z.object({
  type: z.literal("thread.goal.updated"),
  goal: threadGoalSchema,
});

export const threadGoalClearedPayloadSchema = z.object({
  type: z.literal("thread.goal.cleared"),
  goalId: z.string().min(1),
  revision: z.number().int().positive(),
});

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

export const turnCompletedPayloadSchema = z.object({
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

export const agentPayloadSchema = z.discriminatedUnion("type", [
  userMessagePayloadSchema,
  turnStartedPayloadSchema,
  turnActivityPayloadSchema,
  messageSupersededPayloadSchema,
  messageDeltaPayloadSchema,
  toolStartedPayloadSchema,
  toolUpdatedPayloadSchema,
  toolCompletedPayloadSchema,
  approvalRequestedPayloadSchema,
  approvalResolvedPayloadSchema,
  z.discriminatedUnion("kind", [
    userInputMultiQuestionRequestedPayloadSchema,
    userInputSingleQuestionRequestedPayloadSchema,
  ]),
  z.discriminatedUnion("kind", [
    userInputMultiQuestionResolvedPayloadSchema,
    userInputSingleQuestionResolvedPayloadSchema,
  ]),
  fileChangedPayloadSchema,
  turnChangeSetUpdatedPayloadSchema,
  terminalOutputPayloadSchema,
  childAgentPayloadSchema,
  agentTeamStatusPayloadSchema,
  agentTeamMessagePayloadSchema,
  mcpToolUsedPayloadSchema,
  taskSourceAddedPayloadSchema,
  contextUsagePayloadSchema,
  assistantUsagePayloadSchema,
  threadGoalUpdatedPayloadSchema,
  threadGoalClearedPayloadSchema,
  queueUpdatedPayloadSchema,
  queueRecoveredPayloadSchema,
  turnCompletedPayloadSchema,
  turnFailedPayloadSchema,
]);
export type AgentPayload = z.infer<typeof agentPayloadSchema>;

export const agentEventSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  eventId: z.string().min(1),
  threadId: z.string().min(1),
  turnId: z.string().optional(),
  seq: z.number().int().nonnegative(),
  timestamp: z.string().datetime({ offset: true }),
  payload: agentPayloadSchema,
});
export type AgentEvent = z.infer<typeof agentEventSchema>;

export const projectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type Project = z.infer<typeof projectSchema>;

export const threadSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1).optional(),
  title: z.string().min(1),
  goal: threadGoalSchema.optional(),
  mode: runModeSchema,
  target: workspaceTargetSchema,
  status: z.enum(["idle", "running", "waiting-approval", "failed"]),
  sessionFile: z.string().optional(),
  modelSelection: modelSelectionSchema.optional(),
  contextWindow: z.number().int().positive().optional(),
  pinned: z.boolean(),
  archived: z.boolean(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type Thread = z.infer<typeof threadSchema>;

export const taskWorktreeSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  projectId: z.string().min(1),
  path: z.string().min(1),
  target: z.enum(["managed-worktree", "permanent-worktree"]),
  head: z.string().min(1),
  branch: z.string().min(1).optional(),
  status: z.enum(["active", "removed", "missing"]),
  recoveryPath: z.string().min(1).optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type TaskWorktree = z.infer<typeof taskWorktreeSchema>;

export interface AppSnapshot {
  projects: Project[];
  threads: Thread[];
  worktrees: TaskWorktree[];
  events: Record<string, AgentEvent[]>;
  locale: AppLocale;
  platform: "win32" | "darwin" | "other";
  sandbox: {
    available: boolean;
    implementation: string;
  };
}

export const threadCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("thread.create"),
    projectId: z.string().min(1).optional(),
    mode: runModeSchema,
    target: workspaceTargetSchema,
  }),
  z.object({
    type: z.literal("thread.model.set"),
    threadId: z.string().min(1),
    selection: modelSelectionSchema,
    contextWindow: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("thread.archive"),
    threadId: z.string().min(1),
    archived: z.boolean(),
  }),
  z.object({
    type: z.literal("thread.delete"),
    threadId: z.string().min(1),
  }),
  z.object({
    type: z.literal("thread.rename"),
    threadId: z.string().min(1),
    title: z.string().trim().min(1).max(160),
  }),
  z
    .object({
      type: z.literal("thread.goal.set"),
      threadId: z.string().min(1),
      objective: z.string().trim().min(1).max(100_000).optional(),
      status: threadGoalStatusSchema.optional(),
      tokenBudget: z.number().int().positive().nullable().optional(),
      expectedGoalId: z.string().min(1).optional(),
      expectedRevision: z.number().int().positive().optional(),
    })
    .refine(
      (command) =>
        command.objective !== undefined ||
        command.status !== undefined ||
        command.tokenBudget !== undefined,
      { message: "A Goal mutation must set at least one field." },
    ),
  z.object({
    type: z.literal("thread.goal.pause"),
    threadId: z.string().min(1),
  }),
  z.object({
    type: z.literal("thread.goal.resume"),
    threadId: z.string().min(1),
  }),
  z.object({
    type: z.literal("thread.goal.clear"),
    threadId: z.string().min(1),
  }),
  z.object({
    type: z.literal("thread.fork"),
    threadId: z.string().min(1),
    entryId: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("thread.compact"),
    threadId: z.string().min(1),
    instructions: z.string().trim().min(1).max(4_000).optional(),
  }),
  z.object({ type: z.literal("turn.cancel"), threadId: z.string().min(1) }),
  z.object({
    type: z.enum(["turn.queue.clear", "turn.queue.steer"]),
    threadId: z.string().min(1),
  }),
  z.object({
    type: z.literal("turn.queue.steer-item"),
    threadId: z.string().min(1),
    followUpIndex: z.number().int().nonnegative(),
    expectedFollowUp: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    type: z.literal("turn.queue.replace"),
    threadId: z.string().min(1),
    expectedFollowUp: z.array(z.string().min(1)).min(1),
    followUp: z.array(
      z.object({
        sourceIndex: z.number().int().nonnegative(),
        text: z.string().trim().min(1),
      }),
    ),
  }),
  z.object({
    type: z.literal("turn.steer"),
    threadId: z.string().min(1),
    text: z.string().trim().min(1),
    attachments: promptAttachmentsSchema.optional(),
  }),
  z.object({
    type: z.literal("turn.follow-up"),
    threadId: z.string().min(1),
    text: z.string().trim().min(1),
    attachments: promptAttachmentsSchema.optional(),
  }),
]);
export type ThreadCommand = z.infer<typeof threadCommandSchema>;

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

export const worktreeCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("worktree.branchize"),
    threadId: z.string().min(1),
    branchName: z.string().trim().min(1).max(200),
  }),
  z.object({
    type: z.literal("worktree.cleanup"),
    threadId: z.string().min(1),
    force: z.boolean(),
  }),
  z.object({
    type: z.literal("worktree.handoff"),
    threadId: z.string().min(1),
    destination: z.enum(["local", "managed-worktree"]),
  }),
]);
export type WorktreeCommand = z.infer<typeof worktreeCommandSchema>;

export interface TurnStartCommand {
  threadId: string;
  text: string;
  mode: RunMode;
  attachments?: PromptAttachment[];
}

export const approvalResolutionSchema = z.object({
  approvalId: z.string().min(1),
  nonce: z.string().min(16),
  approved: z.boolean(),
  scope: approvalScopeSchema,
  source: z.enum(["user", "model", "policy", "automation"]).optional(),
});
export type ApprovalResolution = z.infer<typeof approvalResolutionSchema>;

export const userInputResolutionSchema = z
  .object({
    requestId: z.string().min(1),
    nonce: z.string().min(16),
    selectedOption: z
      .number()
      .int()
      .min(0)
      .max(USER_INPUT_MAX_OPTIONS - 1)
      .optional(),
    customAnswer: z.string().trim().min(1).max(2_000).optional(),
  })
  .superRefine((resolution, context) => {
    if (
      (resolution.selectedOption === undefined) ===
      (resolution.customAnswer === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "Choose one offered option or provide one custom answer",
      });
    }
  });
export type UserInputResolution = z.infer<typeof userInputResolutionSchema>;

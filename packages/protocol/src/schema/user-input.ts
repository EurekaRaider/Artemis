import { z } from "zod";

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

export const userInputOptionsSchema = z
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
    // stripped. Presence of the key, not its value: IPC structured clone
    // preserves an explicit `questions: undefined` key and zod keeps the
    // declared key in the parse output, so a value check
    // (questions !== undefined) would wave the explicit-undefined form
    // through as single-question.
    if ("questions" in payload) {
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
  skipped: z.literal(true).optional(),
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
    skipped: z.literal(true).optional(),
    questionId: z.string().min(1).max(USER_INPUT_QUESTION_ID_MAX_LENGTH),
    // The chosen option *label*, deliberately named differently from the
    // single-question resolved payload's selectedOption numeric index so the
    // two semantics never share a field name.
    selectedOptionLabel: z.string().trim().min(1).max(80).optional(),
    customAnswer: z.string().trim().min(1).max(2_000).optional(),
    source: z.enum(["user", "timeout", "cancelled"]),
  })
  .superRefine((payload, context) => {
    if (
      Number(payload.selectedOptionLabel !== undefined) +
        Number(payload.customAnswer !== undefined) +
        Number(payload.skipped === true) !==
      1
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

// Legacy IPC command face (decision D#76 PR10C, decision J case 1): the
// single-question resolution stays kind-less by default exactly as before,
// so existing renderer callers keep working without any change; an explicit
// kind:"single-question" is also accepted for symmetry with the resolved
// payload (review batch B3, suggestion 3).
export const userInputSingleQuestionResolutionSchema = z
  .object({
    requestId: z.string().min(1),
    nonce: z.string().min(16),
    skipped: z.literal(true).optional(),
    selectedOption: z
      .number()
      .int()
      .min(0)
      .max(USER_INPUT_MAX_OPTIONS - 1)
      .optional(),
    customAnswer: z.string().trim().min(1).max(2_000).optional(),
    // Optional explicit discriminant, symmetric with the resolved payload's
    // kind:"single-question" (userInputSingleQuestionResolvedPayloadSchema):
    // omitted (legacy) or the exact literal both parse; any other kind value
    // fails this branch's literal check with zod's own invalid-literal error
    // and the union falls through to the multi branch, so a misrouted
    // kind:"multi-question" resolution is judged by multi branch semantics
    // instead of being rejected here with a misleading message.
    kind: z.literal("single-question").optional(),
    // Declared so the superRefine below can observe key presence. Strip (not
    // strict) semantics keep the legacy form tolerant of stray keys this
    // schema no longer knows; multi-question fields must route through the
    // union's multi branch instead of being silently swallowed here.
    questionId: z.unknown().optional(),
    selectedOptionLabel: z.unknown().optional(),
  })
  .superRefine((resolution, context) => {
    if (
      Number(resolution.selectedOption !== undefined) +
        Number(resolution.customAnswer !== undefined) +
        Number(resolution.skipped === true) !==
      1
    ) {
      context.addIssue({
        code: "custom",
        message: "Choose one offered option or provide one custom answer",
      });
    }
    // Routing-hole guard (same shape as the requested payload's questions
    // guard): a resolution carrying multi-question content keys must not be
    // silently accepted as single-question with those keys stripped.
    // Presence of the key, not its value: IPC structured clone preserves an
    // explicit `undefined` key and zod keeps the declared key in the parse
    // output, so a value check would wave the explicit-undefined form
    // through as legacy. The kind key is deliberately absent here — the
    // literal above owns kind validation.
    if ("questionId" in resolution || "selectedOptionLabel" in resolution) {
      context.addIssue({
        code: "custom",
        message:
          "Single-question user-input resolutions must not carry multi-question fields (questionId, selectedOptionLabel)",
      });
    }
  });

export type UserInputSingleQuestionResolution = z.infer<
  typeof userInputSingleQuestionResolutionSchema
>;

// Multi-question IPC command variant (D#76 PR10C, decision J case 1): one
// resolution answers one question of a pending multi-question card. Field
// semantics mirror userInputMultiQuestionResolvedPayloadSchema minus the
// `source` field — the IPC command face never carries provenance; main
// injects source: "user" on the handler path.
export const userInputMultiQuestionResolutionSchema = z
  .object({
    requestId: z.string().min(1),
    nonce: z.string().min(16),
    skipped: z.literal(true).optional(),
    kind: z.literal("multi-question"),
    questionId: z.string().min(1).max(USER_INPUT_QUESTION_ID_MAX_LENGTH),
    // The chosen option *label*, deliberately named differently from the
    // single-question form's selectedOption numeric index so the two
    // semantics never share a field name.
    selectedOptionLabel: z.string().trim().min(1).max(80).optional(),
    customAnswer: z.string().trim().min(1).max(2_000).optional(),
    // Declared undefined-only so the single-question numeric index never
    // rides a multi form, and so the union's inferred type keeps
    // `selectedOption` readable for unchanged consumers
    // (PendingUserInputRegistry.consume).
    selectedOption: z.undefined().optional(),
  })
  .superRefine((resolution, context) => {
    if (
      Number(resolution.selectedOptionLabel !== undefined) +
        Number(resolution.customAnswer !== undefined) +
        Number(resolution.skipped === true) !==
      1
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Resolve one multi-question item with one offered option label or one custom answer",
      });
    }
  });

export type UserInputMultiQuestionResolution = z.infer<
  typeof userInputMultiQuestionResolutionSchema
>;

export const userInputResolutionSchema = z.union([
  userInputSingleQuestionResolutionSchema,
  userInputMultiQuestionResolutionSchema,
]);

export type UserInputResolution = z.infer<typeof userInputResolutionSchema>;

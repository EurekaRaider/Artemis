import { z } from "zod";

import { PROTOCOL_VERSION, runModeSchema } from "./schema.js";

export const AUTOMATION_AUTHORIZATION_VERSION = 1 as const;

const automationTimeZoneSchema = z.string().trim().min(1).max(120);

export const automationScheduleSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("once"),
    at: z.string().datetime({ offset: true }),
    timeZone: automationTimeZoneSchema,
  }),
  z.object({
    kind: z.literal("weekly"),
    daysOfWeek: z
      .array(z.number().int().min(1).max(7))
      .min(1)
      .max(7)
      .refine((days) => new Set(days).size === days.length, {
        message: "Schedule days must be unique.",
      }),
    localTime: z
      .string()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u, "Invalid local time."),
    timeZone: automationTimeZoneSchema,
  }),
]);
export type AutomationSchedule = z.infer<typeof automationScheduleSchema>;

export const automationTargetSchema = z.enum(["local", "managed-worktree"]);
export type AutomationTarget = z.infer<typeof automationTargetSchema>;

export const automationAuthorizationStateSchema = z.enum([
  "not-required",
  "required",
  "authorized",
]);
export type AutomationAuthorizationState = z.infer<
  typeof automationAuthorizationStateSchema
>;

export const automationSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  prompt: z
    .string()
    .trim()
    .min(1)
    .max(32 * 1024),
  mode: runModeSchema,
  target: automationTargetSchema,
  schedule: automationScheduleSchema,
  enabled: z.boolean(),
  authorizationState: automationAuthorizationStateSchema,
  authorizationFingerprint: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .optional(),
  authorizedAt: z.string().datetime({ offset: true }).optional(),
  nextRunAt: z.string().datetime({ offset: true }).optional(),
  lastRunAt: z.string().datetime({ offset: true }).optional(),
  deletedAt: z.string().datetime({ offset: true }).optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type Automation = z.infer<typeof automationSchema>;

export const automationRunTriggerSchema = z.enum([
  "schedule",
  "catch-up",
  "manual",
]);
export type AutomationRunTrigger = z.infer<typeof automationRunTriggerSchema>;

export const automationRunStateSchema = z.enum([
  "starting",
  "running",
  "waiting-approval",
  "completed",
  "failed",
  "skipped",
]);
export type AutomationRunState = z.infer<typeof automationRunStateSchema>;

export const automationRunSchema = z.object({
  id: z.string().min(1),
  automationId: z.string().min(1),
  scheduledFor: z.string().datetime({ offset: true }),
  trigger: automationRunTriggerSchema,
  state: automationRunStateSchema,
  threadId: z.string().min(1).optional(),
  reason: z.string().min(1).max(1_000).optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type AutomationRun = z.infer<typeof automationRunSchema>;

export const automationEventSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  eventId: z.string().min(1),
  timestamp: z.string().datetime({ offset: true }),
  payload: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("automation.upserted"),
      automation: automationSchema,
    }),
    z.object({
      type: z.literal("automation.deleted"),
      automationId: z.string().min(1),
    }),
    z.object({
      type: z.literal("automation-run.upserted"),
      run: automationRunSchema,
    }),
  ]),
});
export type AutomationEvent = z.infer<typeof automationEventSchema>;

export interface AutomationViewState {
  automations: Record<string, Automation>;
  runs: Record<string, AutomationRun>;
  seenEventIds: Record<string, true>;
}

export function createAutomationViewState(): AutomationViewState {
  return { automations: {}, runs: {}, seenEventIds: {} };
}

export function reduceAutomationEvent(
  state: AutomationViewState,
  event: AutomationEvent,
): AutomationViewState {
  if (state.seenEventIds[event.eventId]) return state;
  const next: AutomationViewState = {
    automations: { ...state.automations },
    runs: { ...state.runs },
    seenEventIds: { ...state.seenEventIds, [event.eventId]: true },
  };
  switch (event.payload.type) {
    case "automation.upserted":
      next.automations[event.payload.automation.id] = event.payload.automation;
      break;
    case "automation.deleted":
      delete next.automations[event.payload.automationId];
      break;
    case "automation-run.upserted":
      next.runs[event.payload.run.id] = event.payload.run;
      break;
  }
  return next;
}

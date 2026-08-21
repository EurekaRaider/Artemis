import { createHash } from "node:crypto";
import type {
  AutomationAuthorizationState,
  AutomationSchedule,
  AutomationTarget,
  RunMode,
} from "@artemis/protocol";
import { AUTOMATION_AUTHORIZATION_VERSION } from "@artemis/protocol";

export interface AutomationAuthorizationInput {
  projectId: string;
  prompt: string;
  mode: RunMode;
  target: AutomationTarget;
  schedule: AutomationSchedule;
}

function canonicalSchedule(schedule: AutomationSchedule): unknown {
  return schedule.kind === "weekly" || schedule.kind === "windowed-interval"
    ? {
        ...schedule,
        daysOfWeek: [...schedule.daysOfWeek].sort(
          (left, right) => left - right,
        ),
      }
    : schedule;
}

export function automationAuthorizationFingerprint(
  input: AutomationAuthorizationInput,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        permissionVersion: AUTOMATION_AUTHORIZATION_VERSION,
        projectId: input.projectId,
        prompt: input.prompt.trim(),
        mode: input.mode,
        target: input.target,
        schedule: canonicalSchedule(input.schedule),
      }),
    )
    .digest("hex");
}

export function automationMayAutoApprove(input: {
  automationMode: RunMode;
  authorizationState: AutomationAuthorizationState;
  linkedThreadId: string | undefined;
  requestThreadId: string;
  activeTurnId: string | undefined;
  requestTurnId: string;
}): boolean {
  return (
    input.automationMode === "execute" &&
    input.authorizationState === "authorized" &&
    input.linkedThreadId === input.requestThreadId &&
    input.activeTurnId === input.requestTurnId
  );
}

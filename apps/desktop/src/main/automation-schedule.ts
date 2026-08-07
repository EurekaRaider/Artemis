import { Temporal } from "@js-temporal/polyfill";
import type { AutomationSchedule } from "@artemis/protocol";

function toInstant(value: string): Temporal.Instant {
  return Temporal.Instant.from(value);
}

function scheduledInstant(
  schedule: Extract<AutomationSchedule, { kind: "weekly" }>,
  date: Temporal.PlainDate,
): Temporal.Instant {
  return date
    .toPlainDateTime(Temporal.PlainTime.from(schedule.localTime))
    .toZonedDateTime(schedule.timeZone, { disambiguation: "compatible" })
    .toInstant();
}

export function validateAutomationSchedule(schedule: AutomationSchedule): void {
  if (schedule.kind === "once") {
    toInstant(schedule.at).toZonedDateTimeISO(schedule.timeZone);
    return;
  }
  Temporal.Now.instant().toZonedDateTimeISO(schedule.timeZone);
  Temporal.PlainTime.from(schedule.localTime);
}

export function nextAutomationOccurrence(
  schedule: AutomationSchedule,
  after: string,
): string | undefined {
  validateAutomationSchedule(schedule);
  const afterInstant = toInstant(after);
  if (schedule.kind === "once") {
    const at = toInstant(schedule.at);
    return Temporal.Instant.compare(at, afterInstant) > 0
      ? at.toString({ smallestUnit: "millisecond" })
      : undefined;
  }

  const local = afterInstant.toZonedDateTimeISO(schedule.timeZone);
  for (let offset = 0; offset <= 7; offset += 1) {
    const date = local.toPlainDate().add({ days: offset });
    if (!schedule.daysOfWeek.includes(date.dayOfWeek)) continue;
    const candidate = scheduledInstant(schedule, date);
    if (Temporal.Instant.compare(candidate, afterInstant) > 0) {
      return candidate.toString({ smallestUnit: "millisecond" });
    }
  }
  return undefined;
}

export function latestAutomationOccurrence(
  schedule: AutomationSchedule,
  atOrBefore: string,
): string | undefined {
  validateAutomationSchedule(schedule);
  const boundary = toInstant(atOrBefore);
  if (schedule.kind === "once") {
    const at = toInstant(schedule.at);
    return Temporal.Instant.compare(at, boundary) <= 0
      ? at.toString({ smallestUnit: "millisecond" })
      : undefined;
  }

  const local = boundary.toZonedDateTimeISO(schedule.timeZone);
  for (let offset = 0; offset <= 7; offset += 1) {
    const date = local.toPlainDate().subtract({ days: offset });
    if (!schedule.daysOfWeek.includes(date.dayOfWeek)) continue;
    const candidate = scheduledInstant(schedule, date);
    if (Temporal.Instant.compare(candidate, boundary) <= 0) {
      return candidate.toString({ smallestUnit: "millisecond" });
    }
  }
  return undefined;
}

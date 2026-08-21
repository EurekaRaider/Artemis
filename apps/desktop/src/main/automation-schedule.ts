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

function scheduledWindowInstant(
  schedule: Extract<AutomationSchedule, { kind: "windowed-interval" }>,
  date: Temporal.PlainDate,
  time: string,
): Temporal.Instant {
  return date
    .toPlainDateTime(Temporal.PlainTime.from(time))
    .toZonedDateTime(schedule.timeZone, { disambiguation: "compatible" })
    .toInstant();
}

function windowBounds(
  schedule: Extract<AutomationSchedule, { kind: "windowed-interval" }>,
  date: Temporal.PlainDate,
): { start: Temporal.Instant; end: Temporal.Instant } | undefined {
  const startTime = Temporal.PlainTime.from(schedule.startTime);
  const endTime = Temporal.PlainTime.from(schedule.endTime);
  const endDate =
    Temporal.PlainTime.compare(endTime, startTime) < 0
      ? date.add({ days: 1 })
      : date;
  const start = scheduledWindowInstant(schedule, date, schedule.startTime);
  const end = scheduledWindowInstant(schedule, endDate, schedule.endTime);
  return Temporal.Instant.compare(end, start) > 0 ? { start, end } : undefined;
}

function advanceWindowInterval(
  value: Temporal.Instant,
  schedule: Extract<AutomationSchedule, { kind: "windowed-interval" }>,
): Temporal.Instant {
  return schedule.unit === "minutes"
    ? value.add({ minutes: schedule.every })
    : value.add({ hours: schedule.every });
}

function nextWindowedIntervalOccurrence(
  schedule: Extract<AutomationSchedule, { kind: "windowed-interval" }>,
  after: Temporal.Instant,
): Temporal.Instant | undefined {
  const local = after.toZonedDateTimeISO(schedule.timeZone);
  const startOffset = schedule.endTime < schedule.startTime ? -1 : 0;
  for (let offset = startOffset; offset <= 8; offset += 1) {
    const date = local.toPlainDate().add({ days: offset });
    if (!schedule.daysOfWeek.includes(date.dayOfWeek)) continue;
    const window = windowBounds(schedule, date);
    if (!window || Temporal.Instant.compare(window.end, after) <= 0) continue;

    for (
      let candidate = window.start;
      Temporal.Instant.compare(candidate, window.end) <= 0;
      candidate = advanceWindowInterval(candidate, schedule)
    ) {
      if (Temporal.Instant.compare(candidate, after) > 0) return candidate;
    }
  }
  return undefined;
}

function latestWindowedIntervalOccurrence(
  schedule: Extract<AutomationSchedule, { kind: "windowed-interval" }>,
  atOrBefore: Temporal.Instant,
): Temporal.Instant | undefined {
  const local = atOrBefore.toZonedDateTimeISO(schedule.timeZone);
  for (let offset = 0; offset <= 8; offset += 1) {
    const date = local.toPlainDate().subtract({ days: offset });
    if (!schedule.daysOfWeek.includes(date.dayOfWeek)) continue;
    const window = windowBounds(schedule, date);
    if (!window || Temporal.Instant.compare(window.start, atOrBefore) > 0) {
      continue;
    }

    let latest: Temporal.Instant | undefined;
    for (
      let candidate = window.start;
      Temporal.Instant.compare(candidate, window.end) <= 0 &&
      Temporal.Instant.compare(candidate, atOrBefore) <= 0;
      candidate = advanceWindowInterval(candidate, schedule)
    ) {
      latest = candidate;
    }
    if (latest) return latest;
  }
  return undefined;
}

function intervalMilliseconds(
  schedule: Extract<AutomationSchedule, { kind: "interval" }>,
): number {
  const unitMilliseconds = {
    minutes: 60_000,
    hours: 60 * 60_000,
    days: 24 * 60 * 60_000,
  }[schedule.unit];
  return schedule.every * unitMilliseconds;
}

export function validateAutomationSchedule(schedule: AutomationSchedule): void {
  if (schedule.kind === "once") {
    toInstant(schedule.at).toZonedDateTimeISO(schedule.timeZone);
    return;
  }
  if (schedule.kind === "interval") return;
  Temporal.Now.instant().toZonedDateTimeISO(schedule.timeZone);
  if (schedule.kind === "windowed-interval") {
    Temporal.PlainTime.from(schedule.startTime);
    Temporal.PlainTime.from(schedule.endTime);
    return;
  }
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
  if (schedule.kind === "interval") {
    return Temporal.Instant.fromEpochMilliseconds(
      afterInstant.epochMilliseconds + intervalMilliseconds(schedule),
    ).toString({ smallestUnit: "millisecond" });
  }
  if (schedule.kind === "windowed-interval") {
    return nextWindowedIntervalOccurrence(schedule, afterInstant)?.toString({
      smallestUnit: "millisecond",
    });
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
  if (schedule.kind === "interval") {
    // Interval schedules need their persisted nextRunAt anchor to identify a
    // missed occurrence. The scheduler supplies that anchor directly.
    return undefined;
  }
  if (schedule.kind === "windowed-interval") {
    return latestWindowedIntervalOccurrence(schedule, boundary)?.toString({
      smallestUnit: "millisecond",
    });
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

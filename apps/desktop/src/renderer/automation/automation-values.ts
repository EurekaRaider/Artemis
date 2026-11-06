import { UI_COPY } from "../../shared/i18n/ui-copy.js";
import { Temporal } from "@js-temporal/polyfill";
import {
  type Automation,
  type AutomationSchedule,
  type AutomationTarget,
  type AppLocale,
  type ModelSelection,
  type Project,
  type RunMode,
} from "@artemis/protocol";

export const text = UI_COPY.AutomationPage_text;

export interface AutomationDraft {
  id?: string;
  projectId: string;
  name: string;
  prompt: string;
  mode: RunMode;
  target: AutomationTarget;
  preset: SchedulePreset;
  date: string;
  time: string;
  timeZone: string;
  daysOfWeek: number[];
  intervalEvery: number;
  intervalUnit: IntervalUnit;
  windowStart: string;
  windowEnd: string;
  windowIntervalUnit: WindowedIntervalUnit;
  enabled: boolean;
  modelSelection?: ModelSelection | undefined;
}

export type Locale = AppLocale;

export type SchedulePreset =
  "once" | "interval" | "windowed-interval" | "daily" | "weekdays" | "weekly";

export type IntervalUnit = Extract<
  AutomationSchedule,
  { kind: "interval" }
>["unit"];

export type WindowedIntervalUnit = Extract<
  AutomationSchedule,
  { kind: "windowed-interval" }
>["unit"];

export function scheduleForDraft(draft: AutomationDraft): AutomationSchedule {
  if (draft.preset === "interval") {
    return {
      kind: "interval",
      every: draft.intervalEvery,
      unit: draft.intervalUnit,
    };
  }
  if (draft.preset === "windowed-interval") {
    return {
      kind: "windowed-interval",
      every: draft.intervalEvery,
      unit: draft.windowIntervalUnit,
      startTime: draft.windowStart,
      endTime: draft.windowEnd,
      daysOfWeek: draft.daysOfWeek,
      timeZone: draft.timeZone,
    };
  }
  if (draft.preset === "once") {
    const instant = Temporal.PlainDateTime.from(`${draft.date}T${draft.time}`)
      .toZonedDateTime(draft.timeZone, { disambiguation: "compatible" })
      .toInstant();
    return {
      kind: "once",
      at: instant.toString({ smallestUnit: "millisecond" }),
      timeZone: draft.timeZone,
    };
  }
  return {
    kind: "weekly",
    daysOfWeek:
      draft.preset === "daily"
        ? [1, 2, 3, 4, 5, 6, 7]
        : draft.preset === "weekdays"
          ? [1, 2, 3, 4, 5]
          : draft.daysOfWeek,
    localTime: draft.time,
    timeZone: draft.timeZone,
  };
}

export function defaultDraft(projectId: string): AutomationDraft {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const tomorrow = Temporal.Now.instant()
    .toZonedDateTimeISO(timeZone)
    .add({ days: 1 });
  return {
    projectId,
    name: "",
    prompt: "",
    mode: "plan",
    target: "local",
    preset: "daily",
    date: tomorrow.toPlainDate().toString(),
    time: "09:00",
    timeZone,
    daysOfWeek: [1],
    intervalEvery: 30,
    intervalUnit: "minutes",
    windowStart: "09:00",
    windowEnd: "18:00",
    windowIntervalUnit: "minutes",
    enabled: true,
  };
}

export function draftForAutomation(automation: Automation): AutomationDraft {
  if (automation.schedule.kind === "windowed-interval") {
    const tomorrow = Temporal.Now.instant()
      .toZonedDateTimeISO(automation.schedule.timeZone)
      .add({ days: 1 });
    return {
      id: automation.id,
      projectId: automation.projectId,
      name: automation.name,
      prompt: automation.prompt,
      mode: automation.mode,
      target: automation.target,
      preset: "windowed-interval",
      date: tomorrow.toPlainDate().toString(),
      time: automation.schedule.startTime,
      timeZone: automation.schedule.timeZone,
      daysOfWeek: automation.schedule.daysOfWeek,
      intervalEvery: automation.schedule.every,
      intervalUnit: "minutes",
      windowStart: automation.schedule.startTime,
      windowEnd: automation.schedule.endTime,
      windowIntervalUnit: automation.schedule.unit,
      enabled: automation.enabled,
    };
  }
  if (automation.schedule.kind === "interval") {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const tomorrow = Temporal.Now.instant()
      .toZonedDateTimeISO(timeZone)
      .add({ days: 1 });
    return {
      id: automation.id,
      projectId: automation.projectId,
      name: automation.name,
      prompt: automation.prompt,
      mode: automation.mode,
      target: automation.target,
      preset: "interval",
      date: tomorrow.toPlainDate().toString(),
      time: "09:00",
      timeZone,
      daysOfWeek: [1],
      intervalEvery: automation.schedule.every,
      intervalUnit: automation.schedule.unit,
      windowStart: "09:00",
      windowEnd: "18:00",
      windowIntervalUnit: "minutes",
      enabled: automation.enabled,
    };
  }
  if (automation.schedule.kind === "once") {
    const local = Temporal.Instant.from(
      automation.schedule.at,
    ).toZonedDateTimeISO(automation.schedule.timeZone);
    return {
      id: automation.id,
      projectId: automation.projectId,
      name: automation.name,
      prompt: automation.prompt,
      mode: automation.mode,
      target: automation.target,
      preset: "once",
      date: local.toPlainDate().toString(),
      time: local.toPlainTime().toString({ smallestUnit: "minute" }),
      timeZone: automation.schedule.timeZone,
      daysOfWeek: [local.dayOfWeek],
      intervalEvery: 30,
      intervalUnit: "minutes",
      windowStart: "09:00",
      windowEnd: "18:00",
      windowIntervalUnit: "minutes",
      enabled: automation.enabled,
    };
  }
  const days = [...automation.schedule.daysOfWeek].sort(
    (left, right) => left - right,
  );
  const preset: SchedulePreset =
    days.join(",") === "1,2,3,4,5,6,7"
      ? "daily"
      : days.join(",") === "1,2,3,4,5"
        ? "weekdays"
        : "weekly";
  return {
    id: automation.id,
    projectId: automation.projectId,
    name: automation.name,
    prompt: automation.prompt,
    mode: automation.mode,
    target: automation.target,
    preset,
    date: Temporal.Now.instant()
      .toZonedDateTimeISO(automation.schedule.timeZone)
      .add({ days: 1 })
      .toPlainDate()
      .toString(),
    time: automation.schedule.localTime,
    timeZone: automation.schedule.timeZone,
    daysOfWeek: days,
    intervalEvery: 30,
    intervalUnit: "minutes",
    windowStart: "09:00",
    windowEnd: "18:00",
    windowIntervalUnit: "minutes",
    enabled: automation.enabled,
  };
}

export function projectSelectOptions(
  projects: readonly Project[],
  reservedLabels: readonly string[] = [],
): Array<{ label: string; value: string }> {
  const nameCounts = new Map<string, number>();
  for (const project of projects) {
    const key = normalizedOptionLabel(project.name);
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }

  const usedLabels = new Set(reservedLabels.map(normalizedOptionLabel));
  return projects.map((project) => {
    const nameKey = normalizedOptionLabel(project.name);
    let label =
      (nameCounts.get(nameKey) ?? 0) > 1 || usedLabels.has(nameKey)
        ? `${project.name} — ${project.path}`
        : project.name;
    if (usedLabels.has(normalizedOptionLabel(label))) {
      label = `${label} — ${project.id}`;
    }
    usedLabels.add(normalizedOptionLabel(label));
    return { label, value: project.id };
  });
}

export function normalizedOptionLabel(label: string): string {
  return label
    .normalize("NFKC")
    .replace(/[\p{Default_Ignorable_Code_Point}\p{Cc}]+/gu, "")
    .replace(/\p{White_Space}+/gu, " ")
    .trim()
    .toLowerCase();
}

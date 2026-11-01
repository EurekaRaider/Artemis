import type { AppLocale as Locale, Automation } from "@artemis/protocol";
import { makeUiCopy } from "../../shared/i18n/ui-text.js";
import { UI_COPY } from "../../shared/i18n/ui-copy.js";
const text = UI_COPY.AutomationPage_text;

export const weekLabels = makeUiCopy((locale) =>
  Array.from({ length: 7 }, (_, day) =>
    new Intl.DateTimeFormat(locale, {
      weekday: locale.startsWith("zh") ? "narrow" : "short",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(2024, 0, day + 1))),
  ),
);

export function formatDate(
  value: string | undefined,
  locale: Locale,
  timeZone?: string,
): string {
  if (!value) return text[locale].never;
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function scheduleLabel(
  automation: Pick<Automation, "schedule">,
  locale: Locale,
): string {
  const schedule = automation.schedule;
  const labels = text[locale];
  if (schedule.kind === "interval") {
    return `${labels.interval} ${schedule.every} ${labels[schedule.unit]}`;
  }
  if (schedule.kind === "windowed-interval") {
    const days = schedule.daysOfWeek
      .map((day) => weekLabels[locale][day - 1])
      .join(locale.startsWith("zh") ? "、" : ", ");
    return `${days} · ${schedule.startTime}–${schedule.endTime} · ${labels.interval} ${schedule.every} ${labels[schedule.unit]}`;
  }
  if (schedule.kind === "once") {
    return `${labels.once} · ${formatDate(schedule.at, locale, schedule.timeZone)}`;
  }
  const dayKey = [...schedule.daysOfWeek].sort((a, b) => a - b).join(",");
  const days =
    dayKey === "1,2,3,4,5,6,7"
      ? labels.daily
      : dayKey === "1,2,3,4,5"
        ? labels.weekdays
        : `${labels.weekly}${locale.startsWith("zh") ? "" : " "}${schedule.daysOfWeek
            .map((day) => weekLabels[locale][day - 1])
            .join(locale.startsWith("zh") ? "、" : ", ")}`;
  return `${days} ${schedule.localTime}`;
}

export function scheduleTimeZone(
  automation: Pick<Automation, "schedule">,
): string | undefined {
  const zone =
    "timeZone" in automation.schedule
      ? automation.schedule.timeZone
      : undefined;
  return zone && zone !== Intl.DateTimeFormat().resolvedOptions().timeZone
    ? zone
    : undefined;
}

export function nextRunLabel(
  automation: Pick<Automation, "nextRunAt" | "schedule">,
  locale: Locale,
): string {
  if (!automation.nextRunAt) return text[locale].never;
  const timeZone =
    "timeZone" in automation.schedule
      ? automation.schedule.timeZone
      : undefined;
  const date = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    timeZone,
  }).format(new Date(automation.nextRunAt));
  return `${text[locale].nextRun} ${date}`;
}

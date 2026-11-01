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

export function formatDate(value: string | undefined, locale: Locale): string {
  if (!value) return text[locale].never;
  return new Intl.DateTimeFormat(locale, {
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
      .join(" ");
    return `${days} · ${schedule.startTime}–${schedule.endTime} · ${labels.interval} ${schedule.every} ${labels[schedule.unit]} · ${schedule.timeZone}`;
  }
  if (schedule.kind === "once") {
    return `${labels.once} · ${formatDate(schedule.at, locale)} · ${schedule.timeZone}`;
  }
  const dayKey = [...schedule.daysOfWeek].sort((a, b) => a - b).join(",");
  const days =
    dayKey === "1,2,3,4,5,6,7"
      ? labels.daily
      : dayKey === "1,2,3,4,5"
        ? labels.weekdays
        : `${labels.weekly} ${schedule.daysOfWeek
            .map((day) => weekLabels[locale][day - 1])
            .join(" ")}`;
  return `${days} · ${schedule.localTime} · ${schedule.timeZone}`;
}

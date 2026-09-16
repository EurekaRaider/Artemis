export const PROJECT_SIDEBAR_WIDTH_DEFAULT = 280;
export const PROJECT_SIDEBAR_WIDTH_MIN = 208;
export const PROJECT_SIDEBAR_WIDTH_MAX = 420;

export function formatSidebarTime(
  timestamp: string,
  now: number,
  locale: string,
): string {
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) return "";
  const minutes = Math.max(0, Math.floor((now - time) / 60_000));
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (minutes < 1) return relative.format(0, "second");
  if (minutes < 60) return relative.format(-minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return relative.format(-hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 7) return relative.format(-days, "day");
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  }).format(time);
}

export function clampProjectSidebarWidth(width: number): number {
  return Math.max(
    PROJECT_SIDEBAR_WIDTH_MIN,
    Math.min(PROJECT_SIDEBAR_WIDTH_MAX, Math.round(width)),
  );
}

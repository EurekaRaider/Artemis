import type { AgentEvent } from "@artemis/protocol";

export type TokenUsageLocale = "en" | "zh-CN";
export type TokenUsageView = "daily" | "weekly" | "cumulative";

export interface TokenUsageCell {
  date: string;
  weekStart: string;
  dailyTokens: number;
  weeklyTokens: number;
  cumulativeTokens: number;
}

export const TOKEN_USAGE_COPY = {
  en: {
    title: "Token usage",
    subtitle: "Model usage recorded by Artemis",
    activity: "Token activity",
    daily: "Daily",
    weekly: "Weekly",
    cumulative: "Cumulative",
    totalTokens: "Total Tokens",
    peakDay: "Peak daily Tokens",
    peakWeek: "Peak weekly Tokens",
    activeDays: "Active days",
    longestStreak: "Longest streak",
    days: "days",
    loading: "Loading usage…",
    empty: "Token usage will appear after your next model response.",
  },
  "zh-CN": {
    title: "Token 用量",
    subtitle: "Artemis 记录的模型调用用量",
    activity: "Token 活动",
    daily: "每日",
    weekly: "每周",
    cumulative: "累计",
    totalTokens: "累计 Token 数",
    peakDay: "单日峰值 Token 数",
    peakWeek: "单周峰值 Token 数",
    activeDays: "活跃天数",
    longestStreak: "最长连续天数",
    days: "天",
    loading: "正在加载用量…",
    empty: "下一次模型回复后，这里会显示 Token 用量。",
  },
} as const;

function dateKey(timestamp: string | number | Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function weekStart(date: string): string {
  const day = new Date(`${date}T12:00:00.000Z`).getUTCDay();
  return addDays(date, -((day + 6) % 7));
}

export function buildTokenUsageCells(
  events: readonly AgentEvent[],
  options: {
    timeZone: string;
    startDate?: string;
    endDate?: string;
  },
): TokenUsageCell[] {
  const daily = new Map<string, number>();
  const seen = new Set<string>();
  for (const event of events) {
    if (seen.has(event.eventId) || event.payload.type !== "assistant.usage") {
      continue;
    }
    seen.add(event.eventId);
    const day = dateKey(event.timestamp, options.timeZone);
    daily.set(day, (daily.get(day) ?? 0) + event.payload.totalTokens);
  }

  const populatedDates = [...daily.keys()].sort();
  const startDate = options.startDate ?? populatedDates.at(0);
  const endDate = options.endDate ?? populatedDates.at(-1);
  if (!startDate || !endDate || startDate > endDate) return [];

  const weekly = new Map<string, number>();
  for (const [day, tokens] of daily) {
    const week = weekStart(day);
    weekly.set(week, (weekly.get(week) ?? 0) + tokens);
  }

  const allDaily = [...daily.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  let cumulativeTokens = 0;
  let dailyIndex = 0;
  while (dailyIndex < allDaily.length && allDaily[dailyIndex]![0] < startDate) {
    cumulativeTokens += allDaily[dailyIndex]![1];
    dailyIndex += 1;
  }

  const cells: TokenUsageCell[] = [];
  for (
    let current = startDate;
    current <= endDate;
    current = addDays(current, 1)
  ) {
    while (
      dailyIndex < allDaily.length &&
      allDaily[dailyIndex]![0] === current
    ) {
      cumulativeTokens += allDaily[dailyIndex]![1];
      dailyIndex += 1;
    }
    const currentWeek = weekStart(current);
    cells.push({
      date: current,
      weekStart: currentWeek,
      dailyTokens: daily.get(current) ?? 0,
      weeklyTokens: weekly.get(currentWeek) ?? 0,
      cumulativeTokens,
    });
  }
  return cells;
}

export function tokenUsageValue(
  cell: TokenUsageCell,
  view: TokenUsageView,
): number {
  switch (view) {
    case "daily":
      return cell.dailyTokens;
    case "weekly":
      return cell.weeklyTokens;
    case "cumulative":
      return cell.cumulativeTokens;
  }
}

export function formatTokenUsageTooltip(
  cell: TokenUsageCell,
  view: TokenUsageView,
  locale: TokenUsageLocale,
): string {
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${cell.date}T12:00:00.000Z`));
  const value = new Intl.NumberFormat(locale).format(
    tokenUsageValue(cell, view),
  );
  if (locale === "zh-CN") {
    switch (view) {
      case "daily":
        return `${date}使用了 ${value} 个 Token`;
      case "weekly":
        return `${date}当周使用了 ${value} 个 Token`;
      case "cumulative":
        return `截至${date}累计使用 ${value} 个 Token`;
    }
  }
  switch (view) {
    case "daily":
      return `${date} used ${value} Tokens`;
    case "weekly":
      return `Week containing ${date} used ${value} Tokens`;
    case "cumulative":
      return `Through ${date}, ${value} Tokens used`;
  }
}

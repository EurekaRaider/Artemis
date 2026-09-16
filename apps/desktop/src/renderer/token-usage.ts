import { UI_COPY } from "../shared/ui-copy.js";
import type { AgentEvent, AppLocale } from "@artemis/protocol";

export type TokenUsageLocale = AppLocale;
export type TokenUsageView = "daily" | "weekly" | "cumulative";

export interface TokenUsageCell {
  date: string;
  weekStart: string;
  dailyTokens: number;
  weeklyTokens: number;
  cumulativeTokens: number;
}

export interface CacheUsageMetrics {
  usageEvents: number;
  reportedEvents: number;
  reportedInputTokens: number;
  cacheReadTokens: number;
  hitRate?: number;
  coverage: number;
  policies: Record<"disabled" | "short" | "long" | "explicit-30m", number>;
}

export interface TokenUsageModelSummary {
  key: string;
  providerId?: string;
  modelId?: string;
  usageEvents: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheHitTokens: number;
  cacheHitRate?: number;
  totalTokens: number;
}

export const ALL_USAGE_MODELS = "all";
export const UNATTRIBUTED_USAGE_MODEL = "unattributed";

export const TOKEN_USAGE_COPY = UI_COPY.token_usage_TOKEN_USAGE_COPY;

export function tokenUsageModelKey(event: AgentEvent): string | undefined {
  if (event.payload.type !== "assistant.usage") return undefined;
  if (!event.payload.providerId || !event.payload.modelId) {
    return UNATTRIBUTED_USAGE_MODEL;
  }
  return `${encodeURIComponent(event.payload.providerId)}:${encodeURIComponent(event.payload.modelId)}`;
}

export function filterTokenUsageEvents(
  events: readonly AgentEvent[],
  modelKey: string,
): AgentEvent[] {
  if (modelKey === ALL_USAGE_MODELS) {
    return events.filter((event) => event.payload.type === "assistant.usage");
  }
  return events.filter((event) => tokenUsageModelKey(event) === modelKey);
}

export function buildTokenUsageByModel(
  events: readonly AgentEvent[],
): TokenUsageModelSummary[] {
  const models = new Map<string, TokenUsageModelSummary>();
  const eventsByModel = new Map<string, AgentEvent[]>();
  const seen = new Set<string>();
  for (const event of events) {
    if (seen.has(event.eventId) || event.payload.type !== "assistant.usage") {
      continue;
    }
    seen.add(event.eventId);
    const key = tokenUsageModelKey(event)!;
    const modelEvents = eventsByModel.get(key) ?? [];
    modelEvents.push(event);
    eventsByModel.set(key, modelEvents);
    const current = models.get(key) ?? {
      key,
      ...(event.payload.providerId
        ? { providerId: event.payload.providerId }
        : {}),
      ...(event.payload.modelId ? { modelId: event.payload.modelId } : {}),
      usageEvents: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cacheHitTokens: 0,
      totalTokens: 0,
    };
    current.usageEvents += 1;
    current.inputTokens += event.payload.inputTokens;
    current.outputTokens += event.payload.outputTokens;
    current.cacheReadTokens += event.payload.cacheReadTokens;
    current.cacheWriteTokens += event.payload.cacheWriteTokens;
    current.cacheHitTokens +=
      event.payload.cacheReadTokens + event.payload.cacheWriteTokens;
    current.totalTokens += event.payload.totalTokens;
    models.set(key, current);
  }
  return [...models.values()]
    .map((model) => {
      const cacheHitRate = buildCacheUsageMetrics(
        eventsByModel.get(model.key) ?? [],
      ).hitRate;
      return cacheHitRate === undefined ? model : { ...model, cacheHitRate };
    })
    .sort(
      (left, right) =>
        right.totalTokens - left.totalTokens ||
        left.key.localeCompare(right.key),
    );
}

export function tokenUsageModelsForTable(
  models: readonly TokenUsageModelSummary[],
): TokenUsageModelSummary[] {
  return models.filter((model) => model.key !== UNATTRIBUTED_USAGE_MODEL);
}

export function buildCacheUsageMetrics(
  events: readonly AgentEvent[],
): CacheUsageMetrics {
  const metrics: CacheUsageMetrics = {
    usageEvents: 0,
    reportedEvents: 0,
    reportedInputTokens: 0,
    cacheReadTokens: 0,
    coverage: 0,
    policies: {
      disabled: 0,
      short: 0,
      long: 0,
      "explicit-30m": 0,
    },
  };
  const reportingCacheKeys = new Set<string>();
  for (const event of events) {
    if (event.payload.type !== "assistant.usage") continue;
    if (
      (event.payload.cacheReadReported === true ||
        event.payload.cacheReadTokens > 0) &&
      event.payload.cacheKeyFingerprint
    ) {
      reportingCacheKeys.add(event.payload.cacheKeyFingerprint);
    }
  }
  const seen = new Set<string>();
  for (const event of events) {
    if (seen.has(event.eventId) || event.payload.type !== "assistant.usage") {
      continue;
    }
    seen.add(event.eventId);
    metrics.usageEvents += 1;
    if (event.payload.cachePolicy) {
      metrics.policies[event.payload.cachePolicy] += 1;
    }
    const cacheReadReported =
      event.payload.cacheReadReported === true ||
      event.payload.cacheReadTokens > 0 ||
      (event.payload.cacheKeyFingerprint !== undefined &&
        reportingCacheKeys.has(event.payload.cacheKeyFingerprint));
    if (!cacheReadReported) continue;
    metrics.reportedEvents += 1;
    metrics.cacheReadTokens += event.payload.cacheReadTokens;
    metrics.reportedInputTokens +=
      event.payload.inputTokens +
      event.payload.cacheReadTokens +
      event.payload.cacheWriteTokens;
  }
  metrics.coverage =
    metrics.usageEvents === 0
      ? 0
      : metrics.reportedEvents / metrics.usageEvents;
  if (metrics.reportedEvents > 0) {
    metrics.hitRate =
      metrics.reportedInputTokens === 0
        ? 0
        : metrics.cacheReadTokens / metrics.reportedInputTokens;
  }
  return metrics;
}

const TOKEN_USAGE_TOOLTIP_COPY = UI_COPY.token_usage_TOKEN_USAGE_TOOLTIP_COPY;

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
  const template = TOKEN_USAGE_TOOLTIP_COPY[locale][view];
  return template.replace("{{date}}", date).replace("{{value}}", value);
}

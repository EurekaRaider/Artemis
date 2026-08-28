import type { AgentEvent, AppLocale } from "@artemis/protocol";

import { localizedCopy } from "../shared/i18n-resources.js";
import { legacyLocale } from "../shared/locales.js";

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

export const TOKEN_USAGE_COPY = {
  en: {
    title: "Token usage",
    subtitle: "Model usage recorded by Artemis",
    activity: "Token activity",
    modelFilter: "Model",
    allModels: "All models",
    unattributedModel: "Earlier usage (model unavailable)",
    usageByModel: "Usage by model",
    modelColumn: "Model",
    dailyTab: "Daily",
    weeklyTab: "Weekly",
    cumulativeTab: "Cumulative",
    totalTokens: "Total Tokens",
    peakDay: "Peak daily Tokens",
    peakWeek: "Peak weekly Tokens",
    activeDays: "Active days",
    longestStreak: "Longest streak",
    insights: "Activity insights",
    averageActiveDay: "Average per active day",
    mostActiveDay: "Most active day",
    currentStreak: "Current streak",
    recordedSpan: "Recorded activity",
    recordedResponses: "Recorded responses",
    tokenComposition: "Token composition",
    inputTokens: "Input Tokens",
    outputTokens: "Output Tokens",
    cacheReadTokens: "Cache read Tokens",
    cacheWriteTokens: "Cache write Tokens",
    cacheHitTokens: "Cache hit Tokens",
    cacheHitRate: "Cache hit rate",
    cacheHitRateDescription:
      "Cache read Tokens divided by cache-reported input Tokens (input + cache read + cache write).",
    cacheDataCoverage: "Cache data coverage",
    automaticPolicyDistribution: "Automatic cache policies",
    policyDisabled: "Disabled",
    policyShort: "Short",
    policyLong: "24h",
    policyExplicit30m: "Explicit 30m",
    days: "days",
    ofDays: "of {total} days",
    loading: "Loading usage…",
    empty: "Token usage will appear after your next model response.",
    error: "Past usage could not be loaded. Live usage will still be recorded.",
  },
  "zh-CN": {
    title: "Token 用量",
    subtitle: "Artemis 记录的模型调用用量",
    activity: "Token 活动",
    modelFilter: "模型",
    allModels: "全部模型",
    unattributedModel: "较早用量（模型信息不可用）",
    usageByModel: "按模型统计",
    modelColumn: "模型",
    dailyTab: "每日",
    weeklyTab: "每周",
    cumulativeTab: "累计",
    totalTokens: "累计 Token 数",
    peakDay: "单日峰值 Token 数",
    peakWeek: "单周峰值 Token 数",
    activeDays: "活跃天数",
    longestStreak: "最长连续天数",
    insights: "活动观察",
    averageActiveDay: "平均活跃日用量",
    mostActiveDay: "最活跃日期",
    currentStreak: "当前连续天数",
    recordedSpan: "有记录的活跃度",
    recordedResponses: "已记录的模型回复",
    tokenComposition: "Token 构成",
    inputTokens: "输入 Token",
    outputTokens: "输出 Token",
    cacheReadTokens: "缓存读取 Token",
    cacheWriteTokens: "缓存写入 Token",
    cacheHitTokens: "缓存命中 Token",
    cacheHitRate: "缓存命中率",
    cacheHitRateDescription:
      "缓存读取 Token ÷ 已报告缓存数据的输入 Token（输入 + 缓存读取 + 缓存写入）。",
    cacheDataCoverage: "缓存数据覆盖率",
    automaticPolicyDistribution: "自动缓存策略分布",
    policyDisabled: "禁用",
    policyShort: "短缓存",
    policyLong: "24 小时",
    policyExplicit30m: "显式 30 分钟",
    days: "天",
    ofDays: "/ {total} 天",
    loading: "正在加载用量…",
    empty: "下一次模型回复后，这里会显示 Token 用量。",
    error: "历史用量暂时无法加载，实时用量仍会继续记录。",
  },
} as const;

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

const TOKEN_USAGE_TOOLTIP_COPY = {
  en: {
    daily: "{{date}} used {{value}} Tokens",
    weekly: "Week containing {{date}} used {{value}} Tokens",
    cumulative: "Through {{date}}, {{value}} Tokens used",
  },
  "zh-CN": {
    daily: "{{date}}使用了 {{value}} 个 Token",
    weekly: "{{date}}当周使用了 {{value}} 个 Token",
    cumulative: "截至{{date}}累计使用 {{value}} 个 Token",
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
  const template = localizedCopy(
    locale,
    "usage",
    TOKEN_USAGE_TOOLTIP_COPY[legacyLocale(locale)],
  )[view];
  return template.replace("{{date}}", date).replace("{{value}}", value);
}

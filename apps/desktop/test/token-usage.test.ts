import { describe, expect, it } from "vitest";

import { PROTOCOL_VERSION, type AgentEvent } from "@artemis/protocol";
import {
  buildCacheUsageMetrics,
  buildTokenUsageCells,
  formatTokenUsageTooltip,
  TOKEN_USAGE_COPY,
  tokenUsageValue,
} from "../src/renderer/token-usage.js";

function usageEvent(
  eventId: string,
  timestamp: string,
  totalTokens: number,
  threadId = "thread-1",
): AgentEvent {
  return {
    protocolVersion: PROTOCOL_VERSION,
    eventId,
    threadId,
    turnId: `turn-${eventId}`,
    seq: Number.parseInt(eventId.replace(/\D/gu, ""), 10),
    timestamp,
    payload: {
      type: "assistant.usage",
      inputTokens: Math.max(0, totalTokens - 20),
      outputTokens: Math.min(20, totalTokens),
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens,
    },
  } as unknown as AgentEvent;
}

describe("token usage activity", () => {
  const events = [
    usageEvent("usage-1", "2026-07-19T16:30:00.000Z", 120),
    usageEvent("usage-2", "2026-07-21T02:00:00.000Z", 80, "thread-2"),
    usageEvent("usage-3", "2026-07-26T04:00:00.000Z", 300),
    usageEvent("usage-3", "2026-07-26T04:00:00.000Z", 300),
    usageEvent("usage-4", "2026-07-27T04:00:00.000Z", 400),
  ];
  const cells = buildTokenUsageCells(events, { timeZone: "Asia/Shanghai" });

  it("aggregates daily, Monday-to-Sunday weekly, and through-day cumulative usage", () => {
    expect(cells.find((cell) => cell.date === "2026-07-20")).toMatchObject({
      dailyTokens: 120,
      weeklyTokens: 500,
      cumulativeTokens: 120,
    });
    expect(cells.find((cell) => cell.date === "2026-07-26")).toMatchObject({
      dailyTokens: 300,
      weeklyTokens: 500,
      cumulativeTokens: 500,
    });
    expect(cells.find((cell) => cell.date === "2026-07-27")).toMatchObject({
      dailyTokens: 400,
      weeklyTokens: 400,
      cumulativeTokens: 900,
    });
  });

  it("uses the selected view value for each heatmap square", () => {
    const cell = cells.find((candidate) => candidate.date === "2026-07-26");
    expect(cell).toBeDefined();
    expect(tokenUsageValue(cell!, "daily")).toBe(300);
    expect(tokenUsageValue(cell!, "weekly")).toBe(500);
    expect(tokenUsageValue(cell!, "cumulative")).toBe(500);
  });

  it("describes the hovered day, week, or through-day total in both locales", () => {
    const cell = cells.find((candidate) => candidate.date === "2026-07-26");
    expect(cell).toBeDefined();

    expect(formatTokenUsageTooltip(cell!, "daily", "en")).toBe(
      "July 26, 2026 used 300 Tokens",
    );
    expect(formatTokenUsageTooltip(cell!, "weekly", "en")).toBe(
      "Week containing July 26, 2026 used 500 Tokens",
    );
    expect(formatTokenUsageTooltip(cell!, "cumulative", "en")).toBe(
      "Through July 26, 2026, 500 Tokens used",
    );
    expect(formatTokenUsageTooltip(cell!, "daily", "zh-CN")).toBe(
      "2026年7月26日使用了 300 个 Token",
    );
    expect(formatTokenUsageTooltip(cell!, "weekly", "zh-CN")).toBe(
      "2026年7月26日当周使用了 500 个 Token",
    );
    expect(formatTokenUsageTooltip(cell!, "cumulative", "zh-CN")).toBe(
      "截至2026年7月26日累计使用 500 个 Token",
    );
  });

  it("provides English and Simplified Chinese page and view labels", () => {
    expect(TOKEN_USAGE_COPY.en).toMatchObject({
      title: "Token usage",
      activity: "Token activity",
      dailyTab: "Daily",
      weeklyTab: "Weekly",
      cumulativeTab: "Cumulative",
      insights: "Activity insights",
      tokenComposition: "Token composition",
      cacheHitRate: "Cache hit rate",
      cacheDataCoverage: "Cache data coverage",
      automaticPolicyDistribution: "Automatic cache policies",
    });
    expect(TOKEN_USAGE_COPY["zh-CN"]).toMatchObject({
      title: "Token 用量",
      activity: "Token 活动",
      dailyTab: "每日",
      weeklyTab: "每周",
      cumulativeTab: "累计",
      insights: "活动观察",
      tokenComposition: "Token 构成",
      cacheHitRate: "缓存命中率",
      cacheDataCoverage: "缓存数据覆盖率",
      automaticPolicyDistribution: "自动缓存策略分布",
    });
  });

  it("computes cache hit rate only from explicitly reported events", () => {
    const reported = usageEvent("usage-10", "2026-07-27T05:00:00.000Z", 1_000);
    reported.payload = {
      type: "assistant.usage",
      inputTokens: 400,
      outputTokens: 100,
      cacheReadTokens: 400,
      cacheWriteTokens: 100,
      totalTokens: 1_000,
      cacheReadReported: true,
      cacheWriteReported: true,
      cachePolicy: "explicit-30m",
    };
    const legacy = usageEvent("usage-11", "2026-07-27T06:00:00.000Z", 200);

    expect(buildCacheUsageMetrics([reported, legacy, reported])).toEqual({
      usageEvents: 2,
      reportedEvents: 1,
      reportedInputTokens: 900,
      cacheReadTokens: 400,
      hitRate: 400 / 900,
      coverage: 0.5,
      policies: {
        disabled: 0,
        short: 0,
        long: 0,
        "explicit-30m": 1,
      },
    });
  });

  it("reports an unknown hit rate rather than zero for legacy usage", () => {
    const metrics = buildCacheUsageMetrics([
      usageEvent("usage-12", "2026-07-27T06:00:00.000Z", 200),
    ]);

    expect(metrics.hitRate).toBeUndefined();
    expect(metrics.coverage).toBe(0);
  });

  it("infers compatible endpoint reporting from cache reads on the same key", () => {
    const cached = usageEvent("usage-13", "2026-07-27T07:00:00.000Z", 1_000);
    cached.payload = {
      type: "assistant.usage",
      inputTokens: 100,
      outputTokens: 100,
      cacheReadTokens: 800,
      cacheWriteTokens: 0,
      totalTokens: 1_000,
      cacheReadReported: false,
      cachePolicy: "short",
      cachePolicyReason: "non-official-endpoint",
      cacheKeyFingerprint: "0123456789abcdef",
    };
    const cold = usageEvent("usage-14", "2026-07-27T08:00:00.000Z", 1_000);
    cold.payload = {
      type: "assistant.usage",
      inputTokens: 900,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 1_000,
      cacheReadReported: false,
      cachePolicy: "short",
      cachePolicyReason: "non-official-endpoint",
      cacheKeyFingerprint: "0123456789abcdef",
    };
    const unknown = usageEvent("usage-15", "2026-07-27T09:00:00.000Z", 1_000);
    unknown.payload = {
      type: "assistant.usage",
      inputTokens: 900,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 1_000,
      cacheReadReported: false,
      cachePolicy: "short",
      cachePolicyReason: "non-official-endpoint",
      cacheKeyFingerprint: "fedcba9876543210",
    };

    expect(buildCacheUsageMetrics([cold, unknown, cached])).toMatchObject({
      usageEvents: 3,
      reportedEvents: 2,
      reportedInputTokens: 1_800,
      cacheReadTokens: 800,
      hitRate: 800 / 1_800,
      coverage: 2 / 3,
    });
  });
});

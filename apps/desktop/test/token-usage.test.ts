import { describe, expect, it } from "vitest";

import { PROTOCOL_VERSION, type AgentEvent } from "@artemis/protocol";
import {
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
      daily: "Daily",
      weekly: "Weekly",
      cumulative: "Cumulative",
    });
    expect(TOKEN_USAGE_COPY["zh-CN"]).toMatchObject({
      title: "Token 用量",
      activity: "Token 活动",
      daily: "每日",
      weekly: "每周",
      cumulative: "累计",
    });
  });
});

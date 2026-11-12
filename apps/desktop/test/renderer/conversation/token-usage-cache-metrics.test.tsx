// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { stubWindowArtemis } from "../../fixtures/renderer-test-utils.js";
import { TokenUsagePage } from "../../../src/renderer/conversation/TokenUsagePage.js";
import type { AgentEvent } from "@artemis/protocol";
describe("cache KPI", () => {
  it.each(["empty", "unreported", "reported"])(
    "keeps five cards for %s data without reporting missing as zero",
    async (state) => {
      const events: AgentEvent[] =
        state === "empty"
          ? []
          : [
              {
                protocolVersion: 4,
                eventId: "e",
                threadId: "t",
                seq: 1,
                timestamp: new Date().toISOString(),
                payload: {
                  type: "assistant.usage",
                  providerId: "fixture",
                  modelId: "fixture",
                  inputTokens: 100,
                  outputTokens: 20,
                  totalTokens: 120,
                  cacheReadTokens: state === "reported" ? 60 : 0,
                  cacheWriteTokens: 0,
                  ...(state === "reported" ? { cacheReadReported: true } : {}),
                },
              },
            ];
      stubWindowArtemis({
        onAgentEvent: () => () => {},
        getTokenUsageEvents: async () => events,
      });
      const { container } = render(
        <TokenUsagePage locale="zh-CN" username="Fixture" />,
      );
      await waitFor(() =>
        expect(container.querySelector(".token-usage-page")).not.toHaveClass(
          "is-loading",
        ),
      );
      expect(
        container.querySelector(".token-usage-summary")?.children.length,
      ).toBe(5);
      if (state !== "reported") {
        expect(screen.getByText("模型未报告缓存数据")).toBeVisible();
        expect(
          container.querySelector(".token-usage-summary")?.lastElementChild,
        ).not.toHaveTextContent("0%");
      } else expect(screen.queryByText("模型未报告缓存数据")).toBeNull();
    },
  );
});

it("shows reported costs, estimates, and concrete models without attributing unknown history", async () => {
  const event = (id: string, extra: object): AgentEvent => ({
    protocolVersion: 4,
    eventId: id,
    threadId: "t",
    turnId: "turn",
    seq: Number(id),
    timestamp: new Date().toISOString(),
    payload: {
      type: "assistant.usage",
      providerId: "radius",
      modelId: "auto",
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 15,
      ...extra,
    },
  });
  const events = [
    event("1", {
      responseModelId: "concrete-a",
      costUsd: 0,
      costSource: "provider",
    }),
    event("2", {
      responseModelId: "concrete-b",
      costUsd: 0.002,
      costSource: "estimated",
    }),
    event("3", {}),
  ];
  stubWindowArtemis({
    onAgentEvent: () => () => {},
    getTokenUsageEvents: async () => events,
  });
  render(<TokenUsagePage locale="zh-CN" username="Fixture" />);
  expect(
    await screen.findByText(
      /实际模型：concrete-a, concrete-b · 1 条回复未报告实际模型/,
    ),
  ).toBeVisible();
  expect(screen.getAllByText(/供应商返回费用/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/估算费用/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/1 条回复未记录费用/).length).toBeGreaterThan(0);
  expect(screen.getByRole("heading", { name: "费用（美元）" })).toBeVisible();
});

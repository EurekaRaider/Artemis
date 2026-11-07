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

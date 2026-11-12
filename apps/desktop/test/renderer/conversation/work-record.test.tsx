// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type {
  AgentEvent,
  ChildAgentState,
  TurnViewState,
} from "@artemis/protocol";
import {
  AgentActivityStatus,
  WorkRecord,
  turnUsageLabel,
} from "../../../src/renderer/conversation/WorkRecord.js";

afterEach(cleanup);

it("attributes turn costs and actual models once across replay and model switches", () => {
  const event = (id: string, extra: object): AgentEvent => ({
    protocolVersion: 4,
    eventId: id,
    threadId: "thread",
    turnId: "turn",
    seq: 1,
    timestamp: "2026-11-12T00:00:00Z",
    payload: {
      type: "assistant.usage",
      modelId: "auto",
      inputTokens: 80,
      outputTokens: 20,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 100,
      ...extra,
    },
  });
  const provider = event("provider", {
    responseModelId: "concrete-a",
    costUsd: 0.01234,
    costSource: "provider",
  });
  const estimated = event("estimate", {
    modelId: "other-choice",
    responseModelId: "concrete-b",
    costUsd: 0.00456,
    costSource: "estimated",
  });
  const label = turnUsageLabel(
    [
      provider,
      provider,
      estimated,
      event("legacy", {}),
      { ...provider, eventId: "other-turn", turnId: "other" },
    ],
    "turn",
    "en",
  );
  expect(label).toContain("auto, other-choice");
  expect(label).toContain("concrete-a, concrete-b");
  expect(label).toContain("$0.01234");
  expect(label).toContain("$0.00456");
  expect(label).toContain("300 tokens");
  expect(label).toContain("1 responses");
  expect(turnUsageLabel([], "turn", "en")).toBe("");
});

it("keeps the timeline's right-hand status text-only when the left column owns its icon", () => {
  const child = {
    agentId: "review",
    label: "Review",
    status: "blocked",
  } as ChildAgentState;
  const { container } = render(
    <AgentActivityStatus child={child} locale="zh-CN" showIcon={false} />,
  );
  expect(screen.getByText("被阻塞")).toBeTruthy();
  expect(container.querySelector("svg")).toBeNull();
});

it.each([
  ["queued", "排队", "clock"],
  ["blocked", "被阻塞", "alert"],
  ["completed", "完成", "check"],
] as const)(
  "presents %s with the shared status text and icon",
  (status, label, icon) => {
    const child = {
      agentId: "review",
      label: "Review",
      status,
    } as ChildAgentState;
    const { container } = render(
      <AgentActivityStatus child={child} locale="zh-CN" />,
    );
    expect(screen.getByText(label)).toBeTruthy();
    expect(
      container.querySelector("svg")?.getAttribute("data-artemis-icon"),
    ).toBe(icon);
  },
);

it.each(["completed", "failed"] as const)(
  "only suppresses an empty instant completion, retaining %s content",
  (status) => {
    const turn = { id: "review", status, durationMs: 500 } as TurnViewState;
    const { container } = render(
      <WorkRecord
        turn={turn}
        changedFileCount={0}
        locale="en"
        entries={[]}
        childAgents={{}}
      >
        <p>Plan ready</p>
      </WorkRecord>,
    );
    expect(screen.getByText("Plan ready")).toBeTruthy();
    expect(Boolean(container.querySelector(".work-record-summary"))).toBe(
      status === "failed",
    );
  },
);

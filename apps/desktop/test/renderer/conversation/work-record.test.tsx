// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { ChildAgentState, TurnViewState } from "@artemis/protocol";
import {
  AgentActivityStatus,
  WorkRecord,
} from "../../../src/renderer/conversation/WorkRecord.js";

afterEach(cleanup);

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

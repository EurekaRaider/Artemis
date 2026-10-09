// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentTeamState, ChildAgentState } from "@artemis/protocol";
import { useEnvironmentActivityAgents } from "../../../src/renderer/workspace/EnvironmentPanel.js";

const now = new Date("2026-10-09T00:00:00Z");
const agent = (
  status: ChildAgentState["status"],
  age = 0,
): ChildAgentState => ({
  type: "child-agent.status",
  agentId: status,
  label: status,
  status,
  lastActivityAt: new Date(now.getTime() - age).toISOString(),
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("environment agent retention", () => {
  it("expires terminal rows without another event and preserves history and active rows", () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const agents = [
      "completed",
      "failed",
      "cancelled",
      "running",
      "queued",
      "blocked",
    ].map((status) => agent(status as ChildAgentState["status"]));
    const { result, unmount } = renderHook(() =>
      useEnvironmentActivityAgents(agents, []),
    );
    expect(result.current).toHaveLength(6);
    act(() => vi.advanceTimersByTime(4_999));
    expect(result.current).toHaveLength(6);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.map((item) => item.status)).toEqual([
      "running",
      "queued",
      "blocked",
    ]);
    expect(agents).toHaveLength(6);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not resurrect old history on remount or status refresh", () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const agents = [
      { ...agent("completed", 60_000), updatedAt: now.toISOString() },
      { ...agent("failed"), lastActivityAt: "invalid" },
    ];
    const { result } = renderHook(() =>
      useEnvironmentActivityAgents(agents, []),
    );
    expect(result.current).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("starts retention when a running agent completes and cleans up pending timers", () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const { result, rerender, unmount } = renderHook(
      ({ agents }) => useEnvironmentActivityAgents(agents, []),
      { initialProps: { agents: [agent("running", 60_000)] } },
    );
    expect(vi.getTimerCount()).toBe(0);
    rerender({ agents: [agent("completed")] });
    expect(result.current).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses team completion time for a stale running member", () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const teams: AgentTeamState[] = [
      {
        type: "agent-team.status",
        teamId: "team",
        mission: "review",
        status: "completed",
        memberAgentIds: ["running"],
        requiredAgentIds: [],
        maxMembers: 8,
        updatedAt: now.toISOString(),
      },
    ];
    const agents = [{ ...agent("running", 60_000), teamId: "team" }];
    const { result } = renderHook(() =>
      useEnvironmentActivityAgents(agents, teams),
    );
    expect(result.current[0]?.status).toBe("completed");
    act(() => vi.advanceTimersByTime(5_000));
    expect(result.current).toEqual([]);
    expect(agents[0]?.status).toBe("running");
  });
});

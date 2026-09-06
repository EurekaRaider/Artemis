// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ChildAgentState, AgentTeamState } from "@artemis/protocol";
import "./renderer-test-utils.js";
import {
  AgentTeamPanel,
  ChildAgentPanel,
  WorkspaceTabIcon,
} from "../src/renderer/App.js";

vi.mock("../src/renderer/desktop-skin-bootstrap.js", () => ({}));
const updatedAt = "2026-09-06T02:00:00.000Z";
const members: ChildAgentState[] = [
  {
    type: "child-agent.status",
    agentId: "layout",
    label: "界面编排",
    status: "running",
    activity: "正在整理子面板",
    updatedAt,
  },
  {
    type: "child-agent.status",
    agentId: "review",
    label: "布局检查",
    status: "completed",
    task: "核对主界面及子面板的信息层级。",
    activity: "读取 App.tsx\n\n核对面板组件",
    output: "已核对 9 类 Dock 面板。",
    updatedAt,
  },
];
const team: AgentTeamState = {
  type: "agent-team.status",
  teamId: "team",
  mission: "UI 实现团队",
  status: "running",
  memberAgentIds: members.map((m) => m.agentId),
  requiredAgentIds: [],
  maxMembers: 4,
  updatedAt,
};

describe("prototype-aligned agent panels", () => {
  it("keeps each member's identity icon in its row and tab after status and label updates", () => {
    const renderTeam = (items: ChildAgentState[]) => (
      <AgentTeamPanel
        active
        controlPending={false}
        locale="zh-CN"
        members={items}
        messages={[]}
        onOpenChildAgent={vi.fn()}
        onStop={vi.fn()}
        runtimeAvailable
        team={team}
      />
    );
    const { rerender } = render(renderTeam(members));
    const icons = members.map((member) => {
      const row = screen.getByRole("button", {
        name: new RegExp(member.label),
      });
      const icon = row.querySelector(".child-agent-mark");
      expect(icon).toBe(row.firstElementChild);
      expect(icon).toHaveAttribute("aria-hidden", "true");
      expect(icon).not.toBeNull();
      return icon!.outerHTML;
    });
    expect(icons[0]).not.toEqual(icons[1]);
    const updated = [...members].reverse().map((member) => ({
      ...member,
      label: `${member.label}（已停止）`,
      status: "cancelled" as const,
    }));
    rerender(renderTeam(updated));
    members.forEach((member, index) => {
      expect(
        screen
          .getByRole("button", { name: new RegExp(member.label) })
          .querySelector(".child-agent-mark")?.outerHTML,
      ).toBe(icons[index]);
      const tab = render(
        <WorkspaceTabIcon kind="child-agent" childAgentId={member.agentId} />,
      );
      expect(tab.container.firstElementChild?.outerHTML).toBe(icons[index]);
      tab.unmount();
    });
  });

  it("renders member summaries, meaningful states and a trailing view action without protocol labels", async () => {
    const onOpenChildAgent = vi.fn(),
      onStop = vi.fn();
    const { container } = render(
      <AgentTeamPanel
        active
        controlPending={false}
        locale="zh-CN"
        members={members}
        messages={[]}
        onOpenChildAgent={onOpenChildAgent}
        onStop={onStop}
        runtimeAvailable
        team={team}
      />,
    );
    expect(screen.getByRole("heading", { name: "成员 · 2" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "团队消息" })).toBeVisible();
    expect(screen.queryByText("leaf")).toBeNull();
    expect(screen.queryByText("思考中")).toBeNull();
    expect(container.querySelectorAll(".agent-panel-status")).toHaveLength(2);
    const view = screen.getByRole("button", { name: /布局检查.*查看/ });
    await userEvent.click(view);
    expect(onOpenChildAgent).toHaveBeenCalledWith(members[1]);
    const stop = screen.getByRole("button", { name: "停止团队" });
    expect(stop.closest(".agent-team-footer")).not.toBeNull();
    await userEvent.click(stop);
    expect(onStop).toHaveBeenCalledWith(team);
  });

  it("preserves tree expansion independently of opening a member and blocks unavailable stop actions", async () => {
    const parent = { ...members[0]!, depth: 1 };
    const child = { ...members[1]!, parentAgentId: parent.agentId, depth: 2 };
    const onOpenChildAgent = vi.fn();
    const { rerender } = render(
      <AgentTeamPanel
        active
        controlPending
        locale="zh-CN"
        members={[parent, child]}
        messages={[]}
        onOpenChildAgent={onOpenChildAgent}
        onStop={vi.fn()}
        runtimeAvailable
        team={team}
      />,
    );
    const toggle = screen.getByRole("button", { name: /折叠子树/ });
    await userEvent.click(toggle);
    expect(screen.queryByRole("button", { name: /布局检查.*查看/ })).toBeNull();
    expect(onOpenChildAgent).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "停止团队" })).toBeDisabled();
    rerender(
      <AgentTeamPanel
        active
        controlPending={false}
        locale="zh-CN"
        members={[parent, child]}
        messages={[]}
        onOpenChildAgent={onOpenChildAgent}
        onStop={vi.fn()}
        runtimeAvailable={false}
        team={team}
      />,
    );
    expect(screen.queryByRole("button", { name: "停止团队" })).toBeNull();
  });

  it("keeps task, activity and result visible together after completion, with retry available", async () => {
    const onControl = vi.fn();
    const { container } = render(
      <ChildAgentPanel
        active
        child={members[1]}
        clockMs={Date.parse(updatedAt)}
        locale="zh-CN"
        onControl={onControl}
        pendingAction={undefined}
      />,
    );
    const sections = [...container.querySelectorAll(".child-agent-panel-task")];
    expect(sections.map((s) => s.querySelector("span")?.textContent)).toEqual([
      "任务",
      "活动记录",
      "结果",
    ]);
    expect(
      within(sections[1] as HTMLElement).getByText("读取 App.tsx"),
    ).toBeVisible();
    expect(screen.getByText("已核对 9 类 Dock 面板。")).toBeVisible();
    expect(
      container.querySelector(".child-agent-panel-runtime-bar"),
    ).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onControl).toHaveBeenCalledWith(members[1], "retry");
  });

  it("keeps live runtime details collapsible without hiding cancellation and health feedback", async () => {
    const onControl = vi.fn();
    const child = { ...members[0]!, health: "stalled" as const };
    const { container } = render(
      <ChildAgentPanel
        active
        child={child}
        clockMs={Date.parse(updatedAt)}
        locale="zh-CN"
        onControl={onControl}
        pendingAction={undefined}
      />,
    );
    expect(
      within(container.querySelector(".child-agent-panel-header")!).getByText(
        /疑似无响应/,
      ),
    ).toBeVisible();
    const details = container.querySelector(".child-agent-panel-runtime-bar")!;
    expect(details).not.toHaveAttribute("open");
    await userEvent.click(screen.getByText("运行详情"));
    expect(details).toHaveAttribute("open");
    await userEvent.click(screen.getByRole("button", { name: "停止此子代理" }));
    expect(onControl).toHaveBeenCalledWith(child, "cancel");
  });
});

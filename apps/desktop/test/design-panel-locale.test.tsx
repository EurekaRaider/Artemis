// @vitest-environment jsdom
// Locale wiring for the Design panel (PR #195 review follow-up): the panel
// must follow the app locale instead of hardcoding zh-CN strings, and the
// empty state is the cheapest surface that exercises the full labels path.
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DesignPanel } from "../src/renderer/DesignPanel.js";
import { stubWindowArtemis } from "./renderer-test-utils.js";

const artemisStub = () => ({
  getDesignState: vi.fn(async () => undefined),
  designAction: vi.fn(async () => ({ revision: undefined })),
  setDesignDraft: vi.fn(async () => {}),
  setDesignMode: vi.fn(async () => {}),
  setDesignBounds: vi.fn(async () => {}),
  confirmDesignLeave: vi.fn(async () => true),
});

describe("DesignPanel locale", () => {
  it("renders the empty state in English for the en locale", () => {
    stubWindowArtemis(artemisStub());
    render(
      <DesignPanel
        threadId="thread-1"
        locale="en"
        mode="execute"
        active={false}
        onConversation={() => {}}
      />,
    );
    expect(screen.getByText("Explore design in this task")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Start designing" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Design workspace")).toBeInTheDocument();
  });

  it("renders the empty state in Chinese for the zh-CN locale", () => {
    stubWindowArtemis(artemisStub());
    render(
      <DesignPanel
        threadId="thread-1"
        locale="zh-CN"
        mode="execute"
        active={false}
        onConversation={() => {}}
      />,
    );
    expect(screen.getByText("在当前任务中探索设计")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "开始设计" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("设计工作区")).toBeInTheDocument();
  });
});

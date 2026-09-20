// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ApprovalState, UserInputState, Thread } from "@artemis/protocol";
import "./renderer-test-utils.js";
import { ApprovalDecisionCard } from "../src/renderer/ApprovalDecisionCard.js";
import { UserInputCard } from "../src/renderer/UserInputCard.js";
import { ThreadWaitingBadge } from "../src/renderer/ThreadStatusIndicator.js";
const approval: ApprovalState = {
  type: "approval.requested",
  approvalId: "a",
  nonce: "1234567890abcdef",
  summary: "运行测试",
  command: "npm test",
  paths: [],
  network: [],
  risk: "low",
  allowedScopes: ["once", "session"],
  status: "pending",
  requestedAt: new Date().toISOString(),
};
const input: UserInputState = {
  type: "user-input.requested",
  requestId: "q",
  nonce: approval.nonce,
  header: "风格",
  question: "选择风格",
  options: [
    { label: "简洁", description: "简洁布局", recommended: true },
    { label: "紧凑", description: "紧凑布局", recommended: false },
  ],
  expiresAt: new Date(Date.now() + 300000).toISOString(),
  status: "pending",
};
describe("approval and single question cards", () => {
  it("immediately approves exactly once and disables duplicate actions", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn(() => new Promise<void>(() => {}));
    render(
      <ApprovalDecisionCard
        approval={approval}
        locale="zh-CN"
        onResolve={onResolve}
      />,
    );
    await user.click(screen.getByRole("button", { name: /仅批准本次/ }));
    await user.click(screen.getByRole("button", { name: /拒绝/ }));
    expect(onResolve).toHaveBeenCalledExactlyOnceWith(
      approval,
      true,
      "once",
      undefined,
    );
  });
  it("offers only allowed scopes and never grants on skip or feedback", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    const view = render(
      <ApprovalDecisionCard
        approval={{ ...approval, allowedScopes: ["once"] }}
        locale="zh-CN"
        onResolve={onResolve}
      />,
    );
    expect(screen.queryByRole("button", { name: /会话/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "跳过" }));
    expect(onResolve).toHaveBeenCalledWith(expect.anything(), false, "once", {
      skipped: true,
    });
    view.unmount();
    render(
      <ApprovalDecisionCard
        approval={approval}
        locale="zh-CN"
        onResolve={onResolve}
      />,
    );
    await user.type(screen.getByRole("textbox"), "先查看配置");
    await user.click(screen.getByRole("button", { name: "发送" }));
    expect(onResolve).toHaveBeenLastCalledWith(approval, false, "once", {
      feedback: "先查看配置",
    });
  });
  it("keeps draft and actions after a rejected request", async () => {
    const user = userEvent.setup();
    const onResolve = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    render(
      <ApprovalDecisionCard
        approval={approval}
        locale="zh-CN"
        onResolve={onResolve}
      />,
    );
    await user.type(screen.getByRole("textbox"), "草稿");
    await user.click(screen.getByRole("button", { name: "发送" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("草稿");
    await user.click(screen.getByRole("button", { name: "发送" }));
    expect(onResolve).toHaveBeenCalledTimes(2);
  });
  it("collapses resolved approvals with truthful scope and no controls", () => {
    render(
      <ApprovalDecisionCard
        approval={{ ...approval, status: "approved", scope: "session" }}
        locale="zh-CN"
        onResolve={vi.fn()}
      />,
    );
    expect(screen.getByText("本会话已允许")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("does not label skipped approval as approved", () => {
    render(
      <ApprovalDecisionCard
        approval={{ ...approval, status: "denied", skipped: true }}
        locale="zh-CN"
        onResolve={vi.fn()}
      />,
    );
    expect(screen.getByText("已跳过")).toBeInTheDocument();
    expect(screen.queryByText("已批准")).toBeNull();
  });
  it("submits single options directly and preserves persisted answer history", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    const { rerender } = render(
      <UserInputCard
        active
        input={input}
        locale="zh-CN"
        onResolve={onResolve}
      />,
    );
    await user.click(screen.getByRole("button", { name: /紧凑/ }));
    expect(onResolve).toHaveBeenCalledWith({
      requestId: "q",
      nonce: approval.nonce,
      selectedOption: 1,
    });
    rerender(
      <UserInputCard
        active
        input={{ ...input, status: "answered", answer: "紧凑" }}
        locale="zh-CN"
        onResolve={onResolve}
      />,
    );
    expect(screen.queryByRole("textbox")).toBeNull();
  });
  it("does not submit single custom answer during IME input", () => {
    const onResolve = vi.fn();
    render(
      <UserInputCard
        active
        input={input}
        locale="zh-CN"
        onResolve={onResolve}
      />,
    );
    const field = screen.getByRole("textbox");
    fireEvent.change(field, { target: { value: "输入" } });
    fireEvent.compositionStart(field);
    fireEvent.submit(field.closest("form")!);
    expect(onResolve).not.toHaveBeenCalled();
  });
  it("shows waiting badge independent of unread status and removes it on resume", () => {
    const thread = {
      status: "waiting-approval",
      notification: { kind: "input-required", unread: false },
    } as Thread;
    const { rerender } = render(
      <ThreadWaitingBadge thread={thread} locale="zh-CN" />,
    );
    expect(screen.getByText("等待选择")).toBeInTheDocument();
    rerender(
      <ThreadWaitingBadge
        thread={{ ...thread, status: "running" }}
        locale="zh-CN"
      />,
    );
    expect(screen.queryByText("等待选择")).toBeNull();
  });
});

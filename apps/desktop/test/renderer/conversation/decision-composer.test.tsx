// @vitest-environment jsdom
import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  createThreadViewState,
  type ApprovalState,
  type MultiQuestionUserInputState,
  type UserInputState,
} from "@artemis/protocol";
import "../../fixtures/renderer-test-utils.js";
import {
  DecisionComposer,
  firstPendingComposerDecision,
} from "../../../src/renderer/conversation/DecisionComposer.js";

const input: UserInputState = {
  type: "user-input.requested",
  requestId: "question",
  nonce: "nonce-0000000001",
  header: "风格",
  question: "选择布局",
  options: [
    { label: "简洁", description: "保留留白", recommended: true },
    { label: "紧凑", description: "减少留白", recommended: false },
  ],
  expiresAt: new Date(Date.now() + 300000).toISOString(),
  status: "pending",
};
const approval: ApprovalState = {
  type: "approval.requested",
  approvalId: "approval",
  nonce: "nonce-0000000002",
  summary: "允许执行测试？",
  command: "npm test",
  paths: [],
  network: [],
  risk: "low",
  allowedScopes: ["once"],
  status: "pending",
  requestedAt: new Date().toISOString(),
};
function pendingState() {
  return {
    ...createThreadViewState("thread"),
    order: ["input:question", "approval:approval"],
    userInputs: { question: input },
    approvals: { approval },
  };
}

describe("timeline decisions preserve the composer", () => {
  it("takes the oldest pending entry across approvals and questions", () => {
    expect(firstPendingComposerDecision(undefined)).toBeUndefined();
    const state = pendingState();
    expect(firstPendingComposerDecision(state)?.entry).toBe("input:question");
    state.userInputs.question = {
      ...input,
      status: "answered",
      answer: "简洁",
    };
    state.approvals.approval = { ...approval, actorAgentId: "worker" };
    expect(firstPendingComposerDecision(state)).toMatchObject({
      entry: "approval:approval",
      kind: "approval",
      actorName: "worker",
    });
    state.approvals.approval = { ...approval, status: "denied" };
    expect(firstPendingComposerDecision(state)).toBeUndefined();
  });

  it("keeps the draft disabled beneath the timeline while keyboard decisions resolve in order", async () => {
    const user = userEvent.setup();
    const resolvedApproval = vi.fn();
    function Harness() {
      const [state, setState] = useState(createThreadViewState("thread"));
      const [draft, setDraft] = useState("");
      const [target, setTarget] = useState<HTMLElement | null>(null);
      const decision = firstPendingComposerDecision(state);
      return (
        <>
          <button onClick={() => setState(pendingState())}>收到提问</button>
          <section aria-label="时间线" ref={setTarget} />
          <DecisionComposer
            decisionTarget={target}
            className="composer"
            label="发送消息"
            locale="zh-CN"
            decision={decision}
            context={<button>停止任务</button>}
            onResolveUserInput={async () => {
              setState((current) => ({
                ...current,
                userInputs: {
                  question: { ...input, status: "answered", answer: "简洁" },
                },
              }));
            }}
            onResolveApproval={async (...args) => {
              resolvedApproval(...args);
              setState((current) => ({
                ...current,
                approvals: { approval: { ...approval, status: "approved" } },
              }));
            }}
          >
            <textarea
              aria-label="消息草稿"
              disabled={Boolean(decision)}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          </DecisionComposer>
        </>
      );
    }
    render(<Harness />);
    await user.type(
      screen.getByRole("textbox", { name: "消息草稿" }),
      "保留这份草稿",
    );
    await user.click(screen.getByRole("button", { name: "收到提问" }));
    const composer = screen.getByRole("region", { name: "发送消息" });
    const timeline = screen.getByRole("region", { name: "时间线" });
    expect(screen.getByRole("textbox", { name: "消息草稿" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "消息草稿" })).toHaveValue(
      "保留这份草稿",
    );
    expect(within(timeline).getByText("选择布局")).toBeInTheDocument();
    expect(composer).not.toContainElement(
      within(timeline).getByText("选择布局"),
    );
    expect(composer).not.toContainElement(
      screen.getByRole("button", { name: "停止任务" }),
    );
    expect(composer.nextElementSibling).toContainElement(
      screen.getByRole("button", { name: "停止任务" }),
    );
    expect(
      within(timeline).getByRole("button", { name: /简洁/ }),
    ).toHaveFocus();
    await user.keyboard("1");
    expect(within(timeline).queryByText("选择布局")).toBeNull();
    expect(within(timeline).getByText("允许执行测试？")).toBeInTheDocument();
    expect(
      within(timeline).getByRole("button", { name: /仅批准本次/ }),
    ).toHaveFocus();
    await user.keyboard("{ArrowDown}{ArrowUp}{Enter}");
    expect(resolvedApproval).toHaveBeenCalledExactlyOnceWith(
      approval,
      true,
      "once",
      undefined,
    );
    expect(screen.getByRole("textbox", { name: "消息草稿" })).toHaveValue(
      "保留这份草稿",
    );
    expect(screen.getByRole("textbox", { name: "消息草稿" })).toBeEnabled();
    expect(timeline).toBeEmptyDOMElement();
  });

  it("keeps multi-question decisions outside the composer", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    const multi: MultiQuestionUserInputState = {
      ...input,
      kind: "multi-question",
      questions: ["q1", "q2", "q3"].map((questionId, index) => ({
        questionId,
        question: `选择布局 ${index + 1}`,
        options: input.options,
        expiresAt: input.expiresAt,
      })),
      answers: {
        q1: { status: "pending" },
        q2: { status: "pending" },
        q3: { status: "pending" },
      },
    };
    const state = { ...pendingState(), userInputs: { question: multi } };
    render(
      <DecisionComposer
        className="composer"
        label="发送消息"
        locale="zh-CN"
        decision={firstPendingComposerDecision(state)}
        onResolveApproval={vi.fn()}
        onResolveUserInput={onResolve}
      >
        <textarea aria-label="消息草稿" />
      </DecisionComposer>,
    );
    const composer = screen.getByRole("region", { name: "发送消息" });
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(composer).not.toContainElement(screen.getByRole("tabpanel"));
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /紧凑/ }));
    expect(onResolve).toHaveBeenCalledExactlyOnceWith({
      requestId: input.requestId,
      nonce: input.nonce,
      kind: "multi-question",
      questionId: "q1",
      selectedOptionLabel: "紧凑",
    });
  });
});

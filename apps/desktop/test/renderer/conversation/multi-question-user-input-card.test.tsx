// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { MultiQuestionUserInputState } from "@artemis/protocol";
import "../../fixtures/renderer-test-utils.js";
import { MultiQuestionUserInputCard } from "../../../src/renderer/conversation/MultiQuestionUserInputCard.js";

const options = [
  { label: "预发布", description: "先验证", recommended: true },
  { label: "生产", description: "直接发布", recommended: false },
];
const input = (): MultiQuestionUserInputState => ({
  type: "user-input.requested",
  kind: "multi-question",
  requestId: "q",
  nonce: "nonce-0000000001",
  header: "环境",
  question: "环境",
  options,
  expiresAt: new Date(Date.now() + 300000).toISOString(),
  status: "pending",
  questions: ["q1", "q2", "q3"].map((questionId, index) => ({
    questionId,
    question: `问题 ${index + 1}`,
    options,
    expiresAt: new Date(Date.now() + 300000).toISOString(),
  })),
  answers: {
    q1: { status: "pending" },
    q2: { status: "pending" },
    q3: { status: "pending" },
  },
});
const panel = () => within(screen.getByRole("tabpanel"));
const choices = () =>
  panel()
    .getAllByRole("button")
    .filter((button) => button.classList.contains("decision-option"));
const textbox = () => panel().getByRole("textbox");
const tabs = () => screen.getAllByRole("tab");
function setup(value = input(), onResolve = vi.fn()) {
  return {
    onResolve,
    ...render(
      <MultiQuestionUserInputCard
        active
        input={value}
        locale="zh-CN"
        onResolve={onResolve}
      />,
    ),
  };
}

describe("sequential single questions", () => {
  it("shows only one active panel, with correctly wired question navigation", () => {
    setup();
    expect(screen.getByText("第 1/3 题")).toBeInTheDocument();
    expect(tabs()).toHaveLength(3);
    expect(tabs()[0]).toHaveAttribute(
      "aria-controls",
      screen.getByRole("tabpanel").id,
    );
    expect(choices()).toHaveLength(2);
    expect(choices()[0]).toHaveFocus();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
  });
  it("supports one or two questions", () => {
    const state = input();
    state.questions = state.questions.slice(0, 1);
    const view = setup(state);
    expect(tabs()).toHaveLength(1);
    view.unmount();
    state.questions = input().questions.slice(0, 2);
    setup(state);
    expect(tabs()).toHaveLength(2);
  });
  it("submits directly on click, without a second confirmation", async () => {
    const user = userEvent.setup();
    const { onResolve } = setup();
    expect(panel().getByRole("button", { name: "发送" })).toBeDisabled();
    await user.click(choices()[0]);
    expect(onResolve).toHaveBeenCalledExactlyOnceWith({
      requestId: "q",
      nonce: "nonce-0000000001",
      kind: "multi-question",
      questionId: "q1",
      selectedOptionLabel: "预发布",
    });
  });
  it("navigates choices without submitting and submits on Enter", async () => {
    const user = userEvent.setup();
    const { onResolve } = setup();
    await user.keyboard("{ArrowDown}");
    expect(choices()[1]).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(choices()[0]).toHaveFocus();
    await user.keyboard("{End}");
    expect(choices()[1]).toHaveFocus();
    await user.keyboard("{Home}");
    expect(choices()[0]).toHaveFocus();
    expect(onResolve).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(onResolve).toHaveBeenCalledTimes(1);
  });
  it("supports roving question navigation without answering", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(tabs()[1]);
    await user.keyboard("{ArrowRight}");
    expect(tabs()[2]).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(tabs()[0]).toHaveFocus();
    await user.keyboard("{End}");
    expect(tabs()[2]).toHaveFocus();
    await user.keyboard("{Home}");
    expect(tabs()[0]).toHaveFocus();
  });
  it("retains independent text drafts across question switches", async () => {
    const user = userEvent.setup();
    setup();
    await user.type(textbox(), "第一题草稿");
    await user.click(tabs()[1]);
    expect(textbox()).toHaveValue("");
    await user.type(textbox(), "第二题草稿");
    await user.click(tabs()[0]);
    expect(textbox()).toHaveValue("第一题草稿");
  });
  it("submits custom text through the inline confirmation", async () => {
    const user = userEvent.setup();
    const { onResolve } = setup();
    await user.type(textbox(), "先检查");
    await user.click(panel().getByRole("button", { name: "发送" }));
    expect(onResolve).toHaveBeenCalledWith(
      expect.objectContaining({ questionId: "q1", customAnswer: "先检查" }),
    );
  });
  it("does not submit during IME composition", async () => {
    const user = userEvent.setup();
    const { onResolve } = setup();
    await user.type(textbox(), "输入");
    fireEvent.compositionStart(textbox());
    fireEvent.keyDown(textbox(), { key: "Enter", isComposing: true });
    fireEvent.submit(textbox().closest("form")!);
    expect(onResolve).not.toHaveBeenCalled();
    fireEvent.compositionEnd(textbox());
    await user.keyboard("{Enter}");
    expect(onResolve).toHaveBeenCalledTimes(1);
  });
  it("keeps choices reachable by Shift+Tab from the always-visible input", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(textbox());
    await user.tab({ shift: true });
    expect(choices()[0]).toHaveFocus();
    await user.tab();
    expect(textbox()).toHaveFocus();
  });
  it("skips only the current question", async () => {
    const user = userEvent.setup();
    const { onResolve } = setup();
    await user.click(panel().getByRole("button", { name: "跳过" }));
    expect(onResolve).toHaveBeenCalledWith(
      expect.objectContaining({ questionId: "q1", skipped: true }),
    );
  });
  it("blocks duplicate clicks while allowing another question to be answered", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn(() => new Promise<void>(() => {}));
    setup(input(), onResolve);
    await user.click(choices()[0]);
    await user.click(choices()[1]);
    expect(onResolve).toHaveBeenCalledTimes(1);
    await user.click(tabs()[1]);
    await user.click(choices()[0]);
    expect(onResolve).toHaveBeenCalledTimes(2);
  });
  it("preserves text and enables retry on failure", async () => {
    const user = userEvent.setup();
    const onResolve = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    setup(input(), onResolve);
    await user.type(textbox(), "保留草稿");
    await user.click(panel().getByRole("button", { name: "发送" }));
    expect(screen.getByRole("alert")).toHaveTextContent("提交失败");
    expect(textbox()).toHaveValue("保留草稿");
    await user.click(panel().getByRole("button", { name: "发送" }));
    expect(onResolve).toHaveBeenCalledTimes(2);
  });
  it("advances and focuses next question only when persisted answer arrives", async () => {
    const user = userEvent.setup();
    const state = input();
    const { rerender, onResolve } = setup(state);
    await user.click(choices()[0]);
    expect(screen.getByText("第 1/3 题")).toBeInTheDocument();
    const updated = {
      ...state,
      answers: {
        ...state.answers,
        q1: { status: "answered" as const, answer: "预发布" },
      },
    };
    rerender(
      <MultiQuestionUserInputCard
        active
        input={updated}
        locale="zh-CN"
        onResolve={onResolve}
      />,
    );
    expect(screen.getByText("第 2/3 题")).toBeInTheDocument();
    expect(choices()[0]).toHaveFocus();
    await user.click(tabs()[0]);
    expect(panel().queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("第 1/3 题")).toBeInTheDocument();
  });
  it("shows each question countdown and clamps expired display", async () => {
    const user = userEvent.setup();
    const state = input();
    state.questions[1]!.expiresAt = new Date(Date.now() - 10000).toISOString();
    setup(state);
    expect(
      screen.getByTitle("5 分钟内未选择将自动采用模型推荐项"),
    ).toHaveTextContent("5:00");
    await user.click(tabs()[1]);
    expect(
      screen.getByTitle("5 分钟内未选择将自动采用模型推荐项"),
    ).toHaveTextContent("0:00");
    expect(choices()).toHaveLength(2);
  });
  it("collapses a completed request and exposes all answers on expansion", async () => {
    const user = userEvent.setup();
    const state = input();
    state.status = "answered";
    state.answers = {
      q1: { status: "answered", answer: "预发布" },
      q2: { status: "answered", skipped: true },
      q3: { status: "answered", answer: "保留当前" },
    };
    const { container } = setup(state);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(container.querySelector("details")).not.toHaveAttribute("open");
    await user.click(container.querySelector("summary")!);
    expect(container.querySelector("details")).toHaveAttribute("open");
    expect(screen.getByText("问题 2")).toBeVisible();
    expect(screen.getAllByText(/已跳过/).length).toBeGreaterThan(0);
  });
  it("does not show pending inactive requests", () => {
    const state = input();
    const { container } = render(
      <MultiQuestionUserInputCard
        active={false}
        input={state}
        locale="zh-CN"
        onResolve={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

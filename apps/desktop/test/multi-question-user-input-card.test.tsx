// @vitest-environment jsdom
//
// D#76 PR10C §5 red suite (decision L option 1): the renderer must gain a
// dedicated multi-question card component, and App.tsx must only wire the
// kind-discriminated mount point (no business logic in App). Source-level
// probes follow the repo convention (input-fields.test.tsx,
// renderer-layout.test.ts, icon-sizing.test.ts). The behavioral DOM matrix
// (dots tablist, roving tabindex, per-question countdown, drafts, dedupe)
// lives below the mount-point guard.
//
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  MultiQuestionUserInputState,
  UserInputQuestion,
  UserInputQuestionState,
} from "@artemis/protocol";
import { describe, expect, it, vi } from "vitest";

import "./renderer-test-utils.js";
import { MultiQuestionUserInputCard } from "../src/renderer/MultiQuestionUserInputCard.js";

const rendererDir = resolve(process.cwd(), "src/renderer");
const componentPath = resolve(rendererDir, "MultiQuestionUserInputCard.tsx");
const appSource = readFileSync(resolve(rendererDir, "App.tsx"), "utf8");

describe("multi-question card mount point (D#76 PR10C, decision L option 1)", () => {
  it("ships a dedicated multi-question card component in the renderer local directory", () => {
    expect(
      existsSync(componentPath),
      `renderer 应包含多题卡组件 src/renderer/MultiQuestionUserInputCard.tsx（决策点 L 案 1）：当前缺失——多题输入仍以 legacy 单题投影渲染（App.tsx 全文零 "multi-question"/"MultiQuestion" 命中）`,
    ).toBe(true);
  });

  it("wires App.tsx to the multi-question card component (wiring only)", () => {
    expect(
      appSource.includes("MultiQuestionUserInputCard"),
      "App.tsx 应按输入 kind 判别把多题输入接线到 MultiQuestionUserInputCard（仅 wiring，业务逻辑在组件/纯函数内）：当前零命中",
    ).toBe(true);
  });
});

const TIMEOUT_HINT = "5 分钟内未选择将自动采用模型推荐项";

function futureISO(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function buildQuestions(minutes = 5): UserInputQuestion[] {
  return [
    {
      questionId: "q1",
      question: "目标环境",
      options: [
        {
          label: "预发布",
          description: "先在预发布环境验证",
          recommended: true,
        },
        {
          label: "生产环境",
          description: "直接发布到生产环境",
          recommended: false,
        },
      ],
      expiresAt: futureISO(minutes),
    },
    {
      questionId: "q2",
      question: "是否跑回归测试",
      options: [
        { label: "跑全量回归", description: "完整回归", recommended: true },
        { label: "只跑冒烟", description: "快速冒烟", recommended: false },
        { label: "跳过", description: "不跑测试", recommended: false },
      ],
      expiresAt: futureISO(minutes),
    },
    {
      questionId: "q3",
      question: "完成后通知渠道",
      options: [
        { label: "应用内通知", description: "站内提醒", recommended: true },
        { label: "邮件 + 应用内", description: "双渠道", recommended: false },
      ],
      expiresAt: futureISO(minutes),
    },
  ];
}

function buildInput(
  overrides: {
    questions?: UserInputQuestion[];
    answers?: Record<string, UserInputQuestionState>;
    status?: MultiQuestionUserInputState["status"];
  } = {},
): MultiQuestionUserInputState {
  const questions = overrides.questions ?? buildQuestions();
  const answers =
    overrides.answers ??
    Object.fromEntries(
      questions.map((question) => [
        question.questionId,
        { status: "pending" as const },
      ]),
    );
  return {
    type: "user-input.requested",
    kind: "multi-question",
    requestId: "input-1",
    nonce: "nonce-0000000001",
    header: "配置发布",
    questions,
    answers,
    status: overrides.status ?? "pending",
    question: questions[0].question,
    options: questions[0].options,
    expiresAt: questions[0].expiresAt,
  };
}

function renderCard(
  options: {
    input?: MultiQuestionUserInputState;
    active?: boolean;
    onResolve?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const onResolve = options.onResolve ?? vi.fn();
  const input = options.input ?? buildInput();
  const view = render(
    <MultiQuestionUserInputCard
      active={options.active ?? true}
      input={input}
      locale="zh-CN"
      onResolve={onResolve}
    />,
  );
  return { input, onResolve, view };
}

const tabs = () => screen.getAllByRole("tab");
const currentPanel = () => screen.getByRole("tabpanel");
const allPanels = () => screen.getAllByRole("tabpanel", { hidden: true });

describe("multi-question card render matrix (1/2/3 questions)", () => {
  it("renders a 3-question card with progress, dots, and per-question option counts", async () => {
    renderCard();
    expect(screen.getByText("第 1/3 题")).toBeInTheDocument();
    const progress = screen.getByRole("progressbar", { name: "已答题目" });
    expect(progress).toHaveAttribute("aria-valuemin", "0");
    expect(progress).toHaveAttribute("aria-valuemax", "3");
    expect(progress).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByText("已答 0/3")).toBeInTheDocument();
    expect(tabs()).toHaveLength(3);
    expect(within(currentPanel()).getAllByRole("option")).toHaveLength(3);

    const user = userEvent.setup();
    await user.click(tabs()[1]);
    expect(screen.getByText("第 2/3 题")).toBeInTheDocument();
    expect(within(currentPanel()).getAllByRole("option")).toHaveLength(4);
  });

  it("renders 1-question and 2-question cards", () => {
    const questions = buildQuestions();
    const { view } = renderCard({
      input: buildInput({ questions: [questions[0]] }),
    });
    expect(screen.getByText("第 1/1 题")).toBeInTheDocument();
    expect(screen.getByText("已答 0/1")).toBeInTheDocument();
    expect(tabs()).toHaveLength(1);
    view.unmount();

    renderCard({ input: buildInput({ questions: questions.slice(0, 2) }) });
    expect(screen.getByText("第 1/2 题")).toBeInTheDocument();
    expect(tabs()).toHaveLength(2);
  });
});

describe("multi-question card keyboard navigation (decision M option 2)", () => {
  it("keeps one roving tab index with aria-selected and two-way aria wiring; hides inactive slides", () => {
    renderCard();
    const [tab1, tab2, tab3] = tabs();
    expect(tab1).toHaveAttribute("tabindex", "0");
    expect(tab2).toHaveAttribute("tabindex", "-1");
    expect(tab3).toHaveAttribute("tabindex", "-1");
    expect(tab1).toHaveAttribute("aria-selected", "true");
    expect(tab2).toHaveAttribute("aria-selected", "false");

    const [panel1, panel2, panel3] = allPanels();
    expect(panel1).not.toHaveAttribute("aria-hidden");
    expect(panel2).toHaveAttribute("aria-hidden", "true");
    expect(panel3).toHaveAttribute("aria-hidden", "true");
    expect(panel2).toHaveAttribute("inert");
    expect(panel3).toHaveAttribute("inert");
    expect(panel1).not.toHaveAttribute("inert");
    expect(tab1.getAttribute("aria-controls")).toBe(panel1.id);
    expect(panel1.getAttribute("aria-labelledby")).toBe(tab1.id);
    expect(tab2.getAttribute("aria-controls")).toBe(panel2.id);
    expect(panel2.getAttribute("aria-labelledby")).toBe(tab2.id);
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
  });

  it("wraps question focus with ArrowLeft/ArrowRight and jumps with Home/End", async () => {
    const user = userEvent.setup();
    renderCard();
    const [tab1, tab2, tab3] = tabs();
    await user.click(tab2);
    expect(tab2).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(tab3).toHaveFocus();
    expect(tab3).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowRight}");
    expect(tab1).toHaveFocus();
    expect(screen.getByText("第 1/3 题")).toBeInTheDocument();

    await user.keyboard("{ArrowLeft}");
    expect(tab3).toHaveFocus();

    await user.keyboard("{Home}");
    expect(tab1).toHaveFocus();

    await user.keyboard("{End}");
    expect(tab3).toHaveFocus();
    expect(screen.getByText("第 3/3 题")).toBeInTheDocument();
  });

  it("moves option focus with ArrowDown/Home/End inside the current question", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    renderCard({ onResolve });
    // Card activation focuses the current question's recommended option
    // (single-card :9406-9415 pattern); clicking an option instead would send
    // a resolution and busy-disable the row (per-question dedupe).
    const options = within(currentPanel()).getAllByRole("option");
    expect(options[0]).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(options[1]).toHaveFocus();
    await user.keyboard("{End}");
    expect(options[2]).toHaveFocus();
    await user.keyboard("{Home}");
    expect(options[0]).toHaveFocus();
  });

  it("follows the current question's countdown and clamps expired questions to 0:00", async () => {
    const user = userEvent.setup();
    const base = buildQuestions();
    const staggered: UserInputQuestion[] = base.map((question, index) => ({
      ...question,
      expiresAt: futureISO([5, 1, -1][index]),
    }));
    renderCard({ input: buildInput({ questions: staggered }) });

    const countdown = () => screen.getByTitle(TIMEOUT_HINT);
    expect(countdown()).toHaveTextContent("5:00");

    await user.click(tabs()[1]);
    expect(countdown()).toHaveTextContent("1:00");

    await user.click(tabs()[2]);
    expect(countdown()).toHaveTextContent("0:00");
    // Expiry stays display-only: the question remains pending in card state.
    expect(
      within(currentPanel()).getAllByRole("option").length,
    ).toBeGreaterThan(0);
  });

  it("keeps per-question custom drafts across question switches", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(
      within(currentPanel()).getByRole("option", { name: /其他…/ }),
    );
    const input = screen.getByRole("textbox", { name: "输入其他答案" });
    await user.type(input, "自定义草案A");

    await user.click(tabs()[1]);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    await user.click(tabs()[0]);
    expect(screen.getByRole("textbox", { name: "输入其他答案" })).toHaveValue(
      "自定义草案A",
    );
  });
});

describe("multi-question card answering (decision N option 1)", () => {
  it("sends exactly one kind'd resolution with the full field set on option click", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    renderCard({ onResolve });
    await user.click(
      within(currentPanel()).getByRole("option", { name: /预发布/ }),
    );
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve).toHaveBeenCalledWith({
      requestId: "input-1",
      nonce: "nonce-0000000001",
      kind: "multi-question",
      questionId: "q1",
      selectedOptionLabel: "预发布",
    });
  });

  it("blocks a second click on the same question while its resolution is in flight, but leaves other questions answerable", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn(() => new Promise<void>(() => {}));
    renderCard({ onResolve });
    const q1Options = within(currentPanel()).getAllByRole("option");
    await user.click(q1Options[0]);
    await user.click(q1Options[1]);
    expect(onResolve).toHaveBeenCalledTimes(1);

    await user.click(tabs()[1]);
    await user.click(within(currentPanel()).getAllByRole("option")[0]);
    expect(onResolve).toHaveBeenCalledTimes(2);
    expect(onResolve).toHaveBeenLastCalledWith(
      expect.objectContaining({ questionId: "q2" }),
    );
  });

  it("submits custom answers in the customAnswer shape", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    renderCard({ onResolve });
    await user.click(
      within(currentPanel()).getByRole("option", { name: /其他…/ }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "输入其他答案" }),
      "跳过审批直发",
    );
    await user.click(screen.getByRole("button", { name: "提交" }));
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve).toHaveBeenCalledWith({
      requestId: "input-1",
      nonce: "nonce-0000000001",
      kind: "multi-question",
      questionId: "q1",
      customAnswer: "跳过审批直发",
    });
  });

  it("does not submit custom answers while an IME composition is confirming", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    renderCard({ onResolve });
    await user.click(
      within(currentPanel()).getByRole("option", { name: /其他…/ }),
    );
    const input = screen.getByRole("textbox", { name: "输入其他答案" });
    await user.type(input, "拼音中");

    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(onResolve).not.toHaveBeenCalled();

    await user.keyboard("{Enter}");
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve).toHaveBeenCalledWith(
      expect.objectContaining({ customAnswer: "拼音中" }),
    );
  });
});

describe("multi-question card state and recovery", () => {
  const answeredQ1: Record<string, UserInputQuestionState> = {
    q1: { status: "answered", answer: "预发布", selectedOptionLabel: "预发布" },
    q2: { status: "pending" },
    q3: { status: "pending" },
  };

  it("stays pending and answerable after a partial answer (1/3)", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    renderCard({ input: buildInput({ answers: answeredQ1 }), onResolve });
    expect(screen.getByText("第 2/3 题")).toBeInTheDocument();
    expect(screen.getByText("已答 1/3")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "1",
    );
    await user.click(within(currentPanel()).getAllByRole("option")[0]);
    expect(onResolve).toHaveBeenCalledWith(
      expect.objectContaining({ questionId: "q2" }),
    );
  });

  it("renders answered questions read-only with their result strip", async () => {
    const user = userEvent.setup();
    renderCard({ input: buildInput({ answers: answeredQ1 }) });
    await user.click(tabs()[0]);
    const panel = currentPanel();
    expect(within(panel).queryAllByRole("option")).toHaveLength(0);
    expect(within(panel).getByText("已选择")).toBeInTheDocument();
    expect(within(panel).getByText("预发布")).toBeInTheDocument();
  });

  it("shows the model recommendation in a timed-out question's result strip", async () => {
    const user = userEvent.setup();
    renderCard({
      input: buildInput({
        answers: {
          q1: { status: "pending" },
          q2: { status: "timed-out" },
          q3: { status: "pending" },
        },
      }),
    });
    await user.click(tabs()[1]);
    const panel = currentPanel();
    expect(
      within(panel).getByText("5 分钟未选择，已采用模型推荐项"),
    ).toBeInTheDocument();
    expect(within(panel).getByText("跑全量回归")).toBeInTheDocument();
    expect(screen.getByText("已答 1/3")).toBeInTheDocument();
  });

  it("locks the whole card read-only once every question is resolved", async () => {
    const user = userEvent.setup();
    renderCard({
      input: buildInput({
        answers: {
          q1: {
            status: "answered",
            answer: "预发布",
            selectedOptionLabel: "预发布",
          },
          q2: {
            status: "answered",
            answer: "跳过",
            selectedOptionLabel: "跳过",
          },
          q3: { status: "cancelled" },
        },
        status: "answered",
      }),
    });
    expect(screen.queryAllByRole("option", { hidden: true })).toHaveLength(0);
    expect(screen.getAllByText("已选择", { exact: true })).toHaveLength(2);
    expect(screen.getByText("已答 3/3")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "3",
    );
    expect(screen.queryByTitle(TIMEOUT_HINT)).not.toBeInTheDocument();

    await user.click(tabs()[2]);
    expect(screen.getByText("第 3/3 题")).toBeInTheDocument();
    expect(currentPanel()).toHaveTextContent("已取消");
  });

  it("hides a pending inactive card and keeps a resolved inactive card read-only", () => {
    const { view } = renderCard({ active: false });
    expect(view.container.querySelector(".user-input-card")).toBeNull();
    view.unmount();

    renderCard({
      active: false,
      input: buildInput({
        answers: {
          q1: {
            status: "answered",
            answer: "预发布",
            selectedOptionLabel: "预发布",
          },
          q2: {
            status: "answered",
            answer: "跳过",
            selectedOptionLabel: "跳过",
          },
          q3: {
            status: "answered",
            answer: "应用内通知",
            selectedOptionLabel: "应用内通知",
          },
        },
        status: "answered",
      }),
    });
    expect(screen.getByText("已答 3/3")).toBeInTheDocument();
    expect(screen.queryAllByRole("option", { hidden: true })).toHaveLength(0);
  });
});

describe("multi-question card long copy and layout", () => {
  it("truncates long question and option copy visually while title and aria-label keep the full text", () => {
    const longQuestion = "长题目".repeat(334).slice(0, 1000);
    const longLabel = "长选项".repeat(27).slice(0, 80);
    renderCard({
      input: buildInput({
        questions: [
          {
            questionId: "q1",
            question: longQuestion,
            options: [
              { label: longLabel, description: "说明", recommended: true },
              { label: "备选", description: "说明", recommended: false },
            ],
            expiresAt: futureISO(5),
          },
          ...buildQuestions().slice(1, 2),
        ],
      }),
    });
    const panel = currentPanel();
    const questionText = within(panel).getByText(longQuestion);
    expect(questionText).toHaveClass("user-question-text");
    expect(questionText).toHaveAttribute("title", longQuestion);

    const option = within(panel).getByRole("option", {
      name: new RegExp(longLabel.slice(0, 6)),
    });
    expect(option).toHaveAttribute("title", longLabel);

    expect(tabs()[0]).toHaveAttribute("aria-label", `第 1 题 ${longQuestion}`);
  });
});

describe("multi-question card auto-advance focus (PR10C #125 review fix)", () => {
  it("moves focus to the next pending question's recommended option after the current question closes", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    const { view } = renderCard({ onResolve });
    await user.click(
      within(currentPanel()).getByRole("option", { name: /预发布/ }),
    );
    expect(onResolve).toHaveBeenCalledTimes(1);

    // The parent reducer pushes the recorded answer back down; the card
    // auto-advances to q2.
    view.rerender(
      <MultiQuestionUserInputCard
        active
        input={buildInput({
          answers: {
            q1: {
              status: "answered",
              answer: "预发布",
              selectedOptionLabel: "预发布",
            },
            q2: { status: "pending" },
            q3: { status: "pending" },
          },
        })}
        locale="zh-CN"
        onResolve={onResolve}
      />,
    );

    // Focus must land on q2's recommended option — not on <body> after the
    // answered slide turns inert (the pre-fix rAF cancelled itself).
    expect(screen.getByText("第 2/3 题")).toBeInTheDocument();
    expect(allPanels()[0]).toHaveAttribute("inert");
    const options = within(currentPanel()).getAllByRole("option");
    expect(options[0]).toHaveTextContent("跑全量回归");
    expect(options[0]).toHaveFocus();
  });

  it("stays put without crashing when the closing question was the last pending one", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    const { view } = renderCard({
      input: buildInput({
        answers: {
          q1: { status: "pending" },
          q2: {
            status: "answered",
            answer: "跑全量回归",
            selectedOptionLabel: "跑全量回归",
          },
          q3: {
            status: "answered",
            answer: "应用内通知",
            selectedOptionLabel: "应用内通知",
          },
        },
      }),
      onResolve,
    });
    // Only q1 is pending; the card opens on it as the first pending question.
    expect(screen.getByText("第 1/3 题")).toBeInTheDocument();
    await user.click(
      within(currentPanel()).getByRole("option", { name: /预发布/ }),
    );
    expect(onResolve).toHaveBeenCalledTimes(1);

    view.rerender(
      <MultiQuestionUserInputCard
        active
        input={buildInput({
          answers: {
            q1: {
              status: "answered",
              answer: "预发布",
              selectedOptionLabel: "预发布",
            },
            q2: {
              status: "answered",
              answer: "跑全量回归",
              selectedOptionLabel: "跑全量回归",
            },
            q3: {
              status: "answered",
              answer: "应用内通知",
              selectedOptionLabel: "应用内通知",
            },
          },
        })}
        locale="zh-CN"
        onResolve={onResolve}
      />,
    );

    // No pending question remains: the effect must not advance, focus, or
    // crash; the just-answered slide shows its read-only result strip.
    expect(screen.getByText("第 1/3 题")).toBeInTheDocument();
    expect(screen.getByText("已答 3/3")).toBeInTheDocument();
    const panel = currentPanel();
    expect(within(panel).queryAllByRole("option")).toHaveLength(0);
    expect(within(panel).getByText("已选择")).toBeInTheDocument();
    expect(within(panel).getByText("预发布")).toBeInTheDocument();
  });
});

describe("multi-question card other-form roving tab stop (PR10C #125 review fix)", () => {
  it("pins the roving stop on the last real option while the other form is open so Tab/Shift+Tab keep the list reachable", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(
      within(currentPanel()).getByRole("option", { name: /其他…/ }),
    );
    const draftInput = screen.getByRole("textbox", { name: "输入其他答案" });
    expect(draftInput).toHaveFocus();

    // The "其他…" button is unmounted while the form is open; without a
    // pinned stop every real option would carry tabIndex=-1 and the listbox
    // would fall out of the tab order entirely.
    const options = within(currentPanel()).getAllByRole("option");
    expect(options).toHaveLength(2);
    const tabbable = options.filter(
      (option) => option.getAttribute("tabindex") === "0",
    );
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toBe(options[options.length - 1]);

    // Shift+Tab from the draft input reaches the listbox again, and Tab
    // returns to the input — the list is no longer skipped.
    await user.tab({ shift: true });
    expect(options[options.length - 1]).toHaveFocus();
    await user.tab();
    expect(draftInput).toHaveFocus();
  });

  it("restores the original roving semantics after Escape closes the other form", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(
      within(currentPanel()).getByRole("option", { name: /其他…/ }),
    );
    expect(
      screen.getByRole("textbox", { name: "输入其他答案" }),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    // The "其他…" button remounts and the roving stop returns to it
    // (activeOptionIndex was left pointing at otherOptionIndex).
    const restored = within(currentPanel()).getAllByRole("option");
    expect(restored).toHaveLength(3);
    expect(restored[0]).toHaveAttribute("tabindex", "-1");
    expect(restored[1]).toHaveAttribute("tabindex", "-1");
    const otherOption = within(currentPanel()).getByRole("option", {
      name: /其他…/,
    });
    expect(otherOption).toHaveAttribute("tabindex", "0");
    await waitFor(() => expect(otherOption).toHaveFocus());
  });
});

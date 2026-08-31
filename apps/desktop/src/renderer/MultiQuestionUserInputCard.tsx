import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import type {
  AppLocale,
  MultiQuestionUserInputState,
  UserInputMultiQuestionResolution,
  UserInputQuestion,
  UserInputQuestionState,
  UserInputState,
} from "@artemis/protocol";

import { localizedCopy } from "../shared/i18n-resources.js";
import { legacyLocale } from "../shared/locales.js";
import { formatUserInputCountdown } from "./user-input-countdown.js";
import {
  moveUserInputOptionFocus,
  moveUserInputQuestionFocus,
} from "./user-input-navigation.js";

// D#76 PR10C (decision L option 1): the multi-question card keeps the v17 17b
// semantics — one question in focus at a time, a dots tablist for question
// navigation, per-question countdown, and per-question resolutions (decision N
// option 1: clicking an option sends exactly one kind'd resolution). All state
// is derived from the reducer's MultiQuestionUserInputState; this component
// never mutates question status locally.

const multiQuestionCopy = {
  "zh-CN": {
    questionProgress: "第 {{index}}/{{count}} 题",
    answeredProgress: "已答 {{count}}/{{total}}",
    progressLabel: "已答题目",
    questionNavLabel: "题目导航",
    questionTabLabel: "第 {{index}} 题 {{question}}",
    recommended: "模型推荐",
    otherAnswer: "其他…",
    otherAnswerDetail: "输入一个不在以上列表中的答案",
    customAnswer: "输入其他答案",
    submitAnswer: "提交",
    timeoutHint: "5 分钟内未选择将自动采用模型推荐项",
    answered: "已选择",
    timedOut: "5 分钟未选择，已采用模型推荐项",
    inputCancelled: "已取消",
  },
  en: {
    questionProgress: "Question {{index}} of {{count}}",
    answeredProgress: "{{count}}/{{total}} answered",
    progressLabel: "Answered questions",
    questionNavLabel: "Question navigation",
    questionTabLabel: "Question {{index}}: {{question}}",
    recommended: "Recommended",
    otherAnswer: "Other…",
    otherAnswerDetail: "Type an answer that is not listed above",
    customAnswer: "Type another answer",
    submitAnswer: "Submit",
    timeoutHint: "The recommended option is used automatically after 5 minutes",
    answered: "Selected",
    timedOut: "No response for 5 minutes; used the model recommendation",
    inputCancelled: "Cancelled",
  },
} satisfies Record<string, Record<string, string>>;

type MultiQuestionCopy = (typeof multiQuestionCopy)["en"];

function multiQuestionAppCopy(locale: AppLocale): MultiQuestionCopy {
  return localizedCopy(locale, "app", multiQuestionCopy[legacyLocale(locale)]);
}

function fill(
  template: string,
  values: Record<string, string | number>,
): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{{${key}}}`, String(value)),
    template,
  );
}

export function isMultiQuestionUserInput(
  input: UserInputState | MultiQuestionUserInputState,
): input is MultiQuestionUserInputState {
  return input.kind === "multi-question" && "questions" in input;
}

function recommendedOptionIndex(question: UserInputQuestion): number {
  return Math.max(
    0,
    question.options.findIndex((option) => option.recommended),
  );
}

function questionStatusLabel(
  question: UserInputQuestion,
  answer: UserInputQuestionState | undefined,
  t: MultiQuestionCopy,
): { status: string; label: string | undefined } {
  const status = answer?.status ?? "pending";
  if (status === "answered") {
    return {
      status: t.answered,
      label: answer?.selectedOptionLabel ?? answer?.answer,
    };
  }
  if (status === "timed-out") {
    return {
      status: t.timedOut,
      // The reducer records the model recommendation for timed-out
      // questions; derive the label from the question itself so the strip
      // stays truthful even when the recorded answer is absent.
      label:
        question.options.find((option) => option.recommended)?.label ??
        answer?.answer,
    };
  }
  return { status: t.inputCancelled, label: undefined };
}

function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className="icon"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      {children}
    </svg>
  );
}

function EnterIcon() {
  return (
    <span aria-hidden="true" className="user-input-option-enter">
      <Icon size={17}>
        <path
          d="m9 5 7 7-7 7"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.7"
        />
      </Icon>
    </span>
  );
}

function QuestionSlide({
  answer,
  busy,
  current,
  onCustomSubmit,
  onOptionSelect,
  panelId,
  question,
  registerOptionButton,
  tabId,
  t,
}: {
  answer: UserInputQuestionState | undefined;
  busy: boolean;
  current: boolean;
  onCustomSubmit: (customAnswer: string) => void;
  onOptionSelect: (selectedOptionLabel: string) => void;
  panelId: string;
  question: UserInputQuestion;
  registerOptionButton: (
    questionId: string,
    index: number,
    button: HTMLButtonElement | null,
  ) => void;
  tabId: string;
  t: MultiQuestionCopy;
}) {
  const otherOptionIndex = question.options.length;
  const optionCount = question.options.length + 1;
  const slideOptionButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const [activeOptionIndex, setActiveOptionIndex] = useState(() =>
    recommendedOptionIndex(question),
  );
  const [showOther, setShowOther] = useState(false);
  const [draft, setDraft] = useState("");
  const closed = (answer?.status ?? "pending") !== "pending";
  // While the inline "other" form is open the "other" button is unmounted but
  // activeOptionIndex still points at otherOptionIndex, which would give every
  // real option tabIndex=-1 and drop the whole listbox from the tab order
  // (Tab skips it; Shift+Tab from the draft input cannot reach it). Pin the
  // roving stop on the last real option — the unmounted button's DOM neighbor
  // — until the form closes. Once the user focuses or hovers a real option,
  // activeOptionIndex moves there and the stop follows it as usual; closing
  // the form remounts the "other" button with activeOptionIndex untouched,
  // restoring the original roving semantics.
  const rovingOptionIndex =
    showOther && activeOptionIndex === otherOptionIndex && otherOptionIndex > 0
      ? otherOptionIndex - 1
      : activeOptionIndex;

  const closeOther = () => {
    setShowOther(false);
  };

  const handleOptionKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) => {
    const key = event.key;
    if (
      key !== "ArrowDown" &&
      key !== "ArrowUp" &&
      key !== "Home" &&
      key !== "End"
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const nextIndex = moveUserInputOptionFocus(
      activeOptionIndex,
      optionCount,
      key,
    );
    if (nextIndex < 0) return;
    setActiveOptionIndex(nextIndex);
    slideOptionButtons.current[nextIndex]?.focus();
  };

  const result = closed ? questionStatusLabel(question, answer, t) : null;

  return (
    <div
      aria-hidden={!current || undefined}
      aria-labelledby={tabId}
      className={`user-question-slide${current ? " active" : ""}`}
      id={panelId}
      inert={!current || undefined}
      role="tabpanel"
    >
      <strong className="user-question-text" title={question.question}>
        {question.question}
      </strong>
      {closed && result ? (
        <div className="user-input-result user-question-result">
          <span>{result.status}</span>
          {result.label && <strong>{result.label}</strong>}
        </div>
      ) : (
        <div className="user-input-options-scroll">
          <div
            aria-label={question.question}
            className="user-input-options"
            role="listbox"
          >
            {question.options.map((option, index) => (
              <button
                aria-keyshortcuts="ArrowUp ArrowDown Home End Enter"
                aria-selected={activeOptionIndex === index}
                className={`user-input-option${option.recommended ? " recommended" : ""}${activeOptionIndex === index ? " active" : ""}`}
                disabled={busy}
                key={option.label}
                onClick={() => onOptionSelect(option.label)}
                onFocus={() => setActiveOptionIndex(index)}
                onKeyDown={handleOptionKeyDown}
                onMouseEnter={() => setActiveOptionIndex(index)}
                ref={(button) => {
                  slideOptionButtons.current[index] = button;
                  registerOptionButton(question.questionId, index, button);
                }}
                role="option"
                tabIndex={rovingOptionIndex === index ? 0 : -1}
                title={option.label}
                type="button"
              >
                <span aria-hidden="true" className="user-input-option-index">
                  {index + 1}
                </span>
                <span className="user-input-option-copy">
                  <span className="user-input-option-title">
                    <strong>{option.label}</strong>
                    {option.recommended && (
                      <small className="recommendation-badge">
                        {t.recommended}
                      </small>
                    )}
                  </span>
                  <small>{option.description}</small>
                </span>
                <EnterIcon />
              </button>
            ))}
            {!showOther && (
              <button
                aria-keyshortcuts="ArrowUp ArrowDown Home End Enter"
                aria-selected={activeOptionIndex === otherOptionIndex}
                className={`user-input-option other${activeOptionIndex === otherOptionIndex ? " active" : ""}`}
                disabled={busy}
                key="__other"
                onClick={() => {
                  setActiveOptionIndex(otherOptionIndex);
                  setShowOther(true);
                }}
                onFocus={() => setActiveOptionIndex(otherOptionIndex)}
                onKeyDown={handleOptionKeyDown}
                onMouseEnter={() => setActiveOptionIndex(otherOptionIndex)}
                ref={(button) => {
                  slideOptionButtons.current[otherOptionIndex] = button;
                  registerOptionButton(
                    question.questionId,
                    otherOptionIndex,
                    button,
                  );
                }}
                role="option"
                tabIndex={activeOptionIndex === otherOptionIndex ? 0 : -1}
                type="button"
              >
                <span
                  aria-hidden="true"
                  className="user-input-option-index user-input-other-icon"
                >
                  <Icon size={15}>
                    <path
                      d="m5 16 1-3L15.5 3.5a1.8 1.8 0 0 1 2.6 2.6L8.5 15.5 5 16Z"
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.5"
                    />
                  </Icon>
                </span>
                <span className="user-input-option-copy">
                  <span className="user-input-option-title">
                    <strong>{t.otherAnswer}</strong>
                  </span>
                  <small>{t.otherAnswerDetail}</small>
                </span>
                <EnterIcon />
              </button>
            )}
          </div>
          {showOther && (
            <form
              className="user-input-other-inline"
              onSubmit={(event) => {
                event.preventDefault();
                const customAnswer = draft.trim();
                if (customAnswer) onCustomSubmit(customAnswer);
              }}
            >
              <span aria-hidden="true" className="user-input-other-edit-icon">
                <Icon size={16}>
                  <path
                    d="m5 16 1-3L15.5 3.5a1.8 1.8 0 0 1 2.6 2.6L8.5 15.5 5 16Z"
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.5"
                  />
                </Icon>
              </span>
              <input
                aria-label={t.customAnswer}
                autoFocus
                disabled={busy}
                maxLength={2_000}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    closeOther();
                    return;
                  }
                  // IME composition confirmations must not submit the form.
                  if (event.key === "Enter" && event.nativeEvent.isComposing) {
                    event.preventDefault();
                    event.stopPropagation();
                  }
                }}
                placeholder={t.customAnswer}
                value={draft}
              />
              <button
                aria-label={t.submitAnswer}
                className="user-input-other-submit"
                disabled={busy || !draft.trim()}
                title={t.submitAnswer}
                type="submit"
              >
                <Icon size={16}>
                  <path
                    d="m6 12 6-6 6 6m-6-6v12"
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.7"
                  />
                </Icon>
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

export function MultiQuestionUserInputCard({
  active,
  input,
  locale,
  onResolve,
}: {
  active: boolean;
  input: MultiQuestionUserInputState;
  locale: AppLocale;
  onResolve: (
    resolution: UserInputMultiQuestionResolution,
  ) => void | Promise<void>;
}) {
  const t = multiQuestionAppCopy(locale);
  const questionCount = input.questions.length;
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(() =>
    Math.max(
      0,
      input.questions.findIndex(
        (question) =>
          (input.answers[question.questionId]?.status ?? "pending") ===
          "pending",
      ),
    ),
  );
  const [resolvingQuestions, setResolvingQuestions] = useState<
    Record<string, true>
  >({});
  const [clock, setClock] = useState(() => Date.now());
  const activeQuestionIndexRef = useRef(activeQuestionIndex);
  const dotButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const optionButtons = useRef<Record<string, Array<HTMLButtonElement | null>>>(
    {},
  );
  const previousAnswers = useRef(input.answers);
  const pendingAdvanceFocus = useRef<number | null>(null);
  const reactId = useId();
  const currentQuestion = input.questions[activeQuestionIndex];
  const answeredCount = input.questions.filter(
    (question) =>
      (input.answers[question.questionId]?.status ?? "pending") !== "pending",
  ).length;

  activeQuestionIndexRef.current = activeQuestionIndex;

  const registerOptionButton = (
    questionId: string,
    index: number,
    button: HTMLButtonElement | null,
  ) => {
    const buttons = optionButtons.current[questionId] ?? [];
    buttons[index] = button;
    optionButtons.current[questionId] = buttons;
  };

  const focusRecommendedOption = (questionIndex: number) => {
    const question = input.questions[questionIndex];
    if (!question) return;
    const index = recommendedOptionIndex(question);
    optionButtons.current[question.questionId]?.[index]?.focus({
      preventScroll: true,
    });
  };

  useEffect(() => {
    if (input.status !== "pending") return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [input.requestId, input.status]);

  useLayoutEffect(() => {
    if (!active || input.status !== "pending") return;
    // Focus lands on the current question's recommended option when the card
    // becomes active; per-question switches manage their own focus. The focus
    // is synchronous (no rAF) so awaited test interactions never race it.
    focusRecommendedOption(activeQuestionIndexRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, input.requestId, input.status]);

  useEffect(() => {
    const previous = previousAnswers.current;
    previousAnswers.current = input.answers;
    if (input.status !== "pending") return;
    const question = input.questions[activeQuestionIndex];
    if (!question) return;
    const wasPending =
      (previous[question.questionId]?.status ?? "pending") === "pending";
    const isPending =
      (input.answers[question.questionId]?.status ?? "pending") === "pending";
    // Only advance when the question being viewed just closed; navigating to
    // an already-answered question for review must not bounce the user away.
    if (!wasPending || isPending) return;
    const nextIndex = input.questions.findIndex(
      (candidate) =>
        (input.answers[candidate.questionId]?.status ?? "pending") ===
        "pending",
    );
    if (nextIndex < 0) return;
    // The focus must wait for the commit that activates the next slide (its
    // inert attribute is removed only there). A rAF scheduled here would be
    // cancelled by this effect's own cleanup: setActiveQuestionIndex below
    // re-runs the effect (activeQuestionIndex is a dependency) and React
    // invokes the previous cleanup first, so the frame never fires and focus
    // falls to <body>. Consume a one-shot flag from the layout effect below
    // instead — synchronous post-commit focus, matching the card-activation
    // effect above.
    pendingAdvanceFocus.current = nextIndex;
    setActiveQuestionIndex(nextIndex);
  }, [input.answers, input.questions, input.status, activeQuestionIndex]);

  useLayoutEffect(() => {
    const target = pendingAdvanceFocus.current;
    if (target === null) return;
    pendingAdvanceFocus.current = null;
    if (!active || input.status !== "pending") return;
    // The user navigated elsewhere in the same batch; do not yank focus back.
    if (target !== activeQuestionIndex) return;
    focusRecommendedOption(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, activeQuestionIndex, input.status]);

  if (input.status === "pending" && !active) return null;

  const resolveQuestion = async (
    question: UserInputQuestion,
    choice: Pick<
      UserInputMultiQuestionResolution,
      "selectedOptionLabel" | "customAnswer"
    >,
  ) => {
    if (input.status !== "pending") return;
    if (
      (input.answers[question.questionId]?.status ?? "pending") !== "pending"
    ) {
      return;
    }
    if (resolvingQuestions[question.questionId]) return;
    setResolvingQuestions((current) => ({
      ...current,
      [question.questionId]: true,
    }));
    try {
      await onResolve({
        requestId: input.requestId,
        nonce: input.nonce,
        kind: "multi-question",
        questionId: question.questionId,
        ...choice,
      });
    } catch {
      setResolvingQuestions((current) => {
        const next = { ...current };
        delete next[question.questionId];
        return next;
      });
    }
  };

  const goToQuestion = (index: number, focusDot: boolean) => {
    setActiveQuestionIndex(index);
    // v17 focuses the target dot synchronously (go(target, true)); rAF here
    // would race awaited interactions under jsdom.
    if (focusDot) dotButtons.current[index]?.focus({ preventScroll: true });
  };

  const handleDotKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const key = event.key;
    if (
      key !== "ArrowLeft" &&
      key !== "ArrowRight" &&
      key !== "Home" &&
      key !== "End"
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const nextIndex = moveUserInputQuestionFocus(
      activeQuestionIndex,
      questionCount,
      key,
    );
    if (nextIndex < 0) return;
    goToQuestion(nextIndex, true);
  };

  return (
    <article className={`user-input-card multi-question ${input.status}`}>
      <header>
        <span aria-hidden="true" className="user-input-mark">
          <Icon size={18}>
            <path
              d="M9.2 9.1a2.9 2.9 0 1 1 4.4 2.5c-1 .6-1.6 1.1-1.6 2.2"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="1.7"
            />
            <path
              d="M12 17.5h.01"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="2.2"
            />
          </Icon>
        </span>
        <div className="user-input-heading">
          <small className="user-input-eyebrow">{input.header}</small>
          <strong className="user-input-question">
            {fill(t.questionProgress, {
              index: activeQuestionIndex + 1,
              count: questionCount,
            })}
          </strong>
        </div>
        {input.status === "pending" && currentQuestion && (
          <time
            aria-label={t.timeoutHint}
            className="user-input-timeout"
            dateTime={currentQuestion.expiresAt}
            title={t.timeoutHint}
          >
            {formatUserInputCountdown(
              Date.parse(currentQuestion.expiresAt) - clock,
            )}
          </time>
        )}
      </header>
      <div className="user-question-progress">
        <div
          aria-label={t.progressLabel}
          aria-valuemax={questionCount}
          aria-valuemin={0}
          aria-valuenow={answeredCount}
          className="user-question-progress-bar"
          role="progressbar"
        >
          <i
            style={{
              width: questionCount
                ? `${(answeredCount / questionCount) * 100}%`
                : "0%",
            }}
          />
        </div>
        <span className="user-question-progress-text">
          {fill(t.answeredProgress, {
            count: answeredCount,
            total: questionCount,
          })}
        </span>
      </div>
      <div className="user-question-track">
        {input.questions.map((question, index) => (
          <QuestionSlide
            answer={input.answers[question.questionId]}
            busy={Boolean(resolvingQuestions[question.questionId])}
            current={index === activeQuestionIndex}
            key={question.questionId}
            onCustomSubmit={(customAnswer) =>
              void resolveQuestion(question, { customAnswer })
            }
            onOptionSelect={(selectedOptionLabel) =>
              void resolveQuestion(question, { selectedOptionLabel })
            }
            panelId={`${reactId}-q${index}-panel`}
            question={question}
            registerOptionButton={registerOptionButton}
            tabId={`${reactId}-q${index}-tab`}
            t={t}
          />
        ))}
      </div>
      <div className="user-question-nav">
        <div
          aria-label={t.questionNavLabel}
          className="user-question-dots"
          role="tablist"
        >
          {input.questions.map((question, index) => {
            const closed =
              (input.answers[question.questionId]?.status ?? "pending") !==
              "pending";
            return (
              <button
                aria-controls={`${reactId}-q${index}-panel`}
                aria-label={fill(t.questionTabLabel, {
                  index: index + 1,
                  question: question.question,
                })}
                aria-selected={index === activeQuestionIndex}
                className={`user-question-dot${index === activeQuestionIndex ? " active" : ""}${closed && index !== activeQuestionIndex ? " done" : ""}`}
                id={`${reactId}-q${index}-tab`}
                key={question.questionId}
                onClick={() => goToQuestion(index, false)}
                onKeyDown={handleDotKeyDown}
                ref={(button) => {
                  dotButtons.current[index] = button;
                }}
                role="tab"
                tabIndex={index === activeQuestionIndex ? 0 : -1}
                type="button"
              />
            );
          })}
        </div>
      </div>
    </article>
  );
}

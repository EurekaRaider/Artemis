import { DecisionOptions, DecisionResult } from "./DecisionCard.js";
import { uiText } from "../shared/ui-text.js";
import { UI_COPY } from "../shared/ui-copy.js";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type {
  AppLocale,
  MultiQuestionUserInputState,
  UserInputMultiQuestionResolution,
  UserInputQuestion,
  UserInputQuestionState,
  UserInputState,
} from "@artemis/protocol";
import { UserInputFrame } from "@artemis/ui/patterns";

import { formatUserInputCountdown } from "./user-input-countdown.js";
import { moveUserInputQuestionFocus } from "./user-input-navigation.js";

// D#76 PR10C (decision L option 1): the multi-question card keeps the v17 17b
// semantics — one question in focus at a time, a dots tablist for question
// navigation, per-question countdown, and per-question resolutions (decision N
// option 1: submitting a selection sends one kind'd resolution). All state
// is derived from the reducer's MultiQuestionUserInputState; this component
// never mutates question status locally.

const multiQuestionCopy =
  UI_COPY.MultiQuestionUserInputCard_multiQuestionCopy satisfies Record<
    string,
    Record<string, string>
  >;

type MultiQuestionCopy = (typeof multiQuestionCopy)["en"];

function multiQuestionAppCopy(locale: AppLocale): MultiQuestionCopy {
  return multiQuestionCopy[locale];
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

function QuestionSlide({
  answer,
  busy,
  current,
  onCustomSubmit,
  onOptionSelect,
  onSkip,
  panelId,
  question,
  registerOptionButton,
  tabId,
  t,
  locale,
  error,
}: {
  answer: UserInputQuestionState | undefined;
  busy: boolean;
  current: boolean;
  onCustomSubmit: (text: string) => void;
  onOptionSelect: (label: string) => void;
  onSkip: () => void;
  panelId: string;
  question: UserInputQuestion;
  tabId: string;
  t: MultiQuestionCopy;
  locale: AppLocale;
  error: boolean;
  registerOptionButton: (
    questionId: string,
    index: number,
    button: HTMLButtonElement | null,
  ) => void;
}) {
  const closed = (answer?.status ?? "pending") !== "pending";
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
      {result ? (
        <DecisionResult
          label={
            answer?.skipped
              ? uiText(locale, "DecisionCard.skipped")
              : result.status
          }
          {...(result.label ? { answer: result.label } : {})}
        >
          <p>{question.question}</p>
          {result.label && <p>{result.label}</p>}
        </DecisionResult>
      ) : (
        <>
          <DecisionOptions
            options={question.options}
            locale={locale}
            busy={busy}
            registerButton={(index, button) =>
              registerOptionButton(question.questionId, index, button)
            }
            onChoose={(index) => {
              const option = question.options[index];
              if (option) onOptionSelect(option.label);
            }}
            onReply={onCustomSubmit}
            onSkip={onSkip}
          />
          {error && (
            <p role="alert" className="decision-error">
              {uiText(locale, "DecisionCard.failed")}
            </p>
          )}
        </>
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
  const pendingQuestions = useRef(new Set<string>());
  const [errors, setErrors] = useState<Record<string, boolean>>({});
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
      "selectedOptionLabel" | "customAnswer" | "skipped"
    >,
  ) => {
    if (input.status !== "pending") return;
    if (
      (input.answers[question.questionId]?.status ?? "pending") !== "pending"
    ) {
      return;
    }
    if (pendingQuestions.current.has(question.questionId)) return;
    pendingQuestions.current.add(question.questionId);
    setErrors((current) => ({ ...current, [question.questionId]: false }));
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
      pendingQuestions.current.delete(question.questionId);
      setErrors((current) => ({ ...current, [question.questionId]: true }));
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

  if (input.status !== "pending") {
    const summaries = input.questions.map((question) => {
      const answer = input.answers[question.questionId];
      const result = questionStatusLabel(question, answer, t);
      return {
        question: question.question,
        label: answer?.skipped
          ? uiText(locale, "DecisionCard.skipped")
          : (result.label ?? result.status),
      };
    });
    return (
      <DecisionResult
        label={
          input.status === "cancelled"
            ? t.inputCancelled
            : input.status === "timed-out"
              ? t.timedOut
              : t.answered
        }
        answer={summaries.map((item) => item.label).join(" · ")}
      >
        {summaries.map((item, index) => (
          <div key={index}>
            <strong>{item.question}</strong>
            <p>{item.label}</p>
          </div>
        ))}
      </DecisionResult>
    );
  }
  return (
    <UserInputFrame
      className={`decision-card user-input-card multi-question ${input.status}`}
      label={input.header}
      state={
        input.questions.some(
          (question) =>
            resolvingQuestions[question.questionId] &&
            (input.answers[question.questionId]?.status ?? "pending") ===
              "pending",
        )
          ? "busy"
          : input.status
      }
    >
      <header>
        <strong data-part="question">
          {currentQuestion?.question ?? input.header}
        </strong>
        <div className="decision-question-meta">
          <span className="decision-question-progress">
            {fill(t.questionProgress, {
              index: activeQuestionIndex + 1,
              count: questionCount,
            })}
          </span>
          {input.status === "pending" && currentQuestion && (
            <span className="decision-waiting">
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
            </span>
          )}
        </div>
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
        <span className="user-question-progress-text" data-part="status">
          {fill(t.answeredProgress, {
            count: answeredCount,
            total: questionCount,
          })}
        </span>
      </div>
      <div className="user-question-track">
        {input.questions.map((question, index) => (
          <QuestionSlide
            locale={locale}
            error={Boolean(errors[question.questionId])}
            onSkip={() => void resolveQuestion(question, { skipped: true })}
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
    </UserInputFrame>
  );
}
